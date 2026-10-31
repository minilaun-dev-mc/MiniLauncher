'use strict';
// Делает latest.json для автообновления лаунчера.
//   node scripts/make-update-manifest.js https://github.com/<вы>/<репо>/releases/download/v1.1.0 "Что нового"
// Первый аргумент — папка, где будет лежать .exe (без имени файла). Результат: out/latest.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const base = (process.argv[2] || '').replace(/\/+$/, '');
const notes = process.argv[3] || '';
if (!/^https:\/\//.test(base)) { console.error('Укажите https-адрес папки с установщиком первым аргументом'); process.exit(1); }

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const name = `MiniLauncher-Setup-${pkg.version}.exe`;
const file = path.join(__dirname, '..', 'out', name);
if (!fs.existsSync(file)) { console.error(`Не найден ${file}. Сначала соберите установщик: npm run dist`); process.exit(1); }

const hash = crypto.createHash('sha256');
fs.createReadStream(file).on('data', d => hash.update(d)).on('end', () => {
  const manifest = { version: pkg.version, url: `${base}/${name}`, sha256: hash.digest('hex'), notes };
  const out = path.join(__dirname, '..', 'out', 'latest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log('✔ ' + out + '\n' + JSON.stringify(manifest, null, 2));
});
