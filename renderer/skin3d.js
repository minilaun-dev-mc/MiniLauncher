'use strict';
// 3D-просмотр скина на чистом CSS 3D и работа с раскладкой скина (без внешних библиотек)

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    i.src = url;
  });
}
function newCanvas(w = 64, h = 64) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false; return [c, x]; }
function flipDraw(ctx, src, sx, sy, sw, sh, dx, dy) {
  ctx.save(); ctx.translate(dx + sw, dy); ctx.scale(-1, 1);
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  ctx.restore();
}
// Раскладка граней коробки с началом (ox, oy): [имя, x, y, ширина, высота]
const boxFaces = (ox, oy, w, h, d) => ({
  top: [ox + d, oy, w, d], bottom: [ox + d + w, oy, w, d], right: [ox, oy + d, d, h],
  front: [ox + d, oy + d, w, h], left: [ox + d + w, oy + d, d, h], back: [ox + 2 * d + w, oy + d, w, h],
});

// Приводит скин к формату 64×64 (старые 64×32 достраиваются зеркалом левых конечностей)
async function normalizeSkin(url) {
  const img = await loadImage(url);
  if (img.width !== 64 || (img.height !== 64 && img.height !== 32)) throw new Error(`Скин должен быть 64×64 или 64×32, а здесь ${img.width}×${img.height}`);
  const [c, x] = newCanvas();
  x.drawImage(img, 0, 0);
  if (img.height === 32) {
    for (const [sx, sy, dx, dy] of [[0, 16, 16, 48], [40, 16, 32, 48]]) {
      const s = boxFaces(sx, sy, 4, 12, 4), t = boxFaces(dx, dy, 4, 12, 4);
      const map = { top: 'top', bottom: 'bottom', front: 'front', back: 'back', right: 'left', left: 'right' };
      for (const k of Object.keys(s)) { const [a, b, w, h] = s[k], [tx, ty] = t[map[k]]; flipDraw(x, c, a, b, w, h, tx, ty); }
    }
  }
  // Определение «тонкой» модели: у Alex правый столбец руки прозрачный
  const slim = x.getImageData(55, 20, 1, 1).data[3] === 0 && x.getImageData(47, 52, 1, 1).data[3] === 0;
  return { canvas: c, url: c.toDataURL('image/png'), slim };
}

// Перерисовка рук под другую ширину (4 пикселя «Steve» ↔ 3 пикселя «Alex»)
function convertArms(srcCanvas, fromW, toW) {
  const [c, x] = newCanvas();
  x.drawImage(srcCanvas, 0, 0);
  for (const [ox, oy] of [[40, 16], [40, 32], [32, 48], [48, 48]]) {
    const from = boxFaces(ox, oy, fromW, 12, 4), to = boxFaces(ox, oy, toW, 12, 4);
    x.clearRect(ox, oy, 16, 16);
    for (const k of Object.keys(from)) {
      const [sx, sy, sw, sh] = from[k], [dx, dy, dw, dh] = to[k];
      if (sw === dw) { x.drawImage(srcCanvas, sx, sy, sw, sh, dx, dy, dw, dh); continue; }
      for (let j = 0; j < dw; j++) {
        const i = Math.min(sw - 1, Math.round(j * (sw - 1) / Math.max(1, dw - 1)));
        x.drawImage(srcCanvas, sx + i, sy, 1, sh, dx + j, dy, 1, dh);
      }
    }
  }
  return c;
}
// Оба варианта модели для офлайн-режима (игра выбирает вариант сама)
function skinVariants(norm) {
  const wide = norm.slim ? convertArms(norm.canvas, 3, 4) : norm.canvas;
  const slim = norm.slim ? norm.canvas : convertArms(norm.canvas, 4, 3);
  return { wide: wide.toDataURL('image/png'), slim: slim.toDataURL('image/png') };
}

// ---------- 3D-модель ----------
const SV = { k: 8, url: null, slim: false, overlay: true, rx: -12, ry: -28, drag: null, idle: 0, built: false };

function makeBox(w, h, d, u, v, inflate, url, k) {
  const box = el('div', 'sv-box');
  const faces = boxFaces(u, v, w, h, d);
  const W = w + inflate * 2, H = h + inflate * 2, D = d + inflate * 2;
  const spec = {
    front: [W, H, `translateZ(${D / 2 * k}px)`], back: [W, H, `rotateY(180deg) translateZ(${D / 2 * k}px)`],
    right: [D, H, `rotateY(-90deg) translateZ(${W / 2 * k}px)`], left: [D, H, `rotateY(90deg) translateZ(${W / 2 * k}px)`],
    top: [W, D, `rotateX(90deg) translateZ(${H / 2 * k}px)`], bottom: [W, D, `rotateX(-90deg) translateZ(${H / 2 * k}px)`],
  };
  for (const name of Object.keys(spec)) {
    const [fw, fh, tf] = spec[name], [fx, fy, fuw, fuh] = faces[name];
    const f = el('div', 'sv-face');
    const sx = fw / fuw, sy = fh / fuh;
    f.style.cssText = `width:${fw * k}px;height:${fh * k}px;left:${-fw * k / 2}px;top:${-fh * k / 2}px;transform:${tf};` +
      `background-image:url(${url});background-size:${64 * k * sx}px ${64 * k * sy}px;background-position:${-fx * k * sx}px ${-fy * k * sy}px`;
    box.appendChild(f);
  }
  return box;
}
// Часть тела: pivot — точка вращения (верх конечности), центр коробки смещён вниз на h/2
function makePart(cls, cx, topY, w, h, d, u, v, ou, ov, url, k, overlay, swing) {
  const part = el('div', 'sv-part ' + cls);
  part.style.transform = `translate3d(${cx * k}px, ${topY * k}px, 0)`;
  const sw = el('div', 'sv-swing');
  const holder = el('div', 'sv-part');
  holder.style.transform = `translateY(${h / 2 * k}px)`;
  holder.appendChild(makeBox(w, h, d, u, v, 0, url, k));
  if (overlay) holder.appendChild(makeBox(w, h, d, ou, ov, 0.45, url, k));
  sw.appendChild(holder);
  part.appendChild(sw);
  if (!swing) sw.style.animation = 'none';
  return part;
}
function buildModel() {
  const model = $('#sv-model');
  model.replaceChildren();
  if (!SV.url) return;
  const { k, url, slim, overlay } = SV, aw = slim ? 3 : 4;
  const parts = [
    makePart('sv-head', 0, -16, 8, 8, 8, 0, 0, 32, 0, url, k, overlay, false),
    makePart('sv-body', 0, -8, 8, 12, 4, 16, 16, 16, 32, url, k, overlay, false),
    makePart('sv-arm-r', -(4 + aw / 2), -8, aw, 12, 4, 40, 16, 40, 32, url, k, overlay, true),
    makePart('sv-arm-l', 4 + aw / 2, -8, aw, 12, 4, 32, 48, 48, 48, url, k, overlay, true),
    makePart('sv-leg-r', -2, 4, 4, 12, 4, 0, 16, 0, 32, url, k, overlay, true),
    makePart('sv-leg-l', 2, 4, 4, 12, 4, 16, 48, 0, 48, url, k, overlay, true),
  ];
  // голова не должна «качаться» — у неё нет класса конечности; сдвиг по высоте даёт её центр
  parts[0].querySelector('.sv-part').style.transform = `translateY(${4 * k}px)`;
  parts[1].querySelector('.sv-part').style.transform = `translateY(${6 * k}px)`;
  model.append(...parts);
  applyRotation();
  SV.built = true;
}
function applyRotation() {
  const m = $('#sv-model');
  if (m) m.style.transform = `rotateX(${SV.rx}deg) rotateY(${SV.ry}deg)`;
}
function fitScale() {
  const h = $('#sv-stage').clientHeight;
  return h ? Math.max(5, Math.min(11, Math.floor(h * 0.7 / 32))) : 8;
}
async function viewerSetSkin(dataUrl, slimOverride) {
  $('#sv-loading').hidden = false;
  try {
    const norm = await normalizeSkin(dataUrl);
    SV.norm = norm; SV.url = norm.url;
    SV.slim = slimOverride === undefined || slimOverride === null ? norm.slim : !!slimOverride;
    SV.k = fitScale();
    buildModel();
    return norm;
  } finally { $('#sv-loading').hidden = true; }
}
function viewerClear() { SV.url = null; SV.norm = null; $('#sv-model').replaceChildren(); }
function viewerRebuild() { if (SV.url) { SV.k = fitScale(); buildModel(); } }

(function initViewerInput() {
  const stage = $('#sv-stage');
  stage.addEventListener('pointerdown', e => { SV.drag = { x: e.clientX, y: e.clientY, rx: SV.rx, ry: SV.ry }; SV.idle = 0; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => {
    if (!SV.drag) return;
    SV.ry = SV.drag.ry + (e.clientX - SV.drag.x) * 0.6;
    SV.rx = Math.max(-80, Math.min(80, SV.drag.rx - (e.clientY - SV.drag.y) * 0.5));
    applyRotation();
  });
  const end = () => { SV.drag = null; SV.idle = performance.now(); };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  $('#sv-walk').addEventListener('click', () => { const on = stage.classList.toggle('walking'); $('#sv-walk').classList.toggle('primary', on); });
  $('#sv-reset').addEventListener('click', () => { SV.rx = -12; SV.ry = -28; applyRotation(); });
  window.addEventListener('resize', () => { if ($('#page-skins').classList.contains('active') && fitScale() !== SV.k) viewerRebuild(); });
  // медленное автовращение, пока модель не трогают
  let last = performance.now();
  (function loop(t) {
    const dt = t - last; last = t;
    if (!SV.drag && SV.url && $('#page-skins').classList.contains('active') && document.documentElement.dataset.motion !== 'off' && t - SV.idle > 2500) {
      SV.ry += dt * 0.012; applyRotation();
    }
    requestAnimationFrame(loop);
  })(last);
})();
