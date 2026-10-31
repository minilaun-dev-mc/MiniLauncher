'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const S = { page: 0, info: null, installing: false, result: null, update: false };

const fmtMB = b => Math.max(1, Math.round(b / 1048576)) + ' МБ';
const fmtGB = b => (b / 1073741824).toFixed(1) + ' ГБ';
const validPath = p => /^[a-zA-Z]:[\\/][^<>:"|?*]*$/.test(p) || /^\\\\[^\\]+\\[^\\]+/.test(p) || /^\//.test(p);

// ---------- Навигация ----------
function go(n) {
  S.page = n;
  $$('.page').forEach(p => p.classList.toggle('active', Number(p.dataset.page) === n));
  $$('#steps li').forEach(li => {
    const i = Number(li.dataset.step);
    li.classList.toggle('active', i === n);
    li.classList.toggle('done', i < n);
  });
  updateFooter();
  if (n === 1) requestAnimationFrame(() => movePill());
}

function updateFooter() {
  const foot = $('#foot'), back = $('#back'), next = $('#next');
  foot.hidden = S.page === 3;      // во время установки кнопок нет
  back.style.visibility = (S.page === 0 || S.page === 4) ? 'hidden' : 'visible';
  const labels = ['Далее', 'Далее', 'Установить', '', $('#o-launch').checked ? 'Запустить' : 'Закрыть'];
  next.textContent = labels[S.page];
  next.disabled =
    (S.page === 0 && !(S.info && S.info.hasPayload)) ||
    (S.page === 1 && !$('#accept').checked) ||
    (S.page === 2 && !optionsOk());
}

$('#back').addEventListener('click', () => go(S.page - 1));
$('#next').addEventListener('click', async () => {
  if (S.page === 2) return startInstall();
  if (S.page === 4) return finish();
  go(S.page + 1);
});
$('#min').addEventListener('click', () => window.setup.minimize());
$('#close').addEventListener('click', () => window.setup.close());

// ---------- Соглашения ----------
const docs = { license: '', java: '' };
function movePill() {
  const seg = $('#legal-tabs'), a = seg.querySelector('.active'), pill = seg.querySelector('.pill');
  if (!a || !a.offsetWidth) return;
  pill.style.width = a.offsetWidth + 'px';
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
$('#legal-tabs').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  $$('#legal-tabs .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  movePill();
  const d = $('#doc');
  d.textContent = docs[b.dataset.t];
  d.scrollTop = 0;
  d.classList.remove('swap'); void d.offsetWidth; d.classList.add('swap');
});
$('#accept').addEventListener('change', updateFooter);
$('#o-launch').addEventListener('change', updateFooter);

// ---------- Параметры ----------
let freeTimer = null;
function optionsOk() {
  const dir = $('#dir').value.trim();
  if (!validPath(dir)) return false;
  if (S.info && S.info.free != null && S.info.free < S.info.bytes * 1.1) return false;
  return true;
}
function refreshSpace() {
  clearTimeout(freeTimer);
  freeTimer = setTimeout(async () => {
    const dir = $('#dir').value.trim();
    const el = $('#space'), err = $('#o-err');
    err.textContent = '';
    if (!validPath(dir)) { el.textContent = 'Укажите полный путь, например C:\\Users\\Вы\\MiniLauncher'; el.className = 'hint bad'; updateFooter(); return; }
    const r = await window.setup.freeSpace(dir);
    S.info.free = r.ok ? r.data : null;
    const need = S.info.bytes;
    if (S.info.free != null && S.info.free < need * 1.1) {
      el.textContent = `Недостаточно места: нужно ${fmtMB(need)}, свободно ${fmtMB(S.info.free)}`; el.className = 'hint bad';
    } else {
      el.textContent = `Потребуется ${fmtMB(need)}` + (S.info.free != null ? ` · свободно ${fmtGB(S.info.free)}` : '');
      el.className = 'hint';
    }
    updateFooter();
  }, 150);
}
$('#dir').addEventListener('input', refreshSpace);
$('#browse').addEventListener('click', async () => {
  const r = await window.setup.pickDir($('#dir').value);
  if (r.ok && r.data) { $('#dir').value = r.data.replace(/[\\/]+$/, '') + ((/MiniLauncher$/i.test(r.data)) ? '' : '\\MiniLauncher'); refreshSpace(); }
});

// ---------- Установка ----------
window.setup.onProgress(({ percent, stage, file }) => {
  $('#bar').style.width = percent + '%';
  $('#i-pct').textContent = percent + '%';
  if (stage) $('#i-stage').textContent = stage;
  $('#i-file').textContent = file ? '\u200E' + file : '';
});

async function startInstall() {
  if (S.installing) return;
  S.installing = true;
  $('#close').disabled = true;
  $('#i-fail').hidden = true;
  $('#i-title').textContent = S.update ? 'Обновляю MiniLauncher…' : 'Устанавливаю…';
  $('#bar').style.width = '0'; $('#i-pct').textContent = '0%';
  go(3);
  const r = await window.setup.install({
    dir: $('#dir').value.trim(),
    desktop: $('#o-desktop').checked,
    startMenu: $('#o-start').checked,
  });
  S.installing = false;
  $('#close').disabled = false;
  if (!r.ok) {
    $('#i-title').textContent = 'Не удалось установить';
    $('#i-stage').textContent = '';
    $('#i-err').textContent = r.error;
    $('#i-fail').hidden = false;
    return;
  }
  S.result = r.data;
  if (S.update) {                 // при обновлении сразу открываем лаунчер
    $('#i-stage').textContent = 'Запускаю MiniLauncher…';
    setTimeout(() => window.setup.launch(S.result.exe), 700);
    return;
  }
  $('#d-text').textContent = `MiniLauncher ${S.result.version || ''} установлен в папку:\n${S.result.dir}`.replace('  ', ' ');
  $('#d-text').style.whiteSpace = 'pre-line';
  go(4);
}
$('#i-retry').addEventListener('click', startInstall);
$('#i-close').addEventListener('click', () => window.setup.quit());

async function finish() {
  if ($('#o-launch').checked && S.result) await window.setup.launch(S.result.exe);
  else window.setup.quit();
}

// ---------- Старт ----------
(async function init() {
  const r = await window.setup.init();
  if (!r.ok) { $('#w-err').textContent = r.error; return; }
  S.info = r.data;
  S.update = r.data.update;
  docs.license = r.data.legal.license;
  docs.java = r.data.legal.java;
  $('#doc').textContent = docs.license;
  $('#dir').value = r.data.dir;
  $('#ver').textContent = (S.update ? 'Обновление ' : 'Установка ') + (r.data.version || '');
  if (!r.data.hasPayload) $('#w-err').textContent = 'В установщике нет данных (payload.zip). Соберите его командой npm run build.';
  refreshSpace();
  if (S.update) { startInstall(); return; }   // режим обновления: без вопросов
  go(0);
})();
