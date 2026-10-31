'use strict';
const $ = s => document.querySelector(s);

$('#un-x').addEventListener('click', () => window.api.win.close());
$('#un-cancel').addEventListener('click', () => window.api.win.close());

(async () => {
  try {
    const r = await window.api.uninstallInfo();
    if (r.ok) {
      $('#un-path').textContent = r.data.dir;
      $('#un-data-path').textContent = r.data.dataDir;
    }
  } catch (_) { /* не критично */ }
})();

$('#un-ok').addEventListener('click', async () => {
  const btn = $('#un-ok');
  btn.disabled = true; btn.textContent = 'Удаляю…';
  $('#un-err').textContent = '';
  const r = await window.api.uninstall({ removeData: $('#un-data').checked });
  if (!r.ok) {
    btn.disabled = false; btn.textContent = 'Удалить';
    $('#un-err').textContent = r.error;
    return;
  }
  $('#step-ask').hidden = true;
  $('#step-done').hidden = false;
});
