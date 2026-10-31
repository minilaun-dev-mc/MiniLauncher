'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { execFile, spawn } = require('child_process');
const { extractZip, zipInfo } = require('./lib/zip');

const APP_EXE = 'MiniLauncher.exe';
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MiniLauncher';

// ---------- Режим запуска ----------
// MiniLauncher-Setup.exe                      — обычная установка
// MiniLauncher-Setup.exe --update --dir <путь> — обновление (запускает сам лаунчер)
const argv = process.argv;
const UPDATE = argv.includes('--update');
const argDir = (() => { const i = argv.indexOf('--dir'); return i > 0 ? argv[i + 1] : null; })();
const defaultDir = path.join(process.env.LOCALAPPDATA || app.getPath('home'), 'Programs', 'MiniLauncher');

let win = null;
let busy = false;

if (!app.requestSingleInstanceLock()) app.quit();

function payloadPath() {
  return app.isPackaged ? path.join(process.resourcesPath, 'payload.zip') : path.join(__dirname, 'payload', 'payload.zip');
}
function readLegal(name) {
  try { return fs.readFileSync(path.join(__dirname, 'legal', name), 'utf8'); } catch { return 'Текст недоступен.'; }
}
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const exists = async p => { try { await fsp.access(p); return true; } catch { return false; } };

async function freeBytes(dir) {
  let p = path.resolve(dir);
  while (!(await exists(p))) { const up = path.dirname(p); if (up === p) break; p = up; }
  try { const s = await fsp.statfs(p); return s.bavail * s.bsize; } catch { return null; }
}

// В чужую непустую папку не ставим — создаём внутри неё подпапку MiniLauncher.
// Папка с нашим install.json (обновление/переустановка) считается своей.
async function resolveTarget(dir) {
  const target = path.resolve(dir);
  if (!(await exists(target))) return { target, fresh: true };
  const files = await fsp.readdir(target);
  if (!files.length) return { target, fresh: true };
  if (await exists(path.join(target, 'install.json'))) return { target, fresh: false };
  return { target: path.join(target, 'MiniLauncher'), fresh: true, nested: true };
}

function isLauncherRunning() {
  return new Promise(resolve => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${APP_EXE}`, '/NH'], { windowsHide: true }, (err, out) =>
      resolve(!err && out.toLowerCase().includes(APP_EXE.toLowerCase())));
  });
}
async function waitLauncherExit(ms = 20000) {
  if (process.platform !== 'win32') return;
  const t = Date.now();
  while (await isLauncherRunning()) {
    if (Date.now() - t > ms) throw new Error('MiniLauncher не закрылся. Закройте его и повторите установку.');
    await sleep(400);
  }
}

// Чистим старые файлы приложения перед обновлением (данные игры лежат в %APPDATA%, их не трогаем)
async function clearInstallDir(dir) {
  for (const name of await fsp.readdir(dir)) await fsp.rm(path.join(dir, name), { recursive: true, force: true });
}

function writeShortcut(file, exe, desc) {
  try { return shell.writeShortcutLink(file, 'create', { target: exe, cwd: path.dirname(exe), icon: exe, iconIndex: 0, description: desc }); }
  catch { return false; }
}
function regAdd(name, type, value) {
  return new Promise(res => execFile('reg', ['add', REG_KEY, '/v', name, '/t', type, '/d', String(value), '/f'], { windowsHide: true }, () => res()));
}
async function registerUninstall(dir, version, sizeKb) {
  const exe = path.join(dir, APP_EXE);
  await regAdd('DisplayName', 'REG_SZ', 'MiniLauncher');
  await regAdd('DisplayVersion', 'REG_SZ', version || '');
  await regAdd('Publisher', 'REG_SZ', 'MiniLauncher');
  await regAdd('DisplayIcon', 'REG_SZ', exe);
  await regAdd('InstallLocation', 'REG_SZ', dir);
  await regAdd('UninstallString', 'REG_SZ', `"${exe}" --uninstall`);
  await regAdd('NoModify', 'REG_DWORD', 1);
  await regAdd('NoRepair', 'REG_DWORD', 1);
  await regAdd('EstimatedSize', 'REG_DWORD', sizeKb);
}

// ---------- Установка ----------
async function install({ dir, desktop, startMenu }) {
  if (busy) throw new Error('Установка уже идёт');
  busy = true;
  let createdDir = null;
  // Electron считает любой файл *.asar архивом и падает с «Invalid package» при записи resources\app.asar лаунчера.
  // На время установки отключаем эту подмену в fs (собственные файлы установщика к этому моменту уже прочитаны).
  process.noAsar = true;
  try {
    const payload = payloadPath();
    if (!(await exists(payload))) throw new Error('В установщике нет данных для установки (payload.zip). Соберите его через npm run build.');
    const info = await zipInfo(payload);

    send('install:progress', { percent: 0, stage: UPDATE ? 'Ждём закрытия лаунчера…' : 'Подготовка…' });
    if (UPDATE) await waitLauncherExit();

    const { target, fresh } = await resolveTarget(dir);
    const free = await freeBytes(target);
    if (free !== null && free < info.bytes * 1.1) throw new Error('Недостаточно места на диске');

    if (fresh) { await fsp.mkdir(target, { recursive: true }); createdDir = target; }
    else await clearInstallDir(target);

    await extractZip(payload, target, {
      onProgress: ({ done, total, file }) => send('install:progress', { percent: Math.min(98, Math.round((done / total) * 98)), stage: 'Копирование файлов', file }),
    });

    const exe = path.join(target, APP_EXE);
    if (!(await exists(exe))) throw new Error(`После распаковки не найден ${APP_EXE}`);

    let version = '';
    try { version = JSON.parse(await fsp.readFile(path.join(target, 'install.json'), 'utf8')).version || ''; } catch { /* нет метки */ }
    await fsp.writeFile(path.join(target, 'install.json'), JSON.stringify({ version, installedAt: new Date().toISOString() }, null, 2));

    send('install:progress', { percent: 99, stage: 'Ярлыки и регистрация' });
    if (process.platform === 'win32') {
      if (desktop || UPDATE) writeShortcut(path.join(app.getPath('desktop'), 'MiniLauncher.lnk'), exe, 'MiniLauncher — лаунчер Minecraft');
      if (startMenu || UPDATE) {
        const sm = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
        await fsp.mkdir(sm, { recursive: true });
        writeShortcut(path.join(sm, 'MiniLauncher.lnk'), exe, 'MiniLauncher — лаунчер Minecraft');
      }
      await registerUninstall(target, version, Math.round(info.bytes / 1024));
    }
    send('install:progress', { percent: 100, stage: 'Готово' });
    return { dir: target, exe, version };
  } catch (e) {
    if (createdDir) await fsp.rm(createdDir, { recursive: true, force: true }).catch(() => {});   // откат неудачной установки
    throw e;
  } finally { busy = false; process.noAsar = false; }
}

function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, arg) => {
    try { return { ok: true, data: await fn(arg) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

handle('init:get', async () => {
  const payload = payloadPath();
  const has = await exists(payload);
  let info = { bytes: 0 };
  let version = '';
  if (has) { info = await zipInfo(payload); }
  try { version = require('./package.json').version; } catch { /* dev */ }
  const dir = argDir || defaultDir;
  return {
    update: UPDATE, dir, hasPayload: has, bytes: info.bytes, version,
    free: await freeBytes(dir),
    legal: { license: readLegal('LAUNCHER_LICENSE.ru.txt'), java: readLegal('JAVA_NOTICE.ru.txt') },
  };
});
handle('dir:free', async dir => freeBytes(dir));
handle('dir:pick', async current => {
  const r = await dialog.showOpenDialog(win, { title: 'Папка установки', defaultPath: current, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('install:run', install);
handle('app:launch', async exe => {
  if (!(await exists(exe)) || path.basename(exe) !== APP_EXE) throw new Error('Файл запуска не найден');
  spawn(exe, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exe) }).unref();
  setTimeout(() => app.quit(), 300);
  return true;
});
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:close', () => { if (!busy && win) win.close(); });
ipcMain.on('app:quit', () => { if (!busy) app.quit(); });

function createWindow() {
  win = new BrowserWindow({
    width: 880, height: 560, resizable: false, maximizable: false,
    frame: false, backgroundColor: '#0a0a0c', title: 'MiniLauncher Setup',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
