'use strict';

// mastertool.download istemcisi ve anahtar türetme (Mastertool sözleşmesi v1).
//   master    = PBKDF2-SHA256(şifre, base64dec(salt), iter, 32)
//   auth_hash = base64(PBKDF2-SHA256(anahtar = master, tuz = şifre_utf8, 1, 32))

const crypto = require('crypto');

const API_BASE = (process.env.MT_API || 'https://mastertool.download').replace(/\/+$/, '');

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const pbkdf2 = (pass, salt, iter, len) =>
  new Promise((resolve, reject) => crypto.pbkdf2(pass, salt, iter, len, 'sha256', (e, k) => (e ? reject(e) : resolve(k))));

async function deriveKeys(password, kdf) {
  if (!kdf || kdf.alg !== 'PBKDF2-SHA256' || !kdf.salt || !kdf.iter) throw new ApiError(0, 'unsupported_kdf');
  const pw = Buffer.from(String(password), 'utf8');
  const master = await pbkdf2(pw, Buffer.from(kdf.salt, 'base64'), Number(kdf.iter), 32);
  const authHash = (await pbkdf2(master, pw, 1, 32)).toString('base64');
  return { master, authHash };
}

// Hata gövdesi {"code","message","detail"}; çevrimdışı → code "offline"
async function readError(res) {
  let json = null;
  try { json = await res.json(); } catch { /* boş gövde */ }
  const code = (json && (json.code || json.detail)) || `http_${res.status}`;
  const err = new ApiError(res.status, typeof code === 'string' ? code : `http_${res.status}`, json && json.message);
  err.body = json;
  return err;
}

function createApi({ base = API_BASE, fetchImpl = (...a) => fetch(...a) } = {}) {
  async function request(method, route, { token, body, timeout = 20000 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetchImpl(base + route, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
    } catch {
      throw new ApiError(0, 'offline', 'offline');
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw await readError(res);
    try { return (await res.json()) || {}; } catch { return {}; }
  }
  return { base, request, fetch: fetchImpl };
}

function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

module.exports = { API_BASE, ApiError, createApi, deriveKeys, readError, compareVersions };
