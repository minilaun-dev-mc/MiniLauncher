'use strict';
// Показывает, какие версии Java нужны играм Mojang (по полю javaVersion в данных каждой версии)
// и всё ли это входит в java-versions.json. Запуск: npm run java:detect
const path = require('path');
const fs = require('fs');

const MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'java-versions.json'), 'utf8'));

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

(async () => {
  console.log('Загружаю список версий Mojang…');
  const m = await getJson(MANIFEST);
  const releases = m.versions.filter(v => v.type === 'release');
  const latestSnap = m.versions.find(v => v.type === 'snapshot');
  const list = [...releases, ...(latestSnap ? [latestSnap] : [])];

  const byMajor = new Map();
  let i = 0, fails = 0;
  const worker = async () => {
    while (i < list.length) {
      const v = list[i++];
      try {
        const j = await getJson(v.url);
        const major = (j.javaVersion && j.javaVersion.majorVersion) || 8;
        if (!byMajor.has(major)) byMajor.set(major, []);
        byMajor.get(major).push({ id: v.id, type: v.type, time: v.releaseTime });
      } catch { fails++; }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));

  console.log(`\nПроверено версий: ${list.length - fails} из ${list.length}\n`);
  const majors = [...byMajor.keys()].sort((a, b) => a - b);
  for (const mj of majors) {
    const vs = byMajor.get(mj).sort((a, b) => a.time.localeCompare(b.time));
    console.log(`Java ${String(mj).padEnd(3)} — ${String(vs.length).padStart(3)} верс.   от ${vs[0].id} до ${vs[vs.length - 1].id}`);
  }

  // Java 16 (1.17.x) работает на 17, поэтому отдельная среда для неё не нужна
  const needed = [...new Set(majors.map(mj => (mj === 16 ? 17 : mj)))].sort((a, b) => a - b);
  const have = cfg.versions;
  const missing = needed.filter(n => !have.includes(n));
  const extra = have.filter(n => !needed.includes(n));
  console.log(`\nНужно:          ${needed.join(', ')}`);
  console.log(`В java-versions.json: ${have.join(', ')}`);
  if (missing.length) console.log(`\n⚠ Не хватает: ${missing.join(', ')} — добавьте в java-versions.json, иначе эти версии игры не запустятся без системной Java.`);
  if (extra.length) console.log(`\nℹ Лишние (никакой версии игры не нужны): ${extra.join(', ')}`);
  if (!missing.length && !extra.length) console.log('\n✔ Набор Java совпадает с потребностями игр.');
})().catch(e => { console.error('Ошибка:', e.message); process.exit(1); });
