'use strict';
const { app, BrowserWindow, ipcMain, shell, dialog, safeStorage, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { Client } = require('minecraft-launcher-core');
const javaUtils = require('./java-utils');
const serverPing = require('./server-ping');
const skins = require('./skins');
const skinUtils = require('./skin-utils');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES_URL = 'https://resources.download.minecraft.net';

// ---------- Пути ----------
const DATA_DIR = path.join(app.getPath('appData'), '.minilauncher');
const GAME_DIR = path.join(DATA_DIR, 'minecraft');
const CONFIG_FILE = path.join(DATA_DIR, 'launcher.json');

let win = null;
let config = {
  profiles: [],            // {id, type:'offline'|'microsoft', name, uuid, refresh?}
  selectedProfile: null,
  selectedVersion: null,
  ramGb: 4,
  javaPath: '',
  closeOnLaunch: false,
  servers: [],             // {id, name, address}
  stats: { totalMs: 0, sessions: 0, byVersion: {}, last: null },
  localSkins: {},          // profileId -> { slim }
  accent: '#ffd633',       // акцентный цвет интерфейса
  reduceMotion: false,     // отключить анимации
  jvmArgs: '',             // дополнительные аргументы Java
  winW: 0, winH: 0,        // размер окна игры (0 — по умолчанию)
  fullscreen: false,
  bounds: null,            // размер окна лаунчера { width, height }
};

// ---------- Конфиг ----------
function loadConfig() {
  try {
    fs.mkdirSync(GAME_DIR, { recursive: true });
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    config = { ...config, ...raw };
  } catch (_) { /* первый запуск */ }
}
function saveConfig() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function publicProfiles() {
  return config.profiles.map(({ id, type, name, uuid }) => ({ id, type, name, uuid }));
}
function publicState() {
  return {
    profiles: publicProfiles(),
    selectedProfile: config.selectedProfile,
    selectedVersion: config.selectedVersion,
    settings: {
      ramGb: config.ramGb, javaPath: config.javaPath, closeOnLaunch: config.closeOnLaunch,
      accent: config.accent, reduceMotion: config.reduceMotion,
      jvmArgs: config.jvmArgs, winW: config.winW, winH: config.winH, fullscreen: config.fullscreen,
    },
    gameDir: GAME_DIR,
    totalRamGb: Math.max(2, Math.floor(os.totalmem() / 1024 ** 3)),
    stats: config.stats,
    appVersion: app.getVersion(),
  };
}

// Токен обновления Microsoft храним зашифрованным, если ОС это поддерживает
function sealToken(str) {
  if (!str) return null;
  if (safeStorage.isEncryptionAvailable()) return 'enc:' + safeStorage.encryptString(str).toString('base64');
  return 'raw:' + Buffer.from(str).toString('base64');
}
function openToken(sealed) {
  if (!sealed) return null;
  const [kind, data] = [sealed.slice(0, 3), sealed.slice(4)];
  if (kind === 'enc') return safeStorage.decryptString(Buffer.from(data, 'base64'));
  return Buffer.from(data, 'base64').toString();
}

// ---------- Утилиты ----------
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MiniLauncher/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function downloadFile(url, dest, sha1) {
  if (await exists(dest)) {
    if (!sha1 || (await sha1File(dest)) === sha1) return;
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'MiniLauncher/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fsp.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      if (sha1 && (await sha1File(tmp)) !== sha1) throw new Error('SHA1 mismatch');
      await fsp.rename(tmp, dest);
      return;
    } catch (e) {
      if (attempt === 3) throw new Error(`${url}: ${e.message}`);
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}
async function pool(items, limit, worker) {
  let i = 0;
  const run = async () => { while (i < items.length) { const item = items[i++]; await worker(item); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// ---------- Версии ----------
let manifestCache = null;
async function getManifest() {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60e3) return manifestCache.data;
  const data = await fetchJson(MANIFEST_URL);
  manifestCache = { at: Date.now(), data };
  return data;
}

async function installedVersions() {
  const dir = path.join(GAME_DIR, 'versions');
  let names = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const out = [];
  for (const id of names) {
    const json = path.join(dir, id, `${id}.json`);
    const jar = path.join(dir, id, `${id}.jar`);
    const marker = path.join(dir, id, '.minilauncher-complete');
    // Версия считается скачанной, если есть метка нашего загрузчика
    // или (для версий из других лаунчеров) json и jar
    if (await exists(json) && (await exists(marker) || await exists(jar))) {
      let mc = id, loader = 'vanilla';
      try {
        const j = JSON.parse(await fsp.readFile(json, 'utf8'));
        if (j.inheritsFrom) mc = j.inheritsFrom;
        loader = detectLoader(id, j);
      } catch (_) { /* битый json — считаем ванилью */ }
      out.push({ id, mc, loader });
    }
  }
  return out;
}

function detectLoader(id, j) {
  const s = (id + ' ' + (j && j.mainClass || '')).toLowerCase();
  if (s.includes('quilt')) return 'quilt';
  if (s.includes('fabric')) return 'fabric';
  if (s.includes('neoforge')) return 'neoforge';
  if (s.includes('forge') || s.includes('modlauncher') || s.includes('fml')) return 'forge';
  return 'vanilla';
}

// Игровая папка: для версий с загрузчиком — отдельная (свои моды, сохранения, настройки)
function gameDirFor(v) {
  return v && v.loader !== 'vanilla' ? path.join(GAME_DIR, 'instances', v.id) : GAME_DIR;
}

function osName() {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
}
function ruleAllows(rules) {
  if (!rules || !rules.length) return true;
  let allowed = false;
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== osName()) match = false;
      if (r.os.arch && r.os.arch !== (process.arch === 'ia32' ? 'x86' : process.arch)) match = false;
    }
    if (r.features) match = false; // demo / custom resolution и пр. не включаем
    if (match) allowed = r.action === 'allow';
  }
  return allowed;
}

let downloading = false;
async function withLock(fn) {
  if (downloading) throw new Error('Уже идёт другая загрузка');
  downloading = true;
  try { return await fn(); } finally { downloading = false; }
}
const progressFor = id => (stage, done, total) => send('download:progress', { id, stage, done, total });

async function downloadVersion(id) {
  return withLock(() => installVanilla(id, progressFor(id)));
}

async function installVanilla(id, progress) {
  {
    const manifest = await getManifest();
    const entry = manifest.versions.find(v => v.id === id);
    if (!entry) throw new Error(`Версия ${id} не найдена`);

    progress('Метаданные', 0, 1);
    const vdir = path.join(GAME_DIR, 'versions', id);
    const vjson = await fetchJson(entry.url);
    await fsp.mkdir(vdir, { recursive: true });
    await fsp.writeFile(path.join(vdir, `${id}.json`), JSON.stringify(vjson));

    // Список файлов
    const jobs = [];
    const c = vjson.downloads && vjson.downloads.client;
    if (!c) throw new Error('У версии нет клиента для скачивания');
    jobs.push({ url: c.url, dest: path.join(vdir, `${id}.jar`), sha1: c.sha1 });

    for (const lib of vjson.libraries || []) {
      if (!ruleAllows(lib.rules)) continue;
      const d = lib.downloads || {};
      if (d.artifact && d.artifact.url) {
        jobs.push({ url: d.artifact.url, dest: path.join(GAME_DIR, 'libraries', d.artifact.path), sha1: d.artifact.sha1 });
      }
      // Старые версии: natives в classifiers
      if (lib.natives && lib.natives[osName()] && d.classifiers) {
        const key = lib.natives[osName()].replace('${arch}', process.arch === 'x64' ? '64' : '32');
        const cl = d.classifiers[key];
        if (cl) jobs.push({ url: cl.url, dest: path.join(GAME_DIR, 'libraries', cl.path), sha1: cl.sha1 });
      }
    }

    // Ассеты
    const ai = vjson.assetIndex;
    const aiFile = path.join(GAME_DIR, 'assets', 'indexes', `${ai.id}.json`);
    await downloadFile(ai.url, aiFile, ai.sha1);
    const index = JSON.parse(await fsp.readFile(aiFile, 'utf8'));
    const seen = new Set();
    for (const obj of Object.values(index.objects || {})) {
      if (seen.has(obj.hash)) continue;
      seen.add(obj.hash);
      const sub = obj.hash.slice(0, 2);
      const url = `${RESOURCES_URL}/${sub}/${obj.hash}`;
      const dest = path.join(GAME_DIR, 'assets', 'objects', sub, obj.hash);
      jobs.push({ url, dest, sha1: obj.hash });
    }

    let done = 0;
    progress('Файлы игры', 0, jobs.length);
    let lastSent = 0;
    await pool(jobs, 12, async job => {
      await downloadFile(job.url, job.dest, job.sha1);
      done++;
      const now = Date.now();
      if (now - lastSent > 120 || done === jobs.length) { lastSent = now; progress('Файлы игры', done, jobs.length); }
    });

    await fsp.writeFile(path.join(vdir, '.minilauncher-complete'), new Date().toISOString());
    return true;
  }
}

// ---------- Загрузчики: Fabric / Quilt / Forge ----------
const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const MODRINTH = 'https://api.modrinth.com/v2';

function mavenPath(name) {
  // group:artifact:version[:classifier] -> group/path/artifact/version/artifact-version[-classifier].jar
  const [g, a, v, c] = name.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.jar`;
}

async function loaderGameVersions(loader) {
  if (loader === 'fabric') return (await fetchJson(`${FABRIC_META}/versions/game`)).map(v => ({ id: v.version, stable: v.stable }));
  if (loader === 'quilt') return (await fetchJson(`${QUILT_META}/versions/game`)).map(v => ({ id: v.version, stable: v.stable }));
  if (loader === 'forge') {
    const promos = (await fetchJson(FORGE_PROMOS)).promos || {};
    const set = new Set();
    for (const k of Object.keys(promos)) set.add(k.replace(/-(latest|recommended)$/, ''));
    const manifest = await getManifest();
    const order = new Map(manifest.versions.map((v, i) => [v.id, i]));
    return [...set].filter(id => order.has(id)).sort((a, b) => order.get(a) - order.get(b)).map(id => ({ id, stable: true }));
  }
  throw new Error('Неизвестный загрузчик');
}

// Профиль Fabric/Quilt — готовый version.json с inheritsFrom; библиотеки без downloads качаем сами
async function installFabricLike(loader, mc, progress) {
  const base = loader === 'fabric' ? FABRIC_META : QUILT_META;
  const loaders = await fetchJson(`${base}/versions/loader/${encodeURIComponent(mc)}`);
  if (!loaders.length) throw new Error(`Для ${mc} нет загрузчика ${loader}`);
  const pick = loaders.find(l => (l.loader.stable !== false) && !/beta|pre|rc/i.test(l.loader.version)) || loaders[0];
  const lv = pick.loader.version;
  progress('Профиль загрузчика', 0, 1);
  const profile = await fetchJson(`${base}/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`);
  const id = profile.id;
  const vdir = path.join(GAME_DIR, 'versions', id);
  await fsp.mkdir(vdir, { recursive: true });
  await fsp.writeFile(path.join(vdir, `${id}.json`), JSON.stringify(profile));

  const jobs = [];
  for (const lib of profile.libraries || []) {
    if (lib.downloads && lib.downloads.artifact) {
      const a = lib.downloads.artifact;
      jobs.push({ url: a.url, dest: path.join(GAME_DIR, 'libraries', a.path), sha1: a.sha1 });
    } else if (lib.name) {
      const p = mavenPath(lib.name);
      const baseUrl = (lib.url || 'https://libraries.minecraftforge.net/').replace(/\/?$/, '/');
      jobs.push({ url: baseUrl + p, dest: path.join(GAME_DIR, 'libraries', p), sha1: lib.sha1 });
    }
  }
  let done = 0;
  progress('Библиотеки загрузчика', 0, jobs.length);
  await pool(jobs, 8, async j => { await downloadFile(j.url, j.dest, j.sha1); progress('Библиотеки загрузчика', ++done, jobs.length); });
  await fsp.writeFile(path.join(vdir, '.minilauncher-complete'), new Date().toISOString());
  return id;
}

// Forge: запускаем официальный installer в headless-режиме
async function installForge(mc, progress) {
  const promos = (await fetchJson(FORGE_PROMOS)).promos || {};
  const fv = promos[`${mc}-recommended`] || promos[`${mc}-latest`];
  if (!fv) throw new Error(`Forge для ${mc} не найден`);
  const full = `${mc}-${fv}`;
  const installer = path.join(DATA_DIR, 'installers', `forge-${full}-installer.jar`);
  progress('Скачиваю установщик Forge', 0, 1);
  await downloadFile(`${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`, installer);

  const forgeJava = javaAny();
  const javaVer = await checkJava(forgeJava);
  if (!javaVer) throw new Error('Для установки Forge нужна Java — укажите её в настройках.');

  // Установщик ожидает launcher_profiles.json в папке игры
  const lp = path.join(GAME_DIR, 'launcher_profiles.json');
  if (!(await exists(lp))) await fsp.writeFile(lp, JSON.stringify({ profiles: {}, selectedProfile: null }));

  const before = new Set((await installedVersions()).map(v => v.id));
  progress('Установка Forge (может занять несколько минут)', 0, 0);
  await new Promise((resolve, reject) => {
    const p = spawn(forgeJava, ['-jar', installer, '--installClient', GAME_DIR], { cwd: GAME_DIR, windowsHide: true });
    let tail = '';
    const onData = d => { const s = String(d); tail = (tail + s).slice(-3000); send('game:log', '[forge] ' + s.trimEnd()); };
    p.stdout.on('data', onData); p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve() : reject(new Error('Установщик Forge завершился с ошибкой. Подробности — во вкладке «Консоль».')));
  });
  const after = await installedVersions();
  const created = after.find(v => !before.has(v.id) && v.loader === 'forge') || after.find(v => v.loader === 'forge' && v.id.includes(fv));
  if (!created) throw new Error('Forge установлен, но версия не найдена');
  await fsp.writeFile(path.join(GAME_DIR, 'versions', created.id, '.minilauncher-complete'), new Date().toISOString());
  return created.id;
}

// ---------- Моды (Modrinth) ----------
async function modrinthInstall(slug, mc, loader, modsDir, seen = new Set(), progress) {
  if (seen.has(slug)) return [];
  seen.add(slug);
  const q = `game_versions=${encodeURIComponent(JSON.stringify([mc]))}&loaders=${encodeURIComponent(JSON.stringify([].concat(loader)))}`;
  const versions = await fetchJson(`${MODRINTH}/project/${slug}/version?${q}`);
  if (!versions.length) throw new Error(`Мод «${slug}» не поддерживает ${mc} на ${loader}`);
  const v = versions.find(x => x.version_type === 'release') || versions[0];
  const file = v.files.find(f => f.primary) || v.files[0];
  await fsp.mkdir(modsDir, { recursive: true });
  progress && progress(`Мод ${slug}`, 0, 1);
  await downloadFile(file.url, path.join(modsDir, file.filename), file.hashes && file.hashes.sha1);
  const names = [file.filename];
  for (const dep of v.dependencies || []) {
    if (dep.dependency_type === 'required' && dep.project_id) {
      try { names.push(...await modrinthInstall(dep.project_id, mc, loader, modsDir, seen, progress)); } catch (_) { /* зависимость недоступна */ }
    }
  }
  return names;
}

// Sodium работает на Fabric; для Forge используем его порт Embeddium
const PERF_MOD = { fabric: ['sodium', 'fabric'], quilt: ['sodium', 'fabric'], forge: ['embeddium', 'forge'] };

async function installLoader({ loader, mc, withSodium }) {
  return withLock(async () => {
    const key = `${loader}:${mc}`;
    const progress = progressFor(key);
    // 1) ванильная база
    const have = (await installedVersions()).some(v => v.id === mc && v.loader === 'vanilla');
    if (!have) await installVanilla(mc, progress);
    // 2) загрузчик
    const id = loader === 'forge' ? await installForge(mc, progress) : await installFabricLike(loader, mc, progress);
    // 3) мод производительности
    if (withSodium && PERF_MOD[loader]) {
      const [slug, ml] = PERF_MOD[loader];
      const dir = path.join(GAME_DIR, 'instances', id, 'mods');
      try {
        await modrinthInstall(slug, mc, ml, dir, new Set(), progress);
      } catch (e) { send('game:log', `[mods] ${e.message}`); return { id, warning: e.message }; }
    }
    return { id };
  });
}

// ---------- Java ----------
// Корень установки: рядом с MiniLauncher.exe (в режиме разработки — папка проекта)
function installRoot() { return app.isPackaged ? path.dirname(process.execPath) : __dirname; }
function bundledList() { return javaUtils.listBundled(path.join(installRoot(), 'runtime')); }

// Какую Java использовать: свою из настроек → встроенную под версию игры → системную
function javaFor(versionId) {
  if (config.javaPath) return { bin: config.javaPath, source: 'custom', required: null };
  const required = versionId ? javaUtils.requiredMajor(path.join(GAME_DIR, 'versions'), versionId) : 8;
  const b = javaUtils.pickBundled(bundledList(), required);
  if (b) return { bin: b.bin, source: 'bundled', major: b.major, required };
  return { bin: 'java', source: 'system', required };
}
// Для установщика Forge подходит любая современная Java — берём самую новую встроенную
function javaAny() {
  if (config.javaPath) return config.javaPath;
  const list = bundledList();
  const best = list.filter(j => j.major >= 17)[0] || list[list.length - 1];
  return best ? best.bin : 'java';
}
function checkJava(bin) {
  return new Promise(resolve => {
    execFile(bin, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "([^"]+)"/.exec(String(stderr || stdout));
      resolve(m ? m[1] : 'unknown');
    });
  });
}

// ---------- Профили ----------
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function addProfile(p) {
  const existing = config.profiles.find(x => x.type === p.type && x.name.toLowerCase() === p.name.toLowerCase());
  if (existing) { Object.assign(existing, p, { id: existing.id }); config.selectedProfile = existing.id; }
  else { p.id = crypto.randomUUID(); config.profiles.push(p); config.selectedProfile = p.id; }
  saveConfig();
}

// Окно входа Microsoft — страница самой Microsoft, поэтому оставляем системную рамку, но без меню и с нашей иконкой
const MS_WINDOW = {
  width: 520, height: 700, resizable: false, autoHideMenuBar: true, title: 'Вход в Microsoft',
  backgroundColor: '#ffffff', icon: path.join(__dirname, 'assets', 'icon.png'),
};

async function microsoftLogin() {
  const { Auth } = require('msmc');
  const authManager = new Auth('select_account');
  const xbox = await authManager.launch('electron', MS_WINDOW);
  const mc = await xbox.getMinecraft();
  const profile = mc.profile || {};
  const refresh = typeof xbox.save === 'function' ? xbox.save() : null;
  addProfile({
    type: 'microsoft',
    name: profile.name || (mc.mclc().name),
    uuid: profile.id || mc.mclc().uuid,
    refresh: sealToken(typeof refresh === 'string' ? refresh : JSON.stringify(refresh)),
  });
}

async function authFor(profile) {
  if (profile.type === 'offline') {
    return {
      access_token: profile.uuid, client_token: profile.uuid,
      uuid: profile.uuid, name: profile.name,
      user_properties: '{}', meta: { type: 'mojang', demo: false },
    };
  }
  const { Auth } = require('msmc');
  const authManager = new Auth('select_account');
  let xbox;
  try {
    const saved = openToken(profile.refresh);
    let token = saved;
    try { token = JSON.parse(saved); } catch (_) { /* строка */ }
    xbox = await authManager.refresh(token);
  } catch (e) {
    // сессия истекла — просим войти заново
    xbox = await authManager.launch('electron', MS_WINDOW);
  }
  const mc = await xbox.getMinecraft();
  if (typeof xbox.save === 'function') {
    const r = xbox.save();
    profile.refresh = sealToken(typeof r === 'string' ? r : JSON.stringify(r));
    saveConfig();
  }
  return mc.mclc();
}

// ---------- Запуск игры ----------
let launcher = null;
let gameRunning = false;
let gameProc = null;

async function play({ versionId, profileId, server }) {
  if (gameRunning) throw new Error('Игра уже запущена');
  const profile = config.profiles.find(p => p.id === profileId);
  if (!profile) throw new Error('Выберите или создайте профиль');
  const ver = (await installedVersions()).find(v => v.id === versionId);
  if (!ver) throw new Error('Эта версия не скачана');

  const java = javaFor(versionId);
  const javaVer = await checkJava(java.bin);
  if (!javaVer) {
    throw new Error(java.source === 'custom'
      ? 'Java по указанному в настройках пути не запускается.'
      : `Не найдена Java ${java.required}+. Переустановите MiniLauncher или укажите Java в настройках.`);
  }
  send('game:log', `[java] ${java.source === 'bundled' ? 'встроенная Java ' + java.major : java.source === 'custom' ? 'Java из настроек' : 'системная Java'} ${javaVer} (нужна ${java.required || '—'}+)`);

  send('game:state', { state: 'starting' });
  const authorization = await authFor(profile);

  const vjson = JSON.parse(await fsp.readFile(path.join(GAME_DIR, 'versions', versionId, `${versionId}.json`), 'utf8'));
  const modded = ver.loader !== 'vanilla';
  if (modded && !(await installedVersions()).some(v => v.id === ver.mc && v.loader === 'vanilla')) {
    send('game:state', { state: 'idle' });
    throw new Error(`Для этой сборки нужна ванильная версия ${ver.mc}. Скачайте её во вкладке «Версии».`);
  }
  const gameDirectory = gameDirFor(ver);
  await fsp.mkdir(gameDirectory, { recursive: true });
  await applySkinPack(profile, gameDirectory, ver.mc);

  const jvmArgs = String(config.jvmArgs || '').split(/\s+/).filter(Boolean);
  const winOpt = config.fullscreen ? { fullscreen: true } : (config.winW > 0 && config.winH > 0 ? { width: config.winW, height: config.winH } : null);

  let srvOpt = null;
  if (server && server.address) {
    const a = serverPing.parseAddress(server.address);
    if (a) srvOpt = { host: a.host, port: String(a.port) };
  }
  const startedAt = Date.now();
  launcher = new Client();
  launcher.on('debug', m => send('game:log', String(m)));
  launcher.on('data', m => send('game:log', String(m)));
  launcher.on('progress', p => send('game:log', `[progress] ${p.type} ${p.task}/${p.total}`));
  launcher.on('close', code => {
    gameRunning = false; gameProc = null;
    recordPlay(versionId, Date.now() - startedAt);
    send('game:log', `Игра завершена (код ${code})`);
    send('game:state', { state: 'idle' });
    if (win && !win.isDestroyed()) { win.show(); }
  });

  gameRunning = true;
  let proc;
  try { proc = await launcher.launch({
    authorization,
    root: GAME_DIR,
    javaPath: java.bin,
    // Для Fabric/Quilt/Forge: number — ванильная база (оттуда jar и ассеты),
    // custom — имя профиля загрузчика (оттуда mainClass и библиотеки)
    version: modded
      ? { number: ver.mc, type: vjson.type || 'release', custom: versionId }
      : { number: versionId, type: vjson.type || 'release' },
    memory: { max: `${config.ramGb}G`, min: '1G' },
    overrides: { gameDirectory },
    ...(srvOpt ? { server: srvOpt } : {}),
    ...(jvmArgs.length ? { customArgs: jvmArgs } : {}),
    ...(winOpt ? { window: winOpt } : {}),
  }); } catch (e) { gameRunning = false; send('game:state', { state: 'idle' }); throw e; }
  if (!proc) { gameRunning = false; send('game:state', { state: 'idle' }); throw new Error('Не удалось запустить процесс игры'); }
  gameProc = proc;

  send('game:state', { state: 'running' });
  config.selectedVersion = versionId;
  config.selectedProfile = profileId;
  saveConfig();
  if (config.closeOnLaunch && win) win.hide();
  return true;
}

// Офлайн-скин в самой игре: локальный ресурспак подменяет стандартные скины (виден только вам).
// Для других профилей и без скина — убираем наш пак, чтобы он не «залипал».
const SKIN_PACK = 'MiniLauncherSkin.zip';
async function applySkinPack(profile, gameDirectory, mc) {
  const packPath = path.join(gameDirectory, 'resourcepacks', SKIN_PACK);
  const optPath = path.join(gameDirectory, 'options.txt');
  const entry = 'file/' + SKIN_PACK;
  try {
    const want = profile.type === 'offline' && await exists(path.join(SKIN_DIR, profile.id + '.png'));
    let opt = '';
    try { opt = await fsp.readFile(optPath, 'utf8'); } catch { /* options.txt появится после первого запуска */ }
    if (want) {
      const read = async v => {
        const f = path.join(SKIN_DIR, `${profile.id}.${v}.png`);
        return fsp.readFile((await exists(f)) ? f : path.join(SKIN_DIR, profile.id + '.png'));
      };
      await fsp.mkdir(path.dirname(packPath), { recursive: true });
      await fsp.writeFile(packPath, skinUtils.buildSkinPack(await read('wide'), await read('slim'), mc));
      const next = skinUtils.enablePack(opt, entry);
      if (next !== opt) await fsp.writeFile(optPath, next);
      send('game:log', '[skin] офлайн-скин включён (ресурспак MiniLauncherSkin)');
    } else if (await exists(packPath)) {
      await fsp.rm(packPath, { force: true });
      const next = skinUtils.disablePack(opt, entry);
      if (next !== opt) await fsp.writeFile(optPath, next);
    }
  } catch (e) { send('game:log', `[skin] не удалось применить скин: ${e.message}`); }   // скин не должен мешать запуску
}

function recordPlay(versionId, ms) {
  if (ms < 5000) return;                       // мгновенные падения не считаем игрой
  const st = config.stats;
  st.totalMs += ms; st.sessions += 1;
  st.byVersion[versionId] = (st.byVersion[versionId] || 0) + ms;
  st.last = { versionId, at: Date.now(), ms };
  saveConfig();
  send('stats:update', st);
}

function stopGame() {
  if (!gameProc) throw new Error('Игра не запущена');
  const proc = gameProc;
  proc.kill();                              // мягкое завершение
  setTimeout(() => { try { if (gameProc === proc) proc.kill('SIGKILL'); } catch (_) {} }, 4000);
  send('game:log', 'Завершение игры по запросу пользователя…');
  return true;
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg) }; }
    catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

handle('state:get', async () => publicState());
handle('versions:remote', async () => {
  const m = await getManifest();
  return m.versions.map(v => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
});
handle('versions:installed', async () => installedVersions());
handle('versions:download', async id => { await downloadVersion(id); return true; });
handle('versions:delete', async id => {
  if (gameRunning) throw new Error('Закройте игру');
  await fsp.rm(path.join(GAME_DIR, 'versions', id), { recursive: true, force: true });
  if (config.selectedVersion === id) { config.selectedVersion = null; saveConfig(); }
  return true;
});
handle('profiles:addOffline', async name => {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  addProfile({ type: 'offline', name, uuid: offlineUuid(name) });
  return publicState();
});
handle('profiles:addMicrosoft', async () => { await microsoftLogin(); return publicState(); });
handle('profiles:remove', async id => {
  config.profiles = config.profiles.filter(p => p.id !== id);
  delete config.localSkins[id];                       // локальные скины удалённого профиля больше не нужны
  for (const suffix of ['', '.wide', '.slim']) await fsp.rm(path.join(DATA_DIR, 'skins', `${id}${suffix}.png`), { force: true }).catch(() => {});
  if (config.selectedProfile === id) config.selectedProfile = config.profiles[0] ? config.profiles[0].id : null;
  saveConfig();
  return publicState();
});
handle('profiles:select', async id => { config.selectedProfile = id; saveConfig(); return true; });
handle('version:select', async id => { config.selectedVersion = id; saveConfig(); return true; });
handle('settings:set', async s => {
  if (s.ramGb) config.ramGb = Math.min(Math.max(1, Number(s.ramGb)), 64);
  if (typeof s.javaPath === 'string') config.javaPath = s.javaPath.trim();
  if (typeof s.closeOnLaunch === 'boolean') config.closeOnLaunch = s.closeOnLaunch;
  if (typeof s.accent === 'string' && /^#[0-9a-f]{6}$/i.test(s.accent)) config.accent = s.accent.toLowerCase();
  if (typeof s.reduceMotion === 'boolean') config.reduceMotion = s.reduceMotion;
  if (typeof s.jvmArgs === 'string') config.jvmArgs = s.jvmArgs.replace(/[\r\n]+/g, ' ').trim().slice(0, 600);
  const dim = v => Math.min(Math.max(0, Math.round(Number(v) || 0)), 7680);
  if (s.winW !== undefined) config.winW = dim(s.winW);
  if (s.winH !== undefined) config.winH = dim(s.winH);
  if (typeof s.fullscreen === 'boolean') config.fullscreen = s.fullscreen;
  saveConfig();
  return publicState();
});
handle('java:check', async () => {
  const bundled = bundledList().map(j => j.major);
  const bin = config.javaPath || 'java';
  return { version: await checkJava(bin), bin, bundled, custom: !!config.javaPath };
});
handle('java:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Выберите java / javaw' });
  return r.canceled ? null : r.filePaths[0];
});
handle('game:play', play);
handle('files:open', async versionId => {
  const ver = versionId && (await installedVersions()).find(v => v.id === versionId);
  const dir = ver ? gameDirFor(ver) : GAME_DIR;
  await fsp.mkdir(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return true;
});
handle('game:stop', async () => stopGame());
handle('loaders:versions', async loader => loaderGameVersions(loader));
handle('loaders:install', async args => installLoader(args));
handle('files:openVersion', async id => {
  const err = await shell.openPath(path.join(GAME_DIR, 'versions', id));
  if (err) throw new Error(err);
  return true;
});

// ---------- Серверы ----------
handle('servers:list', async () => config.servers);
handle('servers:add', async ({ name, address }) => {
  name = String(name || '').trim().slice(0, 40);
  address = String(address || '').trim();
  if (!name) throw new Error('Введите название сервера');
  if (!serverPing.parseAddress(address)) throw new Error('Неверный адрес. Пример: mc.example.com или 1.2.3.4:25565');
  if (config.servers.length >= 40) throw new Error('Слишком много серверов (максимум 40)');
  config.servers.push({ id: crypto.randomUUID(), name, address });
  saveConfig();
  return config.servers;
});
handle('servers:remove', async id => { config.servers = config.servers.filter(s => s.id !== id); saveConfig(); return config.servers; });
handle('servers:ping', async id => {
  const s = config.servers.find(x => x.id === id);
  if (!s) throw new Error('Сервер не найден');
  return serverPing.pingServer(s.address, 4000);
});

// ---------- Скины ----------
const SKIN_DIR = path.join(DATA_DIR, 'skins');
const skinCache = new Map();      // profileId -> { at, data } (полный профиль, нужен вход)
const avatarCache = new Map();    // profileId -> { at, data } (публичный, без входа)
const profileById = id => { const p = config.profiles.find(x => x.id === id); if (!p) throw new Error('Профиль не найден'); return p; };
function dataUrlToBuffer(u) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''));
  if (!m) throw new Error('Ожидался PNG-файл');
  return Buffer.from(m[1], 'base64');
}
async function localSkin(profile) {
  const f = path.join(SKIN_DIR, profile.id + '.png');
  if (!(await exists(f))) return { name: profile.name, slim: false, skin: null, local: true };
  return { name: profile.name, slim: !!(config.localSkins[profile.id] || {}).slim, skin: 'data:image/png;base64,' + (await fsp.readFile(f)).toString('base64'), local: true };
}
async function skinOf(profile, fresh) {
  if (profile.type === 'offline') return localSkin(profile);
  const c = skinCache.get(profile.id);
  if (c && !fresh && Date.now() - c.at < 5 * 60e3) return c.data;
  const a = await authFor(profile);
  const data = await skins.ownSkin(a.access_token);
  skinCache.set(profile.id, { at: Date.now(), data });
  return data;
}
handle('skins:current', async profileId => skinOf(profileById(profileId)));
// Для аватарок в интерфейсе: никогда не требует входа и не бросает ошибок
handle('skins:avatar', async profileId => {
  try {
    const p = profileById(profileId);
    if (p.type === 'offline') return await localSkin(p);
    const c = avatarCache.get(p.id);
    if (c && Date.now() - c.at < 10 * 60e3) return c.data;
    const data = await skins.byUuid(p.uuid);
    avatarCache.set(p.id, { at: Date.now(), data });
    return data;
  } catch { return null; }
});
handle('skins:lookup', async name => skins.lookupByName(String(name || '').trim()));
handle('skins:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Выберите скин (PNG 64×64)', properties: ['openFile'], filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return null;
  const buf = await fsp.readFile(r.filePaths[0]);
  skins.assertSkinPng(buf);
  return { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), name: path.basename(r.filePaths[0]) };
});
handle('skins:apply', async ({ profileId, dataUrl, slim, wide, slimSkin }) => {
  const p = profileById(profileId);
  const buf = dataUrlToBuffer(dataUrl);
  skins.assertSkinPng(buf);
  avatarCache.delete(p.id);
  if (p.type === 'offline') {
    // варианты под обычные и тонкие руки (делает интерфейс) — нужны для скина внутри игры
    for (const [v, u] of [['wide', wide], ['slim', slimSkin]]) {
      const f = path.join(SKIN_DIR, `${p.id}.${v}.png`);
      await fsp.mkdir(SKIN_DIR, { recursive: true });
      if (u) { const b = dataUrlToBuffer(u); skins.assertSkinPng(b); await fsp.writeFile(f, b); } else await fsp.rm(f, { force: true });
    }
  }
  if (p.type === 'microsoft') {
    const a = await authFor(p);
    await skins.uploadSkin(a.access_token, buf, slim ? 'slim' : 'classic');
    skinCache.delete(p.id);
    return skinOf(p, true);
  }
  await fsp.mkdir(SKIN_DIR, { recursive: true });
  await fsp.writeFile(path.join(SKIN_DIR, p.id + '.png'), buf);
  config.localSkins[p.id] = { slim: !!slim };
  saveConfig();
  return localSkin(p);
});
handle('skins:save', async ({ dataUrl, name }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: (String(name || 'skin').replace(/[^\w.-]/g, '_')) + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled) return false;
  await fsp.writeFile(r.filePath, dataUrlToBuffer(dataUrl));
  return true;
});

// ---------- Моды сборки ----------
async function instanceOf(versionId) {
  const ver = (await installedVersions()).find(v => v.id === versionId);
  if (!ver) throw new Error('Сборка не найдена');
  return ver;
}
const modsDirOf = ver => path.join(gameDirFor(ver), 'mods');
const modFile = f => { if (path.basename(String(f)) !== f || !/\.jar(\.disabled)?$/i.test(f)) throw new Error('Некорректное имя файла'); return f; };
const modLoaders = ver => (ver.loader === 'quilt' ? ['quilt', 'fabric'] : ver.loader);

handle('mods:list', async versionId => {
  const ver = await instanceOf(versionId);
  const dir = modsDirOf(ver);
  const out = { loader: ver.loader, mc: ver.mc, supported: ver.loader !== 'vanilla', dir, files: [] };
  if (!out.supported) return out;
  let names = [];
  try { names = await fsp.readdir(dir); } catch { /* папки ещё нет */ }
  for (const f of names.filter(n => /\.jar(\.disabled)?$/i.test(n)).sort((a, b) => a.localeCompare(b))) {
    const st = await fsp.stat(path.join(dir, f));
    out.files.push({ file: f, enabled: !/\.disabled$/i.test(f), size: st.size });
  }
  return out;
});
handle('mods:toggle', async ({ versionId, file }) => {
  const dir = modsDirOf(await instanceOf(versionId));
  const f = modFile(file);
  const to = /\.disabled$/i.test(f) ? f.replace(/\.disabled$/i, '') : f + '.disabled';
  await fsp.rename(path.join(dir, f), path.join(dir, to));
  return to;
});
handle('mods:remove', async ({ versionId, file }) => {
  const dir = modsDirOf(await instanceOf(versionId));
  await shell.trashItem(path.join(dir, modFile(file)));
  return true;
});
handle('mods:folder', async versionId => {
  const dir = modsDirOf(await instanceOf(versionId));
  await fsp.mkdir(dir, { recursive: true });
  const err = await shell.openPath(dir);
  if (err) throw new Error(err);
  return true;
});
handle('mods:addJar', async versionId => {
  const ver = await instanceOf(versionId);
  if (ver.loader === 'vanilla') throw new Error('Выберите сборку с загрузчиком');
  const r = await dialog.showOpenDialog(win, { title: 'Добавить моды (.jar)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Моды', extensions: ['jar'] }] });
  if (r.canceled) return 0;
  const dir = modsDirOf(ver);
  await fsp.mkdir(dir, { recursive: true });
  for (const f of r.filePaths) await fsp.copyFile(f, path.join(dir, path.basename(f)));
  return r.filePaths.length;
});
handle('mods:search', async ({ versionId, query, offset }) => {
  const ver = await instanceOf(versionId);
  if (ver.loader === 'vanilla') throw new Error('Выберите сборку с загрузчиком (Fabric, Quilt или Forge)');
  const cats = [].concat(modLoaders(ver)).map(c => `categories:${c}`);
  const facets = [[`versions:${ver.mc}`], cats, ['project_type:mod']];
  const q = String(query || '').trim().slice(0, 80);
  const url = `${MODRINTH}/search?query=${encodeURIComponent(q)}&facets=${encodeURIComponent(JSON.stringify(facets))}&limit=20&offset=${Math.max(0, Number(offset) || 0)}&index=${q ? 'relevance' : 'downloads'}`;
  const r = await fetchJson(url);
  return { total: r.total_hits, hits: r.hits.map(h => ({ slug: h.slug, title: h.title, description: h.description, icon: h.icon_url || null, downloads: h.downloads, author: h.author })) };
});
handle('mods:install', async ({ versionId, slug }) => {
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(slug))) throw new Error('Некорректный мод');
  const ver = await instanceOf(versionId);
  if (ver.loader === 'vanilla') throw new Error('Выберите сборку с загрузчиком');
  return modrinthInstall(slug, ver.mc, modLoaders(ver), modsDirOf(ver), new Set(), null);
});

// ---------- Скриншоты ----------
function shotDirs() {
  const list = [{ build: 'vanilla', dir: path.join(GAME_DIR, 'screenshots') }];
  try { for (const n of fs.readdirSync(path.join(GAME_DIR, 'instances'))) list.push({ build: n, dir: path.join(GAME_DIR, 'instances', n, 'screenshots') }); } catch { /* нет сборок */ }
  return list;
}
const isShot = p => { const r = path.resolve(String(p)); return r.startsWith(GAME_DIR + path.sep) && /\.(png|jpe?g)$/i.test(r) && path.basename(path.dirname(r)) === 'screenshots'; };
handle('shots:list', async () => {
  const out = [];
  for (const { build, dir } of shotDirs()) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch { continue; }
    for (const n of names.filter(x => /\.(png|jpe?g)$/i.test(x))) {
      try { const st = await fsp.stat(path.join(dir, n)); out.push({ path: path.join(dir, n), name: n, mtime: st.mtimeMs, size: st.size, build }); } catch { /* файл пропал */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 300);
});
function shotImage(p, maxW, quality) {
  if (!isShot(p)) throw new Error('Недопустимый файл');
  let img = nativeImage.createFromPath(path.resolve(p));
  if (img.isEmpty()) return null;
  const { width } = img.getSize();
  if (width > maxW) img = img.resize({ width: maxW, quality: 'good' });
  return 'data:image/jpeg;base64,' + img.toJPEG(quality).toString('base64');
}
handle('shots:thumb', async p => shotImage(p, 380, 78));
handle('shots:full', async p => shotImage(p, 1800, 88));
handle('shots:reveal', async p => { if (!isShot(p)) throw new Error('Недопустимый файл'); shell.showItemInFolder(path.resolve(p)); return true; });
handle('shots:delete', async p => { if (!isShot(p)) throw new Error('Недопустимый файл'); await shell.trashItem(path.resolve(p)); return true; });
handle('shots:folder', async () => { const d = path.join(GAME_DIR, 'screenshots'); await fsp.mkdir(d, { recursive: true }); const e = await shell.openPath(d); if (e) throw new Error(e); return true; });

// ---------- Обновления лаунчера ----------
// Адрес файла latest.json задаётся в package.json -> minilauncher.updateUrl
// Формат: { "version": "1.2.0", "url": "https://.../MiniLauncher-Setup-1.2.0.exe", "sha256": "<64 hex>", "notes": "..." }
const PKG = require('./package.json');
const UPDATE_URL = (PKG.minilauncher && PKG.minilauncher.updateUrl) || '';
let updating = false;

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function getUpdateManifest() {
  const m = await fetchJson(UPDATE_URL);
  if (!/^\d+\.\d+\.\d+$/.test(String(m.version))) throw new Error('Некорректный файл обновлений');
  if (!/^https:\/\//.test(String(m.url))) throw new Error('Ссылка на обновление должна быть https');
  if (!/^[a-f0-9]{64}$/i.test(String(m.sha256))) throw new Error('В файле обновлений нет контрольной суммы');
  return m;
}
handle('update:check', async () => {
  const current = app.getVersion();
  if (!UPDATE_URL || !app.isPackaged) return { available: false, current };
  try {
    const m = await getUpdateManifest();
    return { available: cmpVer(m.version, current) > 0, current, version: m.version, notes: m.notes || '' };
  } catch (e) {
    return { available: false, current, error: e.message };   // нет сети — не мешаем запуску
  }
});
handle('update:install', async () => {
  if (!app.isPackaged || !UPDATE_URL) throw new Error('Обновление недоступно в этой сборке');
  if (updating) throw new Error('Обновление уже скачивается');
  if (gameRunning) throw new Error('Закройте игру перед обновлением');
  updating = true;
  try {
    const m = await getUpdateManifest();
    const file = path.join(os.tmpdir(), `MiniLauncher-Setup-${m.version}.exe`);
    const res = await fetch(m.url, { headers: { 'User-Agent': 'MiniLauncher/' + app.getVersion() } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const hash = crypto.createHash('sha256');
    const out = fs.createWriteStream(file);
    let got = 0, last = 0;
    for await (const chunk of res.body) {
      hash.update(chunk); got += chunk.length;
      if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
      const now = Date.now();
      if (total && now - last > 150) { last = now; send('update:progress', { done: got, total }); }
    }
    await new Promise((r, j) => out.end(e => e ? j(e) : r()));
    if (hash.digest('hex').toLowerCase() !== m.sha256.toLowerCase()) {
      await fsp.rm(file, { force: true });
      throw new Error('Контрольная сумма не совпала — обновление отменено');
    }
    send('update:progress', { done: total, total });
    // Установщик сам дождётся закрытия лаунчера, заменит файлы и запустит его снова
    spawn(file, ['--update', '--dir', installRoot()], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 400);
    return true;
  } finally { updating = false; }
});

// ---------- Удаление ----------
const UNINSTALL_MODE = process.argv.includes('--uninstall');
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MiniLauncher';

handle('uninstall:info', async () => ({ dir: installRoot(), dataDir: DATA_DIR, version: app.getVersion() }));
handle('uninstall:run', async ({ removeData } = {}) => {
  if (!UNINSTALL_MODE || process.platform !== 'win32') throw new Error('Удаление доступно только из установленной копии');
  const dir = installRoot();
  if (!fs.existsSync(path.join(dir, 'install.json'))) throw new Error('Это не установленная копия MiniLauncher — удалять нечего');
  if (dir.length < 8) throw new Error('Подозрительный путь установки, удаление остановлено');

  const links = [
    path.join(app.getPath('desktop'), 'MiniLauncher.lnk'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MiniLauncher.lnk'),
  ];
  for (const l of links) await fsp.rm(l, { force: true });
  await new Promise(r => execFile('reg', ['delete', REG_KEY, '/f'], { windowsHide: true }, () => r()));

  // Файлы заняты запущенным exe — удаляем отдельным процессом после выхода
  let line = `ping -n 3 127.0.0.1 >nul & rmdir /s /q "${dir}"`;
  if (removeData) line += ` & rmdir /s /q "${DATA_DIR}"`;
  spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
  setTimeout(() => app.quit(), 600);
  return true;
});

// Управление собственным окном (без системной рамки)
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => { if (!win) return; win.isMaximized() ? win.unmaximize() : win.maximize(); });
ipcMain.on('win:close', () => win && win.close());

// ---------- Окно ----------
const WEB_PREFS = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true };

function createWindow() {
  const b = config.bounds || {};
  const sane = n => Number.isFinite(n) && n >= 640 && n <= 7680;
  win = new BrowserWindow({
    width: sane(b.width) ? b.width : 1240, height: sane(b.height) ? b.height : 780, minWidth: 1020, minHeight: 660,
    frame: false,                       // собственная рамка вместо системной
    show: false,                        // покажем, когда интерфейс готов — без белой вспышки
    backgroundColor: '#0a0a0c',
    title: 'MiniLauncher',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: WEB_PREFS,
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { if (b.maximized) win.maximize(); win.show(); });
  setTimeout(() => { if (win && !win.isDestroyed() && !win.isVisible()) win.show(); }, 4000);   // подстраховка
  win.on('close', () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const n = win.getNormalBounds();
    config.bounds = { width: n.width, height: n.height, maximized: win.isMaximized() };
    try { saveConfig(); } catch { /* не критично */ }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
}

function createUninstallWindow() {
  win = new BrowserWindow({
    width: 540, height: 430, resizable: false, maximizable: false,
    frame: false, backgroundColor: '#0b0b0d', title: 'Удаление MiniLauncher',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: WEB_PREFS,
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'uninstall.html'));
  win.webContents.on('will-navigate', e => e.preventDefault());
}

app.whenReady().then(() => {
  if (UNINSTALL_MODE) { createUninstallWindow(); return; }
  loadConfig();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
