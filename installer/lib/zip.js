'use strict';
// Распаковка и упаковка zip. Используется и установщиком, и скриптами сборки.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

function openZip(file) {
  const yauzl = require('yauzl');
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => {
      if (e) return reject(e);
      z.on('error', () => {});      // постоянный обработчик: ошибки приходят через reject, а не падением процесса
      resolve(z);
    }));
}
function readAllEntries(zip) {
  return new Promise((resolve, reject) => {
    const list = [];
    zip.on('entry', e => { list.push(e); zip.readEntry(); });
    zip.once('end', () => resolve(list));
    zip.once('error', reject);
    zip.readEntry();
  });
}
const openStream = (zip, entry) =>
  new Promise((resolve, reject) => zip.openReadStream(entry, (e, s) => (e ? reject(e) : resolve(s))));

// Размер распакованного содержимого (для прогресса и проверки места)
async function zipInfo(file) {
  const zip = await openZip(file);
  try {
    const entries = await readAllEntries(zip);
    return { files: entries.filter(e => !e.fileName.endsWith('/')).length, bytes: entries.reduce((n, e) => n + e.uncompressedSize, 0) };
  } finally { zip.close(); }
}

// opts.strip — сколько верхних папок отбросить; opts.onProgress({done,total,file})
async function extractZip(file, dest, opts = {}) {
  const strip = opts.strip || 0;
  const root = path.resolve(dest);
  const zip = await openZip(file);
  try {
    const entries = await readAllEntries(zip);
    const total = entries.reduce((n, e) => n + e.uncompressedSize, 0) || 1;
    let done = 0, lastEmit = 0;
    const emit = (name, force) => {
      const now = Date.now();
      if (opts.onProgress && (force || now - lastEmit > 80)) { lastEmit = now; opts.onProgress({ done, total, file: name }); }
    };
    for (const entry of entries) {
      const parts = entry.fileName.split('/').filter(Boolean).slice(strip);
      if (!parts.length) continue;
      const out = path.resolve(root, ...parts);
      // защита от выхода за пределы папки (zip slip)
      if (out !== root && !out.startsWith(root + path.sep)) throw new Error('Небезопасный путь в архиве: ' + entry.fileName);
      if (entry.fileName.endsWith('/')) { await fs.promises.mkdir(out, { recursive: true }); continue; }
      await fs.promises.mkdir(path.dirname(out), { recursive: true });
      const input = await openStream(zip, entry);
      const counter = new Transform({ transform(chunk, _e, cb) { done += chunk.length; emit(parts.join('/')); cb(null, chunk); } });
      await pipeline(input, counter, fs.createWriteStream(out));
    }
    emit('', true);
  } finally { zip.close(); }
}

// Упаковка папки целиком; корень архива = содержимое srcDir
async function createZip(srcDir, outFile, onFile) {
  const yazl = require('yazl');
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });
  const z = new yazl.ZipFile();
  const out = fs.createWriteStream(outFile);
  const finished = new Promise((res, rej) => { out.on('close', res); out.on('error', rej); z.outputStream.on('error', rej); });
  z.outputStream.pipe(out);
  let count = 0;
  const walk = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else { z.addFile(full, path.relative(srcDir, full).split(path.sep).join('/'), { compress: true }); count++; if (onFile) onFile(count); }
    }
  };
  walk(srcDir);
  z.end();
  await finished;
  return count;
}

module.exports = { extractZip, createZip, zipInfo };
