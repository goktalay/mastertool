'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { downloadFile, filenameFromDisposition, listDownloads, clearDownloads } = require('../src/downloader');
const { tmpDir } = require('./helpers');

const BODY = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(3 * 1024 * 1024)]);
const SHA = crypto.createHash('sha256').update(BODY).digest('hex');

// /ok: doğru sha; /bad: yanlış sha; /slow: yavaş akış; /disabled: 403 app_disabled
function server() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.headers.authorization !== 'Bearer sso-1') { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"code":"session_expired","message":"x"}'); }
      if (req.url.startsWith('/disabled')) { res.writeHead(403, { 'Content-Type': 'application/json' }); return res.end('{"code":"app_disabled","message":"kapalı"}'); }
      const headers = { 'Content-Length': BODY.length, 'X-Version': '1.2.0', 'Content-Disposition': 'attachment; filename="SSH Master Setup 1.2.0.exe"' };
      headers['X-Sha256'] = req.url.startsWith('/bad') ? '0'.repeat(64) : SHA.toUpperCase();
      res.writeHead(200, headers);
      if (req.url.startsWith('/slow')) {
        let i = 0;
        const tick = setInterval(() => {
          if (res.destroyed || i >= BODY.length) { clearInterval(tick); return res.end(); }
          res.write(BODY.subarray(i, i + 64 * 1024)); i += 64 * 1024;
        }, 20);
        req.on('close', () => clearInterval(tick));
      } else res.end(BODY);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

test('indirme: .part → sha256 doğrulama → asıl ad; ilerleme bildirilir', async () => {
  const s = await server();
  const dir = tmpDir();
  const progress = [];
  try {
    const r = await downloadFile({ url: `http://127.0.0.1:${s.address().port}/ok`, token: 'sso-1', dir, onProgress: (p) => progress.push(p), progressMs: 0 });
    assert.equal(r.name, 'SSH Master Setup 1.2.0.exe');
    assert.equal(r.sha256, SHA);
    assert.equal(r.version, '1.2.0');
    assert.equal(r.verified, true);
    assert.deepEqual(fs.readdirSync(dir), ['SSH Master Setup 1.2.0.exe']);
    assert.ok(fs.readFileSync(r.file).equals(BODY));
    assert.equal(progress.at(-1).received, BODY.length);
    assert.equal(progress.at(-1).total, BODY.length);
    assert.ok(progress.length > 2);
  } finally { s.close(); }
});

test('sha256 uyuşmazsa dosya silinir ve sha_mismatch', async () => {
  const s = await server();
  const dir = tmpDir();
  try {
    await assert.rejects(downloadFile({ url: `http://127.0.0.1:${s.address().port}/bad`, token: 'sso-1', dir }), { code: 'sha_mismatch' });
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { s.close(); }
});

test('iptal: yarım .part silinir, cancelled', async () => {
  const s = await server();
  const dir = tmpDir();
  const ctl = new AbortController();
  try {
    const p = downloadFile({ url: `http://127.0.0.1:${s.address().port}/slow`, token: 'sso-1', dir, signal: ctl.signal,
      onProgress: ({ received }) => { if (received > 200 * 1024) ctl.abort(); }, progressMs: 0 });
    await assert.rejects(p, { code: 'cancelled' });
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally { s.close(); }
});

test('sunucu hataları kodlarıyla döner (403 app_disabled, 401)', async () => {
  const s = await server();
  const dir = tmpDir();
  try {
    await assert.rejects(downloadFile({ url: `http://127.0.0.1:${s.address().port}/disabled`, token: 'sso-1', dir }), { status: 403, code: 'app_disabled' });
    await assert.rejects(downloadFile({ url: `http://127.0.0.1:${s.address().port}/ok`, token: 'yanlis', dir }), { status: 401, code: 'session_expired' });
  } finally { s.close(); }
});

test('Content-Disposition adı güvenli hale getirilir', () => {
  assert.equal(filenameFromDisposition('attachment; filename="..\\..\\evil.exe"'), 'evil.exe');
  assert.equal(filenameFromDisposition("attachment; filename*=UTF-8''Convert%20Master%20Setup%201.0.0.exe"), 'Convert Master Setup 1.0.0.exe');
  assert.equal(filenameFromDisposition('attachment; filename=FTP-Masters-Setup-1.0.0.exe'), 'FTP-Masters-Setup-1.0.0.exe');
  assert.equal(filenameFromDisposition(''), '');
});

test('Depolama: listele ve temizle', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.exe'), 'xx');
  fs.writeFileSync(path.join(dir, 'b.exe.part'), 'xxxx');
  assert.deepEqual(listDownloads(dir).bytes, 6);
  assert.equal(clearDownloads(dir), 2);
  assert.deepEqual(listDownloads(dir), { files: [], bytes: 0 });
  assert.deepEqual(listDownloads(path.join(dir, 'yok')), { files: [], bytes: 0 });
});
