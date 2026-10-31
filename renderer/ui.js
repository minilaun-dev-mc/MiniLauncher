'use strict';
// Общие помощники интерфейса: DOM, тосты, окно, навигация, тема, подтверждение

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const svgIcon = d => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); return s; };
const ICON = {
  play: 'M8 5v14l11-7z', trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3', folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14', server: 'M3 6a2 2 0 012-2h14a2 2 0 012 2v4H3V6zM3 14h18v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z', left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', x: 'M6 6l12 12M18 6L6 18',
};

// ---------- Вызовы API ----------
async function call(promise) {
  const r = await promise;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
function toast(msg, kind = '') {
  const t = el('div', 'toast ' + kind, msg);
  const life = kind === 'err' ? 7000 : 3500;
  t.style.setProperty('--life', life + 'ms');
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), life);
  setTimeout(() => t.remove(), life + 350);
}
async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message, 'err'); }
}

// ---------- Форматирование ----------
const fmtDate = iso => (iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
function fmtDuration(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return h >= 100 ? `${h} ч` : `${h} ч ${m % 60} мин`;
}
function fmtSize(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' МБ';
  return Math.max(1, Math.round(b / 1024)) + ' КБ';
}
const fmtNum = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + ' млн' : n >= 1e3 ? Math.round(n / 1e3) + ' тыс' : String(n));
function ago(ms) {
  const d = Date.now() - ms;
  if (d < 3600e3) return Math.max(1, Math.round(d / 60e3)) + ' мин назад';
  if (d < 86400e3) return Math.round(d / 3600e3) + ' ч назад';
  return Math.round(d / 86400e3) + ' дн назад';
}

// ---------- Эффект волны на кнопках ----------
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.btn');
  if (!b || b.disabled || document.documentElement.dataset.motion === 'off') return;
  const r = b.getBoundingClientRect();
  const size = Math.max(r.width, r.height);
  const s = el('span', 'rip');
  s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
  b.appendChild(s);
  setTimeout(() => s.remove(), 650);
});

// ---------- Окно ----------
$('#wc-min').addEventListener('click', () => window.api.win.minimize());
$('#wc-max').addEventListener('click', () => window.api.win.maximize());
$('#wc-close').addEventListener('click', () => window.api.win.close());
$('.titlebar').addEventListener('dblclick', e => { if (!e.target.closest('.win-controls')) window.api.win.maximize(); });
window.api.win.onState(({ maximized }) => {
  $('#wc-max-ico').innerHTML = maximized
    ? '<rect x="3.4" y="1.8" width="6.8" height="6.8" rx="1"/><path d="M1.8 4.2v5a1 1 0 001 1h5"/>'
    : '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1"/>';
  requestAnimationFrame(() => { moveIndicator(); updateAllPills(); });
});

// ---------- Навигация ----------
const pageHooks = {};                      // name -> функция, вызывается при открытии страницы
function moveIndicator() {
  const a = $('.nav-item.active'), ind = $('#nav-indicator');
  if (a) { ind.style.height = a.offsetHeight + 'px'; ind.style.transform = `translateY(${a.offsetTop}px)`; }
}
function showPage(name) {
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  moveIndicator();
  requestAnimationFrame(updateAllPills);
  if (pageHooks[name]) pageHooks[name]();
}
$$('.nav-item').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));

function updatePill(seg) {
  const a = seg.querySelector('.active'), pill = seg.querySelector('.seg-pill');
  if (!a || !pill || !a.offsetWidth) return;
  pill.style.width = a.offsetWidth + 'px';
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
function updateAllPills() { $$('.seg').forEach(updatePill); }
window.addEventListener('resize', () => { moveIndicator(); updateAllPills(); });
// Универсальная привязка сегментного переключателя
function bindSeg(seg, attr, onChange) {
  seg.addEventListener('click', e => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    seg.querySelectorAll('.seg-btn').forEach(x => x.classList.toggle('active', x === b));
    updatePill(seg);
    onChange(b.dataset[attr]);
  });
}

// ---------- Тема ----------
const ACCENTS = ['#ffd633', '#ff9f43', '#ff6b8b', '#b57bff', '#5aa8ff', '#3ddbb0', '#ff5c5c'];
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function applyAccent(hex) {
  if (!/^#[0-9a-f]{6}$/i.test(hex || '')) hex = '#ffd633';
  const [h, s, l] = hexToHsl(hex);
  const root = document.documentElement.style;
  const n = parseInt(hex.slice(1), 16);
  root.setProperty('--accent', hex);
  root.setProperty('--accent-hi', `hsl(${h} ${Math.min(100, s)}% ${Math.min(88, l + 12)}%)`);
  root.setProperty('--accent-lo', `hsl(${h} ${Math.min(100, s)}% ${Math.max(28, l - 12)}%)`);
  root.setProperty('--accent-rgb', `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`);
  root.setProperty('--on-accent', l > 52 ? '#131313' : '#ffffff');
  $$('.swatch').forEach(s2 => s2.classList.toggle('active', s2.dataset.color === hex.toLowerCase()));
}
function applyMotion(reduce) { document.documentElement.dataset.motion = reduce ? 'off' : 'on'; }

// ---------- Подтверждение (вместо системного confirm) ----------
let confirmDone = null;
function confirmBox({ title = 'Подтверждение', text = '', yes = 'Удалить', danger = true }) {
  return new Promise(resolve => {
    $('#cf-title').textContent = title;
    $('#cf-text').textContent = text;
    const y = $('#cf-yes');
    y.textContent = yes;
    y.className = 'btn ' + (danger ? 'danger-fill' : 'primary');
    $('#modal-confirm').hidden = false;
    confirmDone = v => { $('#modal-confirm').hidden = true; confirmDone = null; resolve(v); };
    y.focus();
  });
}
$('#cf-yes').addEventListener('click', () => confirmDone && confirmDone(true));
$('#cf-no').addEventListener('click', () => confirmDone && confirmDone(false));
$('#modal-confirm').addEventListener('click', e => { if (e.target.id === 'modal-confirm' && confirmDone) confirmDone(false); });

// Закрытие модалок по клику на фон
function bindModal(id, onClose) {
  const m = $('#' + id);
  m.addEventListener('click', e => { if (e.target === m) { m.hidden = true; if (onClose) onClose(); } });
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (confirmDone) { confirmDone(false); return; }
  $$('.modal:not([hidden])').forEach(m => { m.hidden = true; });
  closeMenus();
  if (typeof closeLightbox === 'function') closeLightbox();
});

// ---------- Выпадающие меню ----------
function closeMenus() {
  $$('.menu').forEach(m => { m.hidden = true; });
  $$('.profile.open, .dd.open').forEach(x => x.classList.remove('open'));
}
function toggleMenu(wrapSel, menuSel, onOpen) {
  const wrap = $(wrapSel), menu = $(menuSel);
  const wasHidden = menu.hidden;
  closeMenus();
  if (wasHidden) { if (onOpen) onOpen(); menu.hidden = false; wrap.classList.add('open'); }
}
document.addEventListener('click', e => { if (!e.target.closest('.profile') && !e.target.closest('.dd')) closeMenus(); });
