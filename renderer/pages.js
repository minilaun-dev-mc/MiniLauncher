'use strict';
// Страницы: Моды, Серверы, Скины, Скриншоты

// =====================================================================
// Моды
// =====================================================================
const M = { tab: 'loaders', files: null, cat: { query: '', hits: [], total: 0, seq: 0, done: new Set() }, timer: null };

function curBuild() { return instById(S.selectedVersion); }
function buildNote(node) {
  const b = curBuild();
  node.replaceChildren();
  if (!b) { node.textContent = 'Сначала скачайте версию или установите загрузчик на вкладке «Загрузчики».'; return false; }
  if (b.loader === 'vanilla') { node.textContent = `Выбрана чистая версия ${b.id}. Выберите сборку Fabric, Quilt или Forge в нижней панели.`; return false; }
  node.append('Сборка: ', el('b', '', verLabel(b)));
  return true;
}
function setModsTab(tab) {
  M.tab = tab;
  $$('.sub-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $$('#mods-tabs .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  updatePill($('#mods-tabs'));
  renderModsPage();
}
bindSeg($('#mods-tabs'), 'tab', t => setModsTab(t));
function renderModsPage() {
  if (M.tab === 'loaders') { loadLoaderList(); requestAnimationFrame(() => updatePill($('#loader-filter'))); }
  else if (M.tab === 'installed') loadInstalledMods();
  else loadCatalog(true);
}
pageHooks.mods = renderModsPage;

async function loadInstalledMods() {
  const list = $('#mod-list');
  const ok = buildNote($('#inst-note'));
  $('#mod-add').disabled = $('#mod-folder').disabled = !ok;
  list.replaceChildren();
  $('#inst-count').textContent = '';
  if (!ok) { list.appendChild(el('div', 'empty', 'Здесь появятся установленные моды выбранной сборки')); return; }
  try { M.files = (await call(window.api.mods.list(S.selectedVersion))).files; }
  catch (e) { list.appendChild(el('div', 'empty', e.message)); return; }
  const files = M.files;
  $('#inst-count').textContent = files.length ? `Модов: ${files.length} · включено: ${files.filter(f => f.enabled).length}` : '';
  if (!files.length) { list.appendChild(el('div', 'empty', 'Модов пока нет. Добавьте файлы .jar или найдите моды во вкладке «Каталог».')); return; }
  files.forEach((f, i) => {
    const row = el('div', 'mod' + (f.enabled ? '' : ' off'));
    row.style.setProperty('--i', i);
    const sw = el('label', 'switch');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = f.enabled;
    cb.addEventListener('change', () => safe(async () => { await call(window.api.mods.toggle({ versionId: S.selectedVersion, file: f.file })); loadInstalledMods(); }));
    sw.append(cb, el('i'));
    const name = el('div', 'mod-name', f.file.replace(/\.disabled$/i, '').replace(/\.jar$/i, ''));
    name.appendChild(el('small', '', f.enabled ? 'включён' : 'выключен'));
    row.append(sw, name, el('div', 'mod-size', fmtSize(f.size)));
    const del = btn('sm ghost danger icon', '', async () => {
      if (!(await confirmBox({ title: 'Удалить мод?', text: `${f.file} будет перемещён в корзину.` }))) return;
      safe(async () => { await call(window.api.mods.remove({ versionId: S.selectedVersion, file: f.file })); loadInstalledMods(); });
    }, 'trash');
    del.title = 'Удалить';
    row.appendChild(del);
    list.appendChild(row);
  });
}
$('#mod-add').addEventListener('click', () => safe(async () => {
  const n = await call(window.api.mods.addJar(S.selectedVersion));
  if (n) { toast(`Добавлено модов: ${n}`, 'ok'); loadInstalledMods(); }
}));
$('#mod-folder').addEventListener('click', () => safe(() => call(window.api.mods.folder(S.selectedVersion))));

async function loadCatalog(reset) {
  const grid = $('#cat-grid');
  const ok = buildNote($('#cat-note'));
  $('#cat-search').disabled = !ok;
  if (!ok) { grid.replaceChildren(el('div', 'empty', 'Каталог Modrinth доступен для сборок с загрузчиком')); $('#cat-count').textContent = ''; return; }
  if (!reset && M.cat.lastBuild === S.selectedVersion && M.cat.hits.length) return;
  const seq = ++M.cat.seq;
  M.cat.lastBuild = S.selectedVersion;
  grid.replaceChildren(...Array.from({ length: 6 }, () => { const s = el('div', 'skeleton'); s.style.height = '150px'; return s; }));
  try {
    const r = await call(window.api.mods.search({ versionId: S.selectedVersion, query: M.cat.query, offset: 0 }));
    if (seq !== M.cat.seq) return;
    M.cat.hits = r.hits; M.cat.total = r.total;
    renderCatalog();
  } catch (e) { if (seq === M.cat.seq) grid.replaceChildren(el('div', 'empty', e.message)); }
}
function renderCatalog() {
  const grid = $('#cat-grid');
  grid.replaceChildren();
  $('#cat-count').textContent = M.cat.total ? `Найдено: ${fmtNum(M.cat.total)}` : '';
  if (!M.cat.hits.length) { grid.appendChild(el('div', 'empty', 'Ничего не найдено для этой версии')); return; }
  M.cat.hits.forEach((h, i) => {
    const card = el('div', 'cat');
    card.style.setProperty('--i', i);
    const top = el('div', 'cat-top');
    const ico = el('img', 'cat-ico'); ico.alt = ''; ico.loading = 'lazy';
    if (h.icon) ico.src = h.icon; else ico.style.visibility = 'hidden';
    const t = el('div'); t.style.minWidth = 0;
    t.append(el('div', 'cat-title', h.title), el('div', 'cat-meta', `${h.author} · ${fmtNum(h.downloads)} загрузок`));
    top.append(ico, t);
    const foot = el('div', 'cat-foot');
    const done = M.cat.done.has(h.slug + '|' + S.selectedVersion);
    const b = btn('sm ' + (done ? '' : 'primary'), done ? 'Установлено' : 'Установить', null, done ? null : 'download');
    b.disabled = done;
    b.addEventListener('click', async () => {
      b.disabled = true; b.textContent = 'Установка…';
      try {
        await call(window.api.mods.install({ versionId: S.selectedVersion, slug: h.slug }));
        M.cat.done.add(h.slug + '|' + S.selectedVersion);
        b.textContent = 'Установлено';
        toast(`${h.title} установлен`, 'ok');
      } catch (e) { b.disabled = false; b.textContent = 'Установить'; toast(e.message, 'err'); }
    });
    foot.append(el('span', '', 'Modrinth'), b);
    card.append(top, el('div', 'cat-desc', h.description || ''), foot);
    grid.appendChild(card);
  });
}
$('#cat-search').addEventListener('input', e => { M.cat.query = e.target.value; clearTimeout(M.timer); M.timer = setTimeout(() => loadCatalog(true), 380); });

// =====================================================================
// Серверы
// =====================================================================
const SRV = { list: [], status: {} };
function pingClass(ms) { return ms < 80 ? 'good' : ms < 200 ? 'mid' : 'bad'; }
async function loadServers(refresh) {
  if (!refresh || !SRV.list.length) SRV.list = await call(window.api.servers.list());
  renderServers();
  for (const s of SRV.list) pingOne(s.id);
}
async function pingOne(id) {
  SRV.status[id] = { wait: true }; paintServer(id);
  try { SRV.status[id] = await call(window.api.servers.ping(id)); } catch (e) { SRV.status[id] = { online: false, error: e.message }; }
  paintServer(id);
}
function renderServers() {
  const box = $('#srv-list');
  box.replaceChildren();
  if (!SRV.list.length) {
    box.appendChild(el('div', 'empty', ''));
    box.firstChild.append(el('b', '', 'Серверов пока нет'), 'Добавьте адрес любимого сервера — лаунчер покажет онлайн и пинг.');
    return;
  }
  SRV.list.forEach((s, i) => {
    const row = el('div', 'srv'); row.dataset.id = s.id; row.style.setProperty('--i', i);
    const ico = el('div', 'srv-ico'); ico.appendChild(svgIcon(ICON.server));
    const info = el('div', 'srv-info');
    const name = el('div', 'srv-name', s.name); name.appendChild(el('span', 'srv-addr', s.address));
    info.append(name, el('div', 'srv-motd', ''));
    const stat = el('div', 'srv-stat');
    const act = el('div', 'row-actions');
    const play = btn('sm primary', 'Играть', () => joinServer(s), 'play');
    const del = btn('sm ghost danger icon', '', async () => {
      if (!(await confirmBox({ title: `Удалить ${s.name}?`, text: 'Сервер исчезнет из списка лаунчера.' }))) return;
      safe(async () => { SRV.list = await call(window.api.servers.remove(s.id)); renderServers(); for (const x of SRV.list) paintServer(x.id); });
    }, 'trash');
    del.title = 'Удалить';
    act.append(play, del);
    row.append(ico, info, stat, act);
    box.appendChild(row);
    paintServer(s.id);
  });
}
function paintServer(id) {
  const row = document.querySelector(`.srv[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const st = SRV.status[id] || { wait: true };
  const stat = row.querySelector('.srv-stat'), motd = row.querySelector('.srv-motd'), ico = row.querySelector('.srv-ico');
  stat.replaceChildren();
  if (st.wait) { const p = el('span', 'ping wait'); p.append(el('i'), 'Проверка…'); stat.appendChild(p); motd.textContent = ''; return; }
  if (!st.online) { const p = el('span', 'ping off'); p.append(el('i'), 'Офлайн'); stat.appendChild(p); motd.textContent = st.error || ''; return; }
  const p = el('span', 'ping ' + pingClass(st.latency)); p.append(el('i'), `${st.latency} мс`);
  const pl = el('span'); pl.append(el('b', '', String(st.players.online)), ` / ${st.players.max} онлайн`);
  stat.append(p, pl);
  motd.textContent = st.motd ? st.motd.replace(/\s+/g, ' ') : (st.version ? st.version.name : '');
  motd.title = st.version ? st.version.name : '';
  if (st.favicon && !ico.querySelector('img')) { ico.replaceChildren(); const im = el('img'); im.src = st.favicon; im.style.cssText = 'width:100%;height:100%;border-radius:11px;image-rendering:pixelated'; ico.appendChild(im); }
}
function joinServer(s) {
  if (!S.installed.length) { toast('Сначала скачайте версию игры', 'err'); showPage('versions'); return; }
  if (!curProfile()) { toast('Создайте профиль, чтобы играть', 'err'); return; }
  if (S.gameState !== 'idle') { toast('Игра уже запущена'); return; }
  toast(`Подключаемся к ${s.name}…`);
  launch({ address: s.address });
}
pageHooks.servers = () => safe(() => loadServers(false));
$('#srv-refresh').addEventListener('click', () => safe(() => loadServers(true)));
$('#srv-add').addEventListener('click', () => { $('#srv-name').value = ''; $('#srv-addr').value = ''; $('#srv-error').textContent = ''; $('#modal-server').hidden = false; setTimeout(() => $('#srv-name').focus(), 30); });
$('#srv-cancel').addEventListener('click', () => { $('#modal-server').hidden = true; });
bindModal('modal-server');
async function addServer() {
  try {
    SRV.list = await call(window.api.servers.add({ name: $('#srv-name').value, address: $('#srv-addr').value }));
    $('#modal-server').hidden = true;
    renderServers(); for (const s of SRV.list) if (!SRV.status[s.id]) pingOne(s.id);
    toast('Сервер добавлен', 'ok');
  } catch (e) { $('#srv-error').textContent = e.message; }
}
$('#srv-ok').addEventListener('click', addServer);
$('#srv-addr').addEventListener('keydown', e => { if (e.key === 'Enter') addServer(); });

// =====================================================================
// Скины
// =====================================================================
const K = { current: null, staged: null, profileId: null };
function skinNote(p) {
  const n = $('#sk-note span');
  n.textContent = !p ? 'Создайте профиль, чтобы менять скин.'
    : p.type === 'offline'
      ? 'Скин офлайн-профиля хранится в лаунчере и подставляется в игру — его видите только вы (в одиночной игре и на серверах без проверки лицензии). Чтобы скин видели другие игроки, нужен аккаунт Microsoft.'
      : 'Скин загружается в ваш аккаунт Mojang и виден всем игрокам. Mojang ограничивает частоту смены — при ошибке подождите минуту.';
}
async function showSkin(url, slim, title, sub) {
  $('#sv-title').textContent = title; $('#sv-sub').textContent = sub || '';
  const norm = await viewerSetSkin(url, slim);
  setModelSeg(SV.slim);
  return norm;
}
function setModelSeg(slim) {
  const seg = $('#model-seg');
  seg.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', (b.dataset.model === 'slim') === !!slim));
  updatePill(seg);
}
async function loadSkinPage() {
  const p = curProfile();
  K.staged = null; $('#sk-staged').hidden = true; $('#sk-error').textContent = '';
  skinNote(p);
  const has = !!p;
  ['sk-pick', 'sk-save', 'sk-lookup'].forEach(id => { $('#' + id).disabled = !has; });
  if (!p) { K.profileId = null; viewerClear(); $('#sk-name').textContent = 'Нет профиля'; $('#sk-type').textContent = ''; $('#sk-head').removeAttribute('src'); $('#sv-title').textContent = '—'; $('#sv-sub').textContent = 'Создайте профиль'; return; }
  K.profileId = p.id;
  $('#sk-name').textContent = p.name;
  $('#sk-type').textContent = p.type === 'microsoft' ? 'Аккаунт Microsoft' : 'Offline профиль';
  const h = avatars[p.id] || (await loadAvatar(p.id));
  if (h) $('#sk-head').src = h; else $('#sk-head').removeAttribute('src');
  try {
    const cur = await call(window.api.skins.current(p.id));
    if (K.profileId !== p.id) return;
    K.current = cur;
    if (cur.skin) await showSkin(cur.skin, cur.slim, p.name, cur.local ? 'Сохранённый скин' : 'Текущий скин');
    else { viewerClear(); $('#sv-title').textContent = p.name; $('#sv-sub').textContent = 'Скин не задан — загрузите свой'; }
  } catch (e) { viewerClear(); $('#sv-title').textContent = p.name; $('#sv-sub').textContent = e.message; toast(e.message, 'err'); }
}
function onProfileChanged() { if ($('#page-skins').classList.contains('active')) loadSkinPage(); }
pageHooks.skins = () => { requestAnimationFrame(() => { updatePill($('#model-seg')); loadSkinPage(); }); };

async function stageSkin(url, slim, name, sub) {
  const norm = await showSkin(url, slim, name, sub || 'Предпросмотр');
  K.staged = { name };
  $('#sk-staged-name').textContent = name;
  $('#sk-staged').hidden = false;
  return norm;
}
$('#sk-pick').addEventListener('click', () => safe(async () => {
  const r = await call(window.api.skins.pick());
  if (r) await stageSkin(r.dataUrl, undefined, r.name);
}));
async function doLookup() {
  const nick = $('#sk-nick').value.trim();
  $('#sk-error').textContent = '';
  if (!nick) return;
  const b = $('#sk-lookup'); b.disabled = true; b.textContent = 'Ищу…';
  try {
    const r = await call(window.api.skins.lookup(nick));
    if (!r.skin) throw new Error('У этого игрока стандартный скин');
    await stageSkin(r.skin, r.slim, r.name, 'Скин игрока ' + r.name);
  } catch (e) { $('#sk-error').textContent = e.message; }
  finally { b.disabled = !K.profileId; b.textContent = 'Найти'; }
}
$('#sk-lookup').addEventListener('click', doLookup);
$('#sk-nick').addEventListener('keydown', e => { if (e.key === 'Enter') doLookup(); });
bindSeg($('#model-seg'), 'model', m => { SV.slim = m === 'slim'; buildModel(); });
$('#sk-cancel').addEventListener('click', () => loadSkinPage());
$('#sk-apply').addEventListener('click', () => safe(async () => {
  const p = curProfile();
  if (!p || !SV.norm) return;
  const b = $('#sk-apply'); b.disabled = true; b.textContent = 'Применяю…';
  try {
    const norm = SV.norm, vars = skinVariants(norm);
    const res = await call(window.api.skins.apply({ profileId: p.id, dataUrl: norm.url, slim: SV.slim, wide: vars.wide, slimSkin: vars.slim }));
    toast(p.type === 'offline' ? 'Скин сохранён и будет применён при запуске игры' : 'Скин загружен в аккаунт Microsoft', 'ok');
    avatars[p.id] = undefined; await loadAvatar(p.id, true);
    K.staged = null; $('#sk-staged').hidden = true;
    if (res && res.skin) K.current = res;
    renderDock();
    loadSkinPage();
  } finally { b.disabled = false; b.textContent = 'Применить'; }
}));
$('#sk-save').addEventListener('click', () => safe(async () => {
  if (!SV.url) { toast('Нечего сохранять — скин не задан', 'err'); return; }
  const ok = await call(window.api.skins.save({ dataUrl: SV.url, name: (curProfile() || { name: 'skin' }).name }));
  if (ok) toast('Скин сохранён', 'ok');
}));

// =====================================================================
// Скриншоты
// =====================================================================
const SH = { list: [], idx: -1, io: null };
async function loadShots() {
  const grid = $('#shot-grid');
  grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', 'shot')));
  try { SH.list = await call(window.api.shots.list()); } catch (e) { grid.replaceChildren(el('div', 'empty', e.message)); return; }
  renderShots();
}
function renderShots() {
  const grid = $('#shot-grid');
  grid.replaceChildren();
  $('#shots-sub').textContent = SH.list.length ? `Кадров: ${SH.list.length}` : 'Все кадры из всех сборок';
  if (!SH.list.length) {
    const e = el('div', 'empty'); e.append(el('b', '', 'Скриншотов пока нет'), 'Нажмите F2 в игре — кадры появятся здесь.');
    grid.appendChild(e); return;
  }
  if (SH.io) SH.io.disconnect();
  SH.io = new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      SH.io.unobserve(en.target);
      const i = Number(en.target.dataset.i);
      window.api.shots.thumb(SH.list[i].path).then(r => {
        if (!r.ok || !r.data) return;
        const im = el('img'); im.alt = ''; im.src = r.data;
        en.target.classList.add('loaded'); en.target.prepend(im);
      });
    }
  }, { root: grid, rootMargin: '200px' });
  SH.list.forEach((s, i) => {
    const t = el('div', 'shot'); t.dataset.i = i;
    t.appendChild(el('div', 'shot-cap', `${new Date(s.mtime).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.build === 'vanilla' ? 'Vanilla' : s.build}`));
    t.addEventListener('click', () => openLightbox(i));
    grid.appendChild(t); SH.io.observe(t);
  });
}
pageHooks.shots = () => loadShots();
$('#shots-refresh').addEventListener('click', loadShots);
$('#shots-folder').addEventListener('click', () => safe(() => call(window.api.shots.folder())));

let lb = null;
async function showLightbox() {
  const s = SH.list[SH.idx];
  if (!s || !lb) return;
  lb.cap.textContent = `${s.name} · ${SH.idx + 1} из ${SH.list.length}`;
  const r = await window.api.shots.full(s.path);
  if (!lb || SH.list[SH.idx] !== s) return;
  lb.img.replaceChildren();
  if (r.ok && r.data) { const im = el('img'); im.src = r.data; im.alt = ''; lb.img.appendChild(im); } else lb.img.textContent = 'Не удалось открыть изображение';
}
function openLightbox(i) {
  SH.idx = i;
  closeLightbox();
  const root = el('div', 'lightbox');
  const img = el('div', 'lb-img'), bar = el('div', 'lb-bar'), cap = el('span');
  const prev = el('button', 'lb-nav prev'); prev.appendChild(svgIcon(ICON.left));
  const next = el('button', 'lb-nav next'); next.appendChild(svgIcon(ICON.right));
  const close = el('button', 'btn icon ghost lb-close'); close.appendChild(svgIcon(ICON.x));
  const reveal = btn('sm', 'Показать в папке', () => safe(() => call(window.api.shots.reveal(SH.list[SH.idx].path))), 'folder');
  const del = btn('sm danger', 'В корзину', async () => {
    const s = SH.list[SH.idx];
    if (!(await confirmBox({ title: 'Удалить скриншот?', text: `${s.name} будет перемещён в корзину.` }))) return;
    await safe(async () => {
      await call(window.api.shots.remove(s.path));
      SH.list.splice(SH.idx, 1);
      renderShots();
      if (!SH.list.length) closeLightbox(); else { SH.idx = Math.min(SH.idx, SH.list.length - 1); showLightbox(); }
    });
  }, 'trash');
  bar.append(cap, reveal, del);
  root.append(img, bar, prev, next, close);
  root.addEventListener('click', e => { if (e.target === root || e.target === img) closeLightbox(); });
  close.addEventListener('click', closeLightbox);
  prev.addEventListener('click', () => { SH.idx = (SH.idx - 1 + SH.list.length) % SH.list.length; showLightbox(); });
  next.addEventListener('click', () => { SH.idx = (SH.idx + 1) % SH.list.length; showLightbox(); });
  document.body.appendChild(root);
  lb = { root, img, cap };
  showLightbox();
}
function closeLightbox() { if (lb) { lb.root.remove(); lb = null; } }
document.addEventListener('keydown', e => {
  if (!lb) return;
  if (e.key === 'ArrowLeft') lb.root.querySelector('.prev').click();
  if (e.key === 'ArrowRight') lb.root.querySelector('.next').click();
});
