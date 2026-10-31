'use strict';
// Состояние, версии, загрузчики, нижняя панель, профили, главная, настройки

const LOADER_NAME = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const TYPE_LABEL = { release: 'Релиз', snapshot: 'Снапшот', old: 'Старая' };

const S = {
  profiles: [], selectedProfile: null, selectedVersion: null,
  settings: { ramGb: 4, javaPath: '', closeOnLaunch: false, accent: '#ffd633', reduceMotion: false, jvmArgs: '', winW: 0, winH: 0, fullscreen: false },
  stats: { totalMs: 0, sessions: 0, byVersion: {}, last: null },
  remote: [], installed: [], filter: 'release', query: '', busyKey: null, gameState: 'idle',
  gameDir: '', totalRamGb: 16, appVersion: '2.0.0',
};
const L = { loader: 'fabric', cache: {}, snaps: false, query: '' };
const avatars = {};      // profileId -> dataURL головы

const verLabel = v => (v.loader === 'vanilla' ? v.id : `${LOADER_NAME[v.loader] || v.loader} ${v.mc}`);
const instById = id => S.installed.find(v => v.id === id);
const typeOf = v => (v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'old');
const cubeText = id => { const m = /^(\d+\.\d+)/.exec(id); return m ? m[1] : '▦'; };
const curProfile = () => S.profiles.find(x => x.id === S.selectedProfile);

// ---------- Голова из скина ----------
function headFromSkin(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      x.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      if (img.height >= 32) x.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}
async function loadAvatar(profileId, force) {
  if (!force && avatars[profileId] !== undefined) return avatars[profileId];
  let head = null;
  try {
    const r = await window.api.skins.avatar(profileId);
    if (r.ok && r.data && r.data.skin) head = await headFromSkin(r.data.skin);
  } catch { /* без аватарки */ }
  avatars[profileId] = head;
  return head;
}
function fillAvatar(node, p) {
  node.replaceChildren();
  const head = avatars[p.id];
  if (head) { const i = el('img'); i.src = head; i.alt = ''; node.appendChild(i); } else node.textContent = p.name[0].toUpperCase();
}

// ---------- Фразы и главная ----------
const QUOTES = [
  'Каждый мир начинается с одного блока.', 'Первая ночь всегда самая длинная.', 'Алмазы любят терпеливых.',
  'Не копай вниз, если не знаешь, что там.', 'Крипер не стучится — стройте стены потолще.', 'Хороший день — когда факелов хватает на всю шахту.',
  'Лучший дом тот, что построен с третьей попытки.', 'Всё великое начинается с деревянной кирки.', 'Делай копии миров чаще, чем кажется нужным.',
  'Один блок в день — и через год у тебя замок.', 'MiniLauncher: минимум лишнего, максимум игры.', 'Если сомневаешься — добавь ещё факелов.',
];
let quoteIdx = -1;
function nextQuote(first) {
  const q = $('#quote');
  let i; do { i = Math.floor(Math.random() * QUOTES.length); } while (i === quoteIdx && QUOTES.length > 1);
  quoteIdx = i;
  if (first) { q.textContent = QUOTES[i]; return; }
  q.classList.add('swap');
  setTimeout(() => { q.textContent = QUOTES[i]; q.classList.remove('swap'); }, 350);
}
$('#quote-next').addEventListener('click', () => nextQuote());
setInterval(() => { if ($('#page-home').classList.contains('active')) nextQuote(); }, 15000);

function makeParticles() {
  const box = $('#particles');
  for (let i = 0; i < 18; i++) {
    const p = el('span', 'px'), size = 5 + Math.random() * 9;
    p.style.cssText = `left:${Math.random() * 100}%;width:${size}px;height:${size}px;animation-duration:${7 + Math.random() * 9}s;animation-delay:${-Math.random() * 14}s`;
    box.appendChild(p);
  }
}
// Лёгкий параллакс логотипа за курсором
$('#hero').addEventListener('mousemove', e => {
  if (document.documentElement.dataset.motion === 'off') return;
  const r = e.currentTarget.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  $('#hero-cube').style.transform = `rotateY(${x * 18}deg) rotateX(${-y * 14}deg)`;
});
$('#hero').addEventListener('mouseleave', () => { $('#hero-cube').style.transform = ''; });

function renderHome() {
  const p = curProfile(), cur = instById(S.selectedVersion);
  const h = new Date().getHours();
  const hello = h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
  $('#greet').replaceChildren(document.createTextNode(hello), ...(p ? [document.createTextNode(', '), el('b', '', p.name)] : []));
  $('#st-time').textContent = fmtDuration(S.stats.totalMs);
  $('#st-sessions').textContent = String(S.stats.sessions || 0);
  $('#st-build').textContent = cur ? verLabel(cur) : 'не выбрана';
  $('#st-ram').textContent = `${S.settings.ramGb} ГБ`;
  const chips = $('#hero-chips');
  chips.replaceChildren();
  const add = (k, v) => { const c = el('span', 'chip', k + ' '); c.appendChild(el('b', '', v)); chips.appendChild(c); };
  add('Версий:', String(S.installed.length));
  if (S.stats.last && instById(S.stats.last.versionId)) add('Последний запуск:', ago(S.stats.last.at));
  const hp = $('#hero-play');
  hp.textContent = S.gameState === 'running' ? 'Игра запущена' : cur ? `Играть · ${verLabel(cur)}` : 'Скачать версию';
  hp.disabled = S.gameState !== 'idle' && S.gameState !== 'running';
}
$('#hero-play').addEventListener('click', () => {
  if (!S.installed.length) { showPage('versions'); return; }
  if (S.gameState === 'idle') $('#play').click();
});
window.api.onStats(st => { if (st) { S.stats = st.stats || st; renderHome(); } });

// ---------- Версии ----------
function filteredVersions() {
  const q = S.query.trim().toLowerCase();
  let list;
  if (S.filter === 'installed') {
    list = S.installed.map(v => {
      const r = S.remote.find(x => x.id === v.mc);
      return { id: v.id, kind: v.loader === 'vanilla' ? (r ? typeOf(r) : 'old') : v.loader, mc: v.mc, loader: v.loader, releaseTime: v.loader === 'vanilla' && r ? r.releaseTime : null, local: true };
    });
  } else list = S.remote.filter(v => typeOf(v) === S.filter).map(v => ({ id: v.id, kind: typeOf(v), mc: v.id, loader: 'vanilla', releaseTime: v.releaseTime }));
  if (q) list = list.filter(v => v.id.toLowerCase().includes(q) || v.mc.toLowerCase().includes(q));
  return list;
}
function rowFor(v, i, key) {
  const isInst = key ? false : !!instById(v.id);
  const row = el('div', 'row-v' + (isInst ? ' installed' : ''));
  row.style.setProperty('--i', i);
  row.dataset.id = key || v.id;
  row.appendChild(el('div', 'cube', cubeText(v.mc)));
  const info = el('div', 'info');
  const title = el('div', 'vid', v.loader && v.loader !== 'vanilla' && v.local ? `${LOADER_NAME[v.loader]} · ${v.mc}` : v.id);
  title.appendChild(el('span', 'badge ' + v.kind, TYPE_LABEL[v.kind] || LOADER_NAME[v.kind] || 'Своя'));
  info.appendChild(title);
  info.appendChild(el('div', 'vmeta', v.meta || (v.releaseTime ? fmtDate(v.releaseTime) : (v.local && v.loader !== 'vanilla' ? v.id : 'Локальная версия'))));
  row.appendChild(info);
  row.appendChild(el('div', 'pbar'));
  return { row, isInst };
}
function btn(cls, text, fn, icon) {
  const b = el('button', 'btn ' + cls);
  if (icon) b.appendChild(svgIcon(ICON[icon]));
  b.appendChild(document.createTextNode(text));
  if (fn) b.addEventListener('click', fn);
  return b;
}
function renderVersions() {
  const box = $('#version-list');
  box.replaceChildren();
  const list = filteredVersions();
  $('#versions-sub').textContent = S.remote.length || S.installed.length ? `Найдено: ${list.length} · скачано: ${S.installed.length}` : 'Не удалось загрузить список. Проверьте подключение.';
  if (!list.length) { box.appendChild(el('div', 'empty', 'Ничего не найдено')); return; }
  list.forEach((v, i) => {
    const { row, isInst } = rowFor(v, i);
    const actions = el('div', 'row-actions');
    if (isInst) {
      actions.append(
        btn('sm ghost', 'Папка', () => safe(() => call(window.api.openVersionFolder(v.id)))),
        btn('sm ghost danger', 'Удалить', () => deleteVersion(v.id)),
        btn('sm primary', S.selectedVersion === v.id ? 'Выбрана' : 'Выбрать', () => selectVersion(v.id, true)));
    } else {
      const dl = btn('sm primary', 'Скачать', () => startDownload(v.id), 'download');
      dl.dataset.dl = v.id; dl.disabled = !!S.busyKey;
      actions.appendChild(dl);
    }
    row.insertBefore(actions, row.querySelector('.pbar'));
    box.appendChild(row);
  });
}
function selectVersion(id, notify) {
  S.selectedVersion = id;
  window.api.selectVersion(id);
  renderAll();
  if (notify) toast(`Выбрана сборка: ${verLabel(instById(id) || { id, loader: 'vanilla' })}`, 'ok');
}
async function refreshInstalled() {
  S.installed = await call(window.api.installedVersions());
  if (S.selectedVersion && !instById(S.selectedVersion)) S.selectedVersion = null;
  if (!S.selectedVersion && S.installed.length) S.selectedVersion = S.installed[0].id;
}
async function startDownload(id) {
  if (S.busyKey) return;
  S.busyKey = id; renderAll();
  try {
    await call(window.api.downloadVersion(id));
    toast(`Версия ${id} скачана`, 'ok');
    await refreshInstalled(); selectVersion(id);
  } catch (e) { toast('Ошибка загрузки: ' + e.message, 'err'); }
  finally { S.busyKey = null; await safe(refreshInstalled); renderAll(); }
}
async function deleteVersion(id) {
  if (!(await confirmBox({ title: `Удалить ${id}?`, text: 'Файлы версии будут удалены. Миры и моды сохранятся.' }))) return;
  await safe(async () => { await call(window.api.deleteVersion(id)); await refreshInstalled(); renderAll(); });
}
window.api.onProgress(({ id, stage, done, total }) => {
  const row = document.querySelector(`.row-v[data-id="${CSS.escape(id)}"]`);
  const indet = !total, pct = total ? Math.round((done / total) * 100) : 0;
  if (row) {
    const bar = row.querySelector('.pbar');
    bar.classList.toggle('indet', indet);
    if (!indet) bar.style.width = pct + '%';
    const b = row.querySelector('[data-dl]');
    if (b) b.textContent = indet ? 'Установка…' : `${stage} ${pct}%`;
  }
  const pb = $('#play-bar');
  pb.classList.toggle('indet', indet);
  pb.style.width = indet ? '' : pct + '%';
  $('#play-label').textContent = indet ? 'Установка…' : `Загрузка ${pct}%`;
});
bindSeg($('#type-filter'), 'type', t => { S.filter = t; renderVersions(); });
$('#search').addEventListener('input', e => { S.query = e.target.value; renderVersions(); });

// ---------- Загрузчики ----------
async function loadLoaderList() {
  const list = $('#loader-list');
  if (!L.cache[L.loader]) {
    list.replaceChildren(el('div', 'skeleton'), el('div', 'skeleton'), el('div', 'skeleton'));
    try { L.cache[L.loader] = await call(window.api.loaderVersions(L.loader)); }
    catch (e) { list.replaceChildren(el('div', 'empty', 'Не удалось загрузить: ' + e.message)); return; }
  }
  renderLoaders();
}
function renderLoaders() {
  const box = $('#loader-list');
  const q = L.query.trim().toLowerCase();
  let items = L.cache[L.loader] || [];
  if (L.loader !== 'forge' && !L.snaps) items = items.filter(v => v.stable);
  if (q) items = items.filter(v => v.id.toLowerCase().includes(q));
  $('#snap-wrap').hidden = L.loader === 'forge';
  $('#loaders-sub').textContent = {
    fabric: 'Лёгкий загрузчик. Вместе с ним ставится Sodium — ускорение графики.',
    quilt: 'Форк Fabric. Совместим с модами Fabric, Sodium ставится из той же сборки.',
    forge: 'Классический загрузчик. Вместо Sodium ставится его порт Embeddium. Установка занимает несколько минут.',
  }[L.loader];
  box.replaceChildren();
  if (!items.length) { box.appendChild(el('div', 'empty', 'Ничего не найдено')); return; }
  items.forEach((v, i) => {
    const key = `${L.loader}:${v.id}`;
    const have = S.installed.find(x => x.loader === L.loader && x.mc === v.id);
    const { row } = rowFor({ id: v.id, mc: v.id, kind: L.loader, loader: L.loader, meta: have ? 'Уже установлено' : (v.stable ? 'Стабильная версия' : 'Снапшот') }, i, key);
    if (have) row.classList.add('installed');
    const actions = el('div', 'row-actions');
    if (have) actions.appendChild(btn('sm primary', 'Выбрать', () => selectVersion(have.id, true)));
    else { const b = btn('sm primary', 'Установить', () => openLoaderModal(L.loader, v.id)); b.dataset.dl = key; b.disabled = !!S.busyKey; actions.appendChild(b); }
    row.insertBefore(actions, row.querySelector('.pbar'));
    box.appendChild(row);
  });
}
bindSeg($('#loader-filter'), 'loader', l => { L.loader = l; loadLoaderList(); });
$('#loader-snaps').addEventListener('change', e => { L.snaps = e.target.checked; renderLoaders(); });
$('#loader-search').addEventListener('input', e => { L.query = e.target.value; renderLoaders(); });

let pendingLoader = null;
function openLoaderModal(loader, mc) {
  pendingLoader = { loader, mc };
  $('#ml-title').textContent = `${LOADER_NAME[loader]} ${mc}`;
  $('#ml-sodium-text').textContent = loader === 'forge' ? 'Установить Embeddium — порт Sodium для Forge' : 'Установить Sodium — ускорение графики';
  $('#ml-sodium').checked = true;
  $('#modal-loader').hidden = false;
}
const closeLoaderModal = () => { $('#modal-loader').hidden = true; pendingLoader = null; };
$('#ml-cancel').addEventListener('click', closeLoaderModal);
bindModal('modal-loader');
$('#ml-ok').addEventListener('click', async () => {
  if (!pendingLoader) return;
  const { loader, mc } = pendingLoader, withSodium = $('#ml-sodium').checked;
  closeLoaderModal();
  if (S.busyKey) return;
  S.busyKey = `${loader}:${mc}`; renderAll();
  try {
    const r = await call(window.api.installLoader({ loader, mc, withSodium }));
    toast(`${LOADER_NAME[loader]} ${mc} установлен`, 'ok');
    if (r.warning) toast('Мод не установлен: ' + r.warning, 'err');
    await refreshInstalled(); selectVersion(r.id);
  } catch (e) { toast('Ошибка установки: ' + e.message, 'err'); }
  finally { S.busyKey = null; await safe(refreshInstalled); renderAll(); }
});

// ---------- Нижняя панель ----------
function renderDock() {
  const cur = instById(S.selectedVersion), p = curProfile();
  // выбор сборки
  $('#build-btn').disabled = !S.installed.length;
  $('#build-ico').textContent = cur ? cubeText(cur.mc) : '▦';
  $('#build-name').textContent = cur ? verLabel(cur) : 'Нет версий';
  $('#build-sub').textContent = cur ? (cur.loader === 'vanilla' ? 'Чистая игра' : 'Сборка с модами') : 'Скачайте версию';
  $('#tb-chip-text').textContent = cur ? `${verLabel(cur)}${p ? ' · ' + p.name : ''}` : 'Сборка не выбрана';
  $('#tb-chip').classList.toggle('run', S.gameState === 'running');
  // профиль
  const av = $('#profile-avatar');
  av.className = 'avatar' + (p ? (p.type === 'microsoft' && !avatars[p.id] ? ' ms' : '') : ' none');
  if (p) fillAvatar(av, p); else av.textContent = '?';
  $('#profile-name').textContent = p ? p.name : 'Нет профиля';
  $('#profile-type').textContent = p ? (p.type === 'microsoft' ? 'Microsoft' : 'Offline') : 'Создайте профиль';
  // кнопка запуска
  const play = $('#play'), label = $('#play-label'), bar = $('#play-bar'), running = S.gameState === 'running';
  play.classList.toggle('stop', running);
  $('#play-ico').innerHTML = running ? '<rect x="6" y="6" width="12" height="12" rx="2"/>' : '<path d="M8 5v14l11-7z"/>';
  if (running) { play.disabled = false; label.textContent = 'Завершить'; bar.classList.remove('indet'); bar.style.width = '0'; }
  else if (S.busyKey) play.disabled = true;
  else {
    play.disabled = S.gameState !== 'idle' || !S.installed.length || !p;
    bar.classList.remove('indet'); bar.style.width = '0';
    label.textContent = S.gameState === 'starting' ? 'Запуск…' : !S.installed.length ? 'Скачайте версию' : !p ? 'Нужен профиль' : 'Играть';
  }
  $('#game-dot').className = 'dot' + (running ? ' run' : S.gameState === 'starting' ? ' start' : '');
  $('#game-status').textContent = running ? 'Игра запущена' : S.gameState === 'starting' ? 'Запуск игры…' : 'Игра не запущена';
}
function renderAll() {
  renderDock(); renderVersions(); renderHome();
  if ($('#page-mods').classList.contains('active') && typeof renderModsPage === 'function') renderModsPage();
}

function renderBuildMenu() {
  const list = $('#build-list');
  list.replaceChildren();
  for (const v of S.installed) {
    const item = el('div', 'menu-item' + (v.id === S.selectedVersion ? ' sel' : ''));
    item.appendChild(el('span', 'dd-ico', cubeText(v.mc)));
    const g = el('span', 'grow');
    g.append(el('span', '', verLabel(v)), el('small', '', v.loader === 'vanilla' ? 'Чистая игра' : 'Сборка с модами'));
    item.appendChild(g);
    item.addEventListener('click', () => { closeMenus(); selectVersion(v.id); });
    list.appendChild(item);
  }
}
$('#build-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu('#build-dd', '#build-menu', renderBuildMenu); });
$('#open-files').addEventListener('click', () => safe(() => call(window.api.openFiles(S.selectedVersion))));
$('#open-files-s').addEventListener('click', () => safe(() => call(window.api.openFiles(null))));

async function launch(server) {
  if (S.gameState === 'running') { await safe(() => call(window.api.stop())); return; }
  if (S.gameState !== 'idle') return;
  S.gameState = 'starting'; renderAll();
  try { await call(window.api.play({ versionId: S.selectedVersion, profileId: S.selectedProfile, server: server || undefined })); }
  catch (e) { S.gameState = 'idle'; renderAll(); toast(e.message, 'err'); }
}
$('#play').addEventListener('click', () => launch());
window.api.onGameState(({ state }) => { S.gameState = state; renderAll(); });

// ---------- Профили ----------
function renderProfileMenu() {
  const list = $('#profile-list');
  list.replaceChildren();
  if (!S.profiles.length) list.appendChild(el('div', 'menu-empty', 'Профилей пока нет'));
  for (const p of S.profiles) {
    const item = el('div', 'menu-item' + (p.id === S.selectedProfile ? ' sel' : ''));
    const av = el('span', 'avatar' + (p.type === 'microsoft' && !avatars[p.id] ? ' ms' : ''));
    fillAvatar(av, p);
    item.appendChild(av);
    const g = el('span', 'grow');
    g.append(el('span', '', p.name), el('small', '', p.type === 'microsoft' ? 'Microsoft' : 'Offline'));
    item.appendChild(g);
    const x = el('button', 'x', '✕');
    x.title = 'Удалить профиль';
    x.addEventListener('click', async ev => {
      ev.stopPropagation();
      if (!(await confirmBox({ title: `Удалить профиль ${p.name}?`, text: 'Сохранённый скин этого профиля тоже будет удалён.' }))) return;
      await safe(async () => { applyState(await call(window.api.removeProfile(p.id))); renderProfileMenu(); });
    });
    item.appendChild(x);
    item.addEventListener('click', async () => {
      S.selectedProfile = p.id;
      await window.api.selectProfile(p.id);
      closeMenus(); renderAll();
      if (typeof onProfileChanged === 'function') onProfileChanged();
    });
    list.appendChild(item);
  }
}
$('#profile-btn').addEventListener('click', e => { e.stopPropagation(); toggleMenu('#profile', '#profile-menu', renderProfileMenu); });
$('#add-ms').addEventListener('click', async () => {
  closeMenus();
  toast('Откроется окно входа Microsoft…');
  await safe(async () => { applyState(await call(window.api.addMicrosoft())); toast('Профиль Microsoft добавлен', 'ok'); });
});
const nickModal = $('#modal');
$('#add-offline').addEventListener('click', () => { closeMenus(); $('#nick').value = ''; $('#nick-error').textContent = ''; nickModal.hidden = false; setTimeout(() => $('#nick').focus(), 30); });
$('#nick-cancel').addEventListener('click', () => { nickModal.hidden = true; });
bindModal('modal');
async function createOffline() {
  const name = $('#nick').value.trim();
  try { applyState(await call(window.api.addOffline(name))); nickModal.hidden = true; toast(`Offline профиль «${name}» создан`, 'ok'); }
  catch (e) { $('#nick-error').textContent = e.message; }
}
$('#nick-ok').addEventListener('click', createOffline);
$('#nick').addEventListener('keydown', e => { if (e.key === 'Enter') createOffline(); });

// ---------- Консоль ----------
let logStarted = false;
window.api.onLog(line => {
  const c = $('#console');
  if (!logStarted) { c.textContent = ''; logStarted = true; }
  c.textContent += line + '\n';
  if (c.textContent.length > 400000) c.textContent = c.textContent.slice(-300000);
  c.scrollTop = c.scrollHeight;
});
$('#clear-log').addEventListener('click', () => { $('#console').textContent = ''; });

// ---------- Настройки ----------
function renderSettings() {
  const s = S.settings, ram = $('#ram');
  ram.max = String(Math.min(32, S.totalRamGb || 16));
  ram.value = s.ramGb;
  $('#ram-val').textContent = `${ram.value} ГБ`;
  $('#ram-hint').textContent = `Всего в системе: ${S.totalRamGb || '?'} ГБ. Для большинства версий достаточно 4 ГБ, для сборок с модами — 6–8 ГБ.`;
  $('#java').value = s.javaPath || '';
  $('#jvm').value = s.jvmArgs || '';
  $('#close-on-launch').checked = !!s.closeOnLaunch;
  $('#reduce-motion').checked = !!s.reduceMotion;
  $('#fullscreen').checked = !!s.fullscreen;
  $('#win-w').value = s.winW || ''; $('#win-h').value = s.winH || '';
  $('#win-w').disabled = $('#win-h').disabled = !!s.fullscreen;
  $('#game-dir').textContent = S.gameDir || '';
  applyAccent(s.accent); applyMotion(s.reduceMotion);
}
const saveSettings = patch => safe(async () => applyState(await call(window.api.setSettings(patch))));
$('#ram').addEventListener('input', e => { $('#ram-val').textContent = `${e.target.value} ГБ`; });
$('#ram').addEventListener('change', e => saveSettings({ ramGb: Number(e.target.value) }));
$('#java').addEventListener('change', e => saveSettings({ javaPath: e.target.value }));
$('#jvm').addEventListener('change', e => saveSettings({ jvmArgs: e.target.value }));
$('#close-on-launch').addEventListener('change', e => saveSettings({ closeOnLaunch: e.target.checked }));
$('#reduce-motion').addEventListener('change', e => saveSettings({ reduceMotion: e.target.checked }));
$('#fullscreen').addEventListener('change', e => saveSettings({ fullscreen: e.target.checked }));
$('#win-w').addEventListener('change', e => saveSettings({ winW: Number(e.target.value) || 0 }));
$('#win-h').addEventListener('change', e => saveSettings({ winH: Number(e.target.value) || 0 }));
$('#java-pick').addEventListener('click', () => safe(async () => {
  const p = await call(window.api.pickJava());
  if (p) { $('#java').value = p; applyState(await call(window.api.setSettings({ javaPath: p }))); checkJava(); }
}));
async function checkJava() {
  const st = $('#java-status');
  st.textContent = 'Проверка…';
  const r = await call(window.api.checkJava());
  const has = r.bundled && r.bundled.length;
  if (r.custom) st.textContent = r.version ? `Используется Java из настроек: ${r.version}` : `Java по пути «${r.bin}» не запускается. Проверьте путь.`;
  else if (has) st.textContent = `Встроенная Java: ${r.bundled.join(', ')}. Подходящая выбирается автоматически под версию игры.`;
  else st.textContent = r.version ? `Найдена системная Java ${r.version}` : 'Java не найдена. Установите Java 17/21 или укажите путь вручную.';
}
$('#java-check').addEventListener('click', () => safe(checkJava));
(function makeSwatches() {
  const box = $('#swatches');
  for (const c of ACCENTS) {
    const s = el('button', 'swatch'); s.dataset.color = c; s.style.setProperty('--c', c); s.title = c;
    s.addEventListener('click', () => { applyAccent(c); saveSettings({ accent: c }); });
    box.appendChild(s);
  }
})();

// ---------- Обновление лаунчера ----------
async function checkUpdate() {
  const r = await call(window.api.checkUpdate());
  if (!r.available) return;
  $('#ub-title').textContent = `Доступно обновление ${r.version}`;
  $('#ub-sub').textContent = r.notes ? r.notes : `Сейчас установлена версия ${r.current}`;
  $('#update-banner').hidden = false;
}
window.api.onUpdateProgress(({ done, total }) => { $('#ub-btn').textContent = total ? `Скачиваю ${Math.round((done / total) * 100)}%` : 'Скачиваю…'; });
$('#ub-btn').addEventListener('click', async () => {
  const b = $('#ub-btn');
  b.disabled = true; b.textContent = 'Скачиваю…';
  try { await call(window.api.installUpdate()); b.textContent = 'Перезапуск…'; }
  catch (e) { b.disabled = false; b.textContent = 'Обновить'; toast(e.message, 'err'); }
});

// ---------- Применение состояния ----------
function applyState(st) {
  S.profiles = st.profiles;
  S.selectedProfile = st.selectedProfile && st.profiles.some(p => p.id === st.selectedProfile) ? st.selectedProfile : (st.profiles[0] ? st.profiles[0].id : null);
  if (st.selectedVersion) S.selectedVersion = st.selectedVersion;
  S.settings = { ...S.settings, ...st.settings };
  if (st.stats) S.stats = st.stats;
  S.gameDir = st.gameDir; S.totalRamGb = st.totalRamGb;
  if (st.appVersion) { S.appVersion = st.appVersion; $('#app-ver').textContent = 'v' + st.appVersion; }
  renderSettings(); renderAll();
  for (const p of S.profiles) if (avatars[p.id] === undefined) loadAvatar(p.id).then(() => renderDock());
}
