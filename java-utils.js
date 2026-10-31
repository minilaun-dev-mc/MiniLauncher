'use strict';
// Выбор Java под версию игры. Без зависимостей от Electron — чтобы проверять отдельно.
const fs = require('fs');
const path = require('path');

// Встроенные среды лежат в <установка>/runtime/java<N>/bin/java(.exe)
function listBundled(runtimeDir, platform = process.platform) {
  let names = [];
  try { names = fs.readdirSync(runtimeDir); } catch { return []; }
  const exe = platform === 'win32' ? 'java.exe' : 'java';
  return names
    .map(n => /^java(\d+)$/.exec(n))
    .filter(Boolean)
    .map(m => ({ major: Number(m[1]), bin: path.join(runtimeDir, m[0], 'bin', exe) }))
    .filter(j => fs.existsSync(j.bin))
    .sort((a, b) => a.major - b.major);
}

// Минимальная встроенная Java, которая не старше требуемой. Нет подходящей — null.
function pickBundled(list, required) {
  return list.find(j => j.major >= required) || null;
}

// Требуемая версия Java из version.json (для Fabric/Quilt/Forge — из базовой версии)
function requiredMajor(versionsDir, id, depth = 0) {
  if (depth > 3) return 8;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(versionsDir, id, `${id}.json`), 'utf8'));
    if (j.javaVersion && j.javaVersion.majorVersion) return Number(j.javaVersion.majorVersion);
    if (j.inheritsFrom) return requiredMajor(versionsDir, j.inheritsFrom, depth + 1);
  } catch { /* нет файла — считаем старой версией */ }
  return 8;
}

module.exports = { listBundled, pickBundled, requiredMajor };
