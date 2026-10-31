'use strict';
// Собирает payload.zip: готовый лаунчер + встроенные Java + тексты соглашений.
//   node scripts/build-payload.js                 — всё с нуля
//   node scripts/build-payload.js --skip-launcher — не пересобирать лаунчер (взять готовый dist/win-unpacked)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { extractZip, createZip } = require('../lib/zip');

const INSTALLER = path.resolve(__dirname, '..');
const LAUNCHER = path.resolve(INSTALLER, '..');
const SRC = path.join(INSTALLER, 'payload-src');
const OUT = path.join(INSTALLER, 'payload', 'payload.zip');
const CACHE = path.join(INSTALLER, '.cache', 'java');
const args = process.argv.slice(2);

const log = m => console.log('▸ ' + m);
const mb = n => (n / 1048576).toFixed(1) + ' МБ';

function run(cmd, cwd) {
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`Команда завершилась с ошибкой: ${cmd}`);
}

async function download(url, dest, sha256) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': 'MiniLauncher-build' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let got = 0, last = 0;
  for await (const chunk of res.body) {
    hash.update(chunk); got += chunk.length;
    if (!out.write(chunk)) await new Promise(r => out.once('drain', r));
    if (Date.now() - last > 500 && total) { last = Date.now(); process.stdout.write(`\r    ${mb(got)} / ${mb(total)}   `); }
  }
  await new Promise((r, j) => out.end(e => (e ? j(e) : r())));
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
  if (sha256 && hash.digest('hex').toLowerCase() !== sha256.toLowerCase()) {
    fs.rmSync(dest, { force: true });
    throw new Error('Контрольная сумма не совпала: ' + url);
  }
}

// Последний релиз Temurin JRE для Windows x64 (официальный API Adoptium)
async function temurin(major) {
  const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Adoptium API: HTTP ${r.status} для Java ${major}`);
  const list = await r.json();
  const item = list.find(x => x.binary && x.binary.package && /\.zip$/i.test(x.binary.package.name));
  if (!item) throw new Error(`Для Java ${major} нет zip-сборки JRE x64`);
  const p = item.binary.package;
  return { release: item.release_name, link: p.link, name: p.name, sha256: p.checksum, size: p.size };
}

(async () => {
  const launcherPkg = JSON.parse(fs.readFileSync(path.join(LAUNCHER, 'package.json'), 'utf8'));
  const javas = JSON.parse(fs.readFileSync(path.join(INSTALLER, 'java-versions.json'), 'utf8')).versions;
  log(`Лаунчер ${launcherPkg.version}, Java: ${javas.join(', ')}`);

  // 1. Сборка лаунчера
  const unpacked = path.join(LAUNCHER, 'dist', 'win-unpacked');
  if (!args.includes('--skip-launcher')) {
    log('Собираю лаунчер (electron-builder)…');
    if (!fs.existsSync(path.join(LAUNCHER, 'node_modules'))) run('npm install', LAUNCHER);
    run('npm run pack', LAUNCHER);
  }
  if (!fs.existsSync(path.join(unpacked, 'MiniLauncher.exe'))) throw new Error(`Не найден ${unpacked}\\MiniLauncher.exe — соберите лаунчер (npm run pack в папке проекта)`);

  // 2. Чистая папка payload-src
  log('Готовлю payload-src…');
  fs.rmSync(SRC, { recursive: true, force: true });
  fs.cpSync(unpacked, SRC, { recursive: true });

  // 3. Java
  const runtimeInfo = {};
  for (const major of javas) {
    const t = await temurin(major);
    const zip = path.join(CACHE, t.name);
    if (fs.existsSync(zip)) log(`Java ${major}: ${t.release} — из кэша`);
    else { log(`Java ${major}: скачиваю ${t.release} (${mb(t.size)})`); await download(t.link, zip, t.sha256); }
    const dest = path.join(SRC, 'runtime', `java${major}`);
    await extractZip(zip, dest, { strip: 1 });      // внутри архива одна верхняя папка jdk-…-jre
    if (!fs.existsSync(path.join(dest, 'bin', 'java.exe'))) throw new Error(`В Java ${major} нет bin/java.exe`);
    runtimeInfo[major] = { release: t.release, sha256: t.sha256, source: 'Eclipse Temurin (Adoptium)' };
  }
  fs.mkdirSync(path.join(SRC, 'runtime'), { recursive: true });
  fs.writeFileSync(path.join(SRC, 'runtime', 'runtime.json'), JSON.stringify(runtimeInfo, null, 2));

  // 4. Соглашения, метка версии
  fs.cpSync(path.join(INSTALLER, 'legal'), path.join(SRC, 'legal'), { recursive: true });
  fs.writeFileSync(path.join(SRC, 'install.json'), JSON.stringify({ version: launcherPkg.version }, null, 2));

  // 5. Упаковка
  log('Упаковываю payload.zip…');
  fs.rmSync(OUT, { force: true });
  let n = 0;
  const files = await createZip(SRC, OUT, c => { n = c; if (c % 400 === 0) process.stdout.write(`\r    файлов: ${c}   `); });
  process.stdout.write('\r' + ' '.repeat(40) + '\r');
  const size = fs.statSync(OUT).size;

  // версия установщика = версия лаунчера (она попадёт в имя .exe)
  const ip = path.join(INSTALLER, 'package.json');
  const ipkg = JSON.parse(fs.readFileSync(ip, 'utf8'));
  if (ipkg.version !== launcherPkg.version) { ipkg.version = launcherPkg.version; fs.writeFileSync(ip, JSON.stringify(ipkg, null, 2) + '\n'); }

  fs.rmSync(SRC, { recursive: true, force: true });
  log(`Готово: ${OUT}`);
  console.log(`  файлов: ${files}, размер: ${mb(size)}`);
  console.log('  Дальше: npm run dist — соберёт MiniLauncher-Setup-' + launcherPkg.version + '.exe в папке out\\');
})().catch(e => { console.error('\n✖ ' + e.message); process.exit(1); });
