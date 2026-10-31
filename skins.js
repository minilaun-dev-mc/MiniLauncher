'use strict';
// Работа со скинами: профиль Mojang, текстуры, загрузка скина. Без зависимостей от Electron.
const TEXTURE_HOST = 'textures.minecraft.net';
const UA = { 'User-Agent': 'MiniLauncher' };

// Проверка PNG и размеров скина (64×64 или старый 64×32)
function pngInfo(buf) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf || buf.length < 24 || !buf.subarray(0, 8).equals(sig)) throw new Error('Это не PNG-файл');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function assertSkinPng(buf) {
  const { width, height } = pngInfo(buf);
  if (width !== 64 || (height !== 64 && height !== 32)) throw new Error(`Скин должен быть 64×64 (или 64×32), а у файла ${width}×${height}`);
  if (buf.length > 24 * 1024) throw new Error('Файл скина слишком большой (больше 24 КБ)');
  return { width, height };
}

// Из профиля сессионного сервера достаём ссылку на скин и тип модели
function parseTextures(profile) {
  const prop = (profile.properties || []).find(p => p.name === 'textures');
  if (!prop) return { skinUrl: null, slim: false, capeUrl: null };
  const data = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'));
  const skin = data.textures && data.textures.SKIN;
  const cape = data.textures && data.textures.CAPE;
  return { skinUrl: skin ? skin.url : null, slim: !!(skin && skin.metadata && skin.metadata.model === 'slim'), capeUrl: cape ? cape.url : null };
}

// Качаем только с официального хоста текстур
async function textureDataUrl(url, fetchImpl = fetch) {
  const u = new URL(url);
  if (u.hostname !== TEXTURE_HOST) throw new Error('Недопустимый адрес текстуры');
  u.protocol = 'https:';
  const r = await fetchImpl(u.toString(), { headers: UA });
  if (!r.ok) throw new Error(`Текстура недоступна (HTTP ${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 200 * 1024) throw new Error('Слишком большой файл текстуры');
  pngInfo(buf);
  return 'data:image/png;base64,' + buf.toString('base64');
}

// Публичный профиль по UUID (токен не нужен)
async function byUuid(uuid, fetchImpl = fetch) {
  const id = String(uuid).replace(/-/g, '');
  const p = await fetchImpl(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { headers: UA });
  if (p.status === 204 || p.status === 404) return null;
  if (!p.ok) throw new Error(`Сервер сессий: HTTP ${p.status} (возможно, слишком частые запросы)`);
  const j = await p.json();
  const t = parseTextures(j);
  return { name: j.name, uuid: id, slim: t.slim, skin: t.skinUrl ? await textureDataUrl(t.skinUrl, fetchImpl) : null };
}

async function lookupByName(name, fetchImpl = fetch) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  const a = await fetchImpl(`https://api.mojang.com/users/profiles/minecraft/${name}`, { headers: UA });
  if (a.status === 404 || a.status === 204) throw new Error('Игрок с таким ником не найден');
  if (!a.ok) throw new Error(`Mojang API: HTTP ${a.status}`);
  const { id } = await a.json();
  const r = await byUuid(id, fetchImpl);
  if (!r) throw new Error('Игрок с таким ником не найден');
  return r;
}

// Профиль самого игрока (нужен токен Microsoft-аккаунта)
async function ownSkin(token, fetchImpl = fetch) {
  const r = await fetchImpl('https://api.minecraftservices.com/minecraft/profile', { headers: { ...UA, Authorization: `Bearer ${token}` } });
  if (r.status === 401) throw new Error('Сессия Microsoft устарела — войдите заново');
  if (r.status === 404) throw new Error('У этого аккаунта нет профиля Minecraft Java Edition');
  if (!r.ok) throw new Error(`Minecraft Services: HTTP ${r.status}`);
  const j = await r.json();
  const active = (j.skins || []).find(s => s.state === 'ACTIVE') || (j.skins || [])[0];
  return { name: j.name, uuid: j.id, slim: !!(active && active.variant === 'SLIM'), skin: active && active.url ? await textureDataUrl(active.url, fetchImpl) : null };
}

async function uploadSkin(token, pngBuffer, variant, fetchImpl = fetch) {
  assertSkinPng(pngBuffer);
  const fd = new FormData();
  fd.append('variant', variant === 'slim' ? 'slim' : 'classic');
  fd.append('file', new Blob([pngBuffer], { type: 'image/png' }), 'skin.png');
  const r = await fetchImpl('https://api.minecraftservices.com/minecraft/profile/skins', { method: 'POST', headers: { ...UA, Authorization: `Bearer ${token}` }, body: fd });
  if (r.status === 401) throw new Error('Сессия Microsoft устарела — войдите заново');
  if (r.status === 429) throw new Error('Слишком много запросов, подождите минуту');
  if (!r.ok) throw new Error(`Не удалось загрузить скин (HTTP ${r.status})`);
  return true;
}

module.exports = { pngInfo, assertSkinPng, parseTextures, textureDataUrl, byUuid, lookupByName, ownSkin, uploadSkin };
