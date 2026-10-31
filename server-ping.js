'use strict';
// Состояние сервера Minecraft по протоколу Server List Ping. Без зависимостей от Electron.
const net = require('net');
const dns = require('dns').promises;

const writeVarInt = n => {
  const out = [];
  n >>>= 0;
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
  return Buffer.from(out);
};
function readVarInt(buf, offset = 0) {
  let result = 0, shift = 0, i = offset;
  for (;;) {
    if (i >= buf.length) return null;               // данных ещё не хватает
    const b = buf[i++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
    if (shift > 35) throw new Error('Некорректный VarInt');
  }
  return { value: result >>> 0, size: i - offset };
}
const packet = (id, payload = Buffer.alloc(0)) => {
  const body = Buffer.concat([writeVarInt(id), payload]);
  return Buffer.concat([writeVarInt(body.length), body]);
};
const str = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([writeVarInt(b.length), b]); };

// Описание сервера бывает строкой или «чат-компонентом» — приводим к простому тексту
function flattenChat(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c.replace(/§[0-9a-fk-or]/gi, '');
  if (Array.isArray(c)) return c.map(flattenChat).join('');
  let s = typeof c.text === 'string' ? c.text.replace(/§[0-9a-fk-or]/gi, '') : '';
  if (c.extra) s += flattenChat(c.extra);
  return s;
}

// Адрес вида host или host:port (в том числе [ipv6]:port)
function parseAddress(input) {
  const s = String(input || '').trim();
  let m = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  if (m) return { host: m[1], port: m[2] ? Number(m[2]) : 25565, explicit: !!m[2] };
  m = /^([^:\s]+)(?::(\d{1,5}))?$/.exec(s);
  if (!m) return null;
  const port = m[2] ? Number(m[2]) : 25565;
  if (port < 1 || port > 65535) return null;
  return { host: m[1], port, explicit: !!m[2] };
}

// Если порт не указан — смотрим SRV-запись _minecraft._tcp
async function resolveTarget(addr) {
  if (addr.explicit || net.isIP(addr.host)) return addr;
  try {
    const srv = await dns.resolveSrv(`_minecraft._tcp.${addr.host}`);
    if (srv && srv.length) return { host: srv[0].name, port: srv[0].port, explicit: true, via: addr.host };
  } catch { /* SRV нет — обычный адрес */ }
  return addr;
}

function ping(addr, timeoutMs = 4000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let done = false;
    let buf = Buffer.alloc(0);
    let status = null, statusAt = 0, pingSentAt = 0;
    const sock = net.connect({ host: addr.host, port: addr.port });
    const finish = res => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); resolve(res); };
    const timer = setTimeout(() => finish(status ? build(status, statusAt - t0) : { online: false, error: 'Нет ответа' }), timeoutMs);

    const build = (json, latency) => {
      let favicon = null;
      if (typeof json.favicon === 'string' && /^data:image\/png;base64,/.test(json.favicon) && json.favicon.length < 200000) favicon = json.favicon;
      return {
        online: true, latency,
        version: json.version ? { name: String(json.version.name || ''), protocol: json.version.protocol } : null,
        players: { online: (json.players && json.players.online) || 0, max: (json.players && json.players.max) || 0, sample: ((json.players && json.players.sample) || []).slice(0, 12).map(p => String(p.name || '')) },
        motd: flattenChat(json.description).trim(),
        favicon,
      };
    };

    sock.setTimeout(timeoutMs);
    sock.on('timeout', () => finish(status ? build(status, statusAt - t0) : { online: false, error: 'Тайм-аут' }));
    sock.on('error', e => finish({ online: false, error: e.code === 'ECONNREFUSED' ? 'Отказ в соединении' : e.code === 'ENOTFOUND' ? 'Адрес не найден' : (e.message || 'Ошибка') }));
    sock.on('close', () => finish(status ? build(status, statusAt - t0) : { online: false, error: 'Соединение закрыто' }));

    sock.on('connect', () => {
      const port = Buffer.alloc(2); port.writeUInt16BE(addr.port);
      const hs = Buffer.concat([writeVarInt(767), str(addr.via || addr.host), port, writeVarInt(1)]);
      sock.write(Buffer.concat([packet(0x00, hs), packet(0x00)]));      // рукопожатие + запрос статуса
    });

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const len = readVarInt(buf);
        if (!len || buf.length < len.size + len.value) return;           // пакет пришёл не целиком
        const body = buf.subarray(len.size, len.size + len.value);
        buf = buf.subarray(len.size + len.value);
        const id = readVarInt(body);
        if (!id) return;
        const payload = body.subarray(id.size);
        if (id.value === 0x00 && !status) {
          const sl = readVarInt(payload);
          if (!sl) return finish({ online: false, error: 'Некорректный ответ' });
          try { status = JSON.parse(payload.subarray(sl.size, sl.size + sl.value).toString('utf8')); }
          catch { return finish({ online: false, error: 'Некорректный ответ' }); }
          statusAt = Date.now();
          const t = Buffer.alloc(8); t.writeBigInt64BE(BigInt(statusAt));
          pingSentAt = Date.now();
          sock.write(packet(0x01, t));                                     // настоящий замер пинга
        } else if (id.value === 0x01 && status) {
          return finish(build(status, Math.max(1, Date.now() - pingSentAt)));
        }
      }
    });
  });
}

async function pingServer(input, timeoutMs) {
  const addr = parseAddress(input);
  if (!addr) return { online: false, error: 'Неверный адрес' };
  return ping(await resolveTarget(addr), timeoutMs);
}

module.exports = { pingServer, parseAddress, flattenChat, writeVarInt, readVarInt };
