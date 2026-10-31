'use strict';
// Чистые функции для скинов: без Electron, чтобы проверять отдельно.
const zlib = require('zlib');

// ---------- PNG ----------
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Размер PNG из заголовка IHDR; null, если это не PNG
function readPngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(PNG_SIG)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
// Скин Minecraft: 64×64 (новый формат) или 64×32 (старый)
function validateSkin(buf) {
  const s = readPngSize(buf);
  if (!s) return 'Это не PNG-файл';
  if (s.width !== 64 || (s.height !== 64 && s.height !== 32)) return `Скин должен быть 64×64 или 64×32, а здесь ${s.width}×${s.height}`;
  if (buf.length > 300 * 1024) return 'Файл слишком большой для скина';
  return null;
}

// ---------- ZIP (без сжатия, достаточно для ресурспака) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function makeZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);                       // время/дата: 1980-01-01
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

// ---------- Ресурспак с подменой стандартных скинов ----------
// Офлайн-игрок получает «стандартный» скин по хэшу UUID. Подменяем все стандартные скины своим —
// так он виден в одиночной игре и на офлайн-серверах, но только вам (пак локальный).
const DEFAULT_NAMES = ['steve', 'alex', 'ari', 'efe', 'kai', 'makena', 'noor', 'sunny', 'zuri'];

// pack_format ресурспаков для версий до 1.20.2 (дальше хватает диапазона supported_formats)
function packFormat(mc) {
  const m = /^1\.(\d+)(?:\.(\d+))?/.exec(String(mc || ''));
  if (!m) return 34;
  const minor = Number(m[1]), patch = Number(m[2] || 0);
  if (minor <= 8) return 1;
  if (minor <= 10) return 2;
  if (minor <= 12) return 3;
  if (minor <= 14) return 4;
  if (minor === 15 || (minor === 16 && patch === 0)) return 5;
  if (minor === 16) return patch === 1 ? 5 : 6;
  if (minor === 17) return 7;
  if (minor === 18) return 8;
  if (minor === 19) return patch >= 4 ? 13 : patch === 3 ? 12 : 9;
  if (minor === 20) return patch === 0 || patch === 1 ? 15 : patch === 2 ? 18 : patch <= 4 ? 22 : 32;
  return 34;
}

// wide/slim — PNG-буферы под «широкие» и «тонкие» руки (обычная и тонкая модель отличаются)
function buildSkinPack(wide, slim, mc) {
  const files = [];
  const pack = { pack: { pack_format: packFormat(mc), description: 'MiniLauncher: ваш скин для офлайн-режима', supported_formats: { min_inclusive: 1, max_inclusive: 999 } } };
  files.push({ name: 'pack.mcmeta', data: JSON.stringify(pack, null, 2) });
  // до 1.19.3
  files.push({ name: 'assets/minecraft/textures/entity/steve.png', data: wide });
  files.push({ name: 'assets/minecraft/textures/entity/alex.png', data: slim });
  // 1.19.3 и новее: девять стандартных скинов в двух вариантах модели
  for (const n of DEFAULT_NAMES) {
    files.push({ name: `assets/minecraft/textures/entity/player/wide/${n}.png`, data: wide });
    files.push({ name: `assets/minecraft/textures/entity/player/slim/${n}.png`, data: slim });
  }
  return makeZip(files);
}

// ---------- options.txt ----------
function parsePacks(line) {
  try { const a = JSON.parse(line.slice('resourcePacks:'.length)); if (Array.isArray(a)) return a; } catch { /* битая строка */ }
  return ['vanilla'];
}
function normalize(lines) {
  const l = [...lines];
  while (l.length && l[l.length - 1] === '') l.pop();
  return l.join('\n') + '\n';
}
function enablePack(text, entry) {
  const lines = String(text || '').split(/\r?\n/);
  let found = false;
  const out = lines.map(l => {
    if (!l.startsWith('resourcePacks:')) return l;
    found = true;
    const arr = parsePacks(l);
    if (!arr.includes(entry)) arr.push(entry);             // конец списка = наивысший приоритет
    return 'resourcePacks:' + JSON.stringify(arr);
  });
  if (!found) { while (out.length && out[out.length - 1] === '') out.pop(); out.push('resourcePacks:' + JSON.stringify(['vanilla', entry])); }
  return normalize(out);
}
function disablePack(text, entry) {
  const lines = String(text || '').split(/\r?\n/);
  const out = lines.map(l => (l.startsWith('resourcePacks:') ? 'resourcePacks:' + JSON.stringify(parsePacks(l).filter(p => p !== entry)) : l));
  return normalize(out);
}

module.exports = { readPngSize, validateSkin, makeZip, crc32, packFormat, buildSkinPack, enablePack, disablePack, DEFAULT_NAMES };
