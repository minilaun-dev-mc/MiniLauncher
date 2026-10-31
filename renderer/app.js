'use strict';
// Точка входа: запускается последней, когда все модули загружены

(async function init() {
  nextQuote(true);
  makeParticles();
  requestAnimationFrame(() => { moveIndicator(); updateAllPills(); });
  await safe(async () => {
    applyState(await call(window.api.getState()));
    await refreshInstalled();
    renderAll();
  });
  await safe(async () => {
    S.remote = await call(window.api.remoteVersions());
    renderVersions();
  });
  call(window.api.checkJava()).then(r => {
    if (!r.version && !(r.bundled && r.bundled.length)) toast('Java не найдена. Без неё игра не запустится — см. «Настройки».', 'err');
  }).catch(() => {});
  checkUpdate().catch(() => {});
  setTimeout(() => { moveIndicator(); updateAllPills(); }, 150);
})();
