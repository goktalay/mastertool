'use strict';

// Kurulum dosyası indirme (sözleşme v1 §3, §4): GET /api/mt/apps/<app>/download?kind=setup
// %APPDATA%\Mastertool\downloads\<dosya>.part'a yazılır, X-Sha256 ile doğrulanır (uymazsa silinir),
// sonra asıl adına taşınır. İptal (AbortSignal) yarım dosyayı siler.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ApiError, readError } = require('./api');

// Content-Disposition: attachment; filename="SSH Master Setup 1.2.0.exe"; filename*=UTF-8''...
function filenameFromDisposition(header) {
  const h = String(header || '');
  const star = h.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  let name = '';
  if (star) {
    try { name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { name = ''; }
  }
  if (!name) {
    const m = h.match(/filename\s*=\s*("([^"]*)"|[^;]+)/);
    if (m) name = (m[2] !== undefined ? m[2] : m[1]).trim();
  }
  return safeName(name);
}

// Yalnız dosya adı; yol ayırıcıları ve Windows'ta geçersiz karakterler atılır
function safeName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g, '').trim().replace(/^\.+/, '');
  return base.slice(0, 180);
}

async function downloadFile({ url, token, dir, fallbackName, fetchImpl = (...a) => fetch(...a), onProgress = () => {}, signal, progressMs = 150 }) {
  let res;
  try {
    res = await fetchImpl(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal });
  } catch (e) {
    if (signal && signal.aborted) throw new ApiError(0, 'cancelled');
    throw new ApiError(0, 'offline', e && e.message);
  }
  if (!res.ok) throw await readError(res);

  const total = Number(res.headers.get('content-length')) || 0;
  const expected = String(res.headers.get('x-sha256') || '').trim().toLowerCase();
  const version = res.headers.get('x-version') || null;
  let name = filenameFromDisposition(res.headers.get('content-disposition')) || safeName(fallbackName) || 'setup.exe';
  if (!/\.exe$/i.test(name)) name += '.exe';

  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  const part = file + '.part';
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(part);
  let received = 0;
  let last = 0;
  const report = (force) => {
    const now = Date.now();
    if (force || now - last >= progressMs) { last = now; onProgress({ received, total }); }
  };

  const closeOut = () => new Promise((resolve) => {
    if (out.closed) return resolve();
    out.once('close', resolve);
    out.end();
  });
  const removePart = async () => { await closeOut().catch(() => {}); try { fs.unlinkSync(part); } catch {} };

  try {
    report(true);
    for await (const chunk of res.body) {
      if (signal && signal.aborted) throw new ApiError(0, 'cancelled');
      const buf = Buffer.from(chunk);
      hash.update(buf);
      received += buf.length;
      if (!out.write(buf)) await new Promise((r) => out.once('drain', r));
      report(false);
    }
    if (signal && signal.aborted) throw new ApiError(0, 'cancelled');
    report(true);
    await closeOut();
  } catch (e) {
    await removePart();
    if (signal && signal.aborted) throw new ApiError(0, 'cancelled');
    throw e instanceof ApiError ? e : new ApiError(0, 'offline', e && e.message);
  }

  if (total && received !== total) {
    try { fs.unlinkSync(part); } catch {}
    throw new ApiError(0, 'incomplete', `${received}/${total}`);
  }
  const sha256 = hash.digest('hex');
  if (expected && sha256 !== expected) {
    try { fs.unlinkSync(part); } catch {}
    throw new ApiError(0, 'sha_mismatch', `${sha256} ≠ ${expected}`);
  }
  try { fs.unlinkSync(file); } catch {}
  fs.renameSync(part, file);
  return { file, name, size: received, sha256, version, verified: !!expected };
}

// Ayarlar › Depolama
function listDownloads(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return { files: [], bytes: 0 }; }
  const files = [];
  let bytes = 0;
  for (const n of names) {
    try {
      const st = fs.statSync(path.join(dir, n));
      if (!st.isFile()) continue;
      files.push({ name: n, size: st.size });
      bytes += st.size;
    } catch {}
  }
  return { files, bytes };
}

function clearDownloads(dir, keep = new Set()) {
  let removed = 0;
  for (const f of listDownloads(dir).files) {
    if (keep.has(f.name)) continue;
    try { fs.unlinkSync(path.join(dir, f.name)); removed++; } catch {}
  }
  return removed;
}

module.exports = { downloadFile, filenameFromDisposition, safeName, listDownloads, clearDownloads };
