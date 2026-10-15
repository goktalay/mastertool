'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const { EventEmitter } = require('events');
const { createInstaller } = require('../src/installs');
const { tmpDir } = require('./helpers');

const BODY = Buffer.from('MZ' + 'x'.repeat(1000));
function server() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Length': BODY.length, 'X-Version': '1.2.0', 'Content-Disposition': 'attachment; filename="FTP-Masters-Setup-1.2.0.exe"' });
      res.end(BODY);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const FM = { app: 'fm', name: 'FTP Masters', exe: 'FTP Masters.exe', release: { version: '1.2.0', size: BODY.length } };

function make(base, { detect, child = new EventEmitter() } = {}) {
  const updates = [];
  let done;
  const finished = new Promise((r) => (done = r));
  const ran = [];
  const inst = createInstaller({
    downloadsDir: tmpDir(), apiBase: base, getToken: () => 'sso-1',
    detectOne: detect, runSetup: async (file) => { ran.push(file); return { child }; },
    onUpdate: (app, job) => updates.push(job && job.phase), onDone: (app, r) => done(r),
    pollMs: 10, afterExitMs: 60,
  });
  return { inst, updates, finished, ran, child };
}

test('indir → kurulumu başlat → yeniden tara → kurulu bulununca biter', async () => {
  const s = await server();
  let scans = 0;
  const { inst, updates, finished, ran } = make(`http://127.0.0.1:${s.address().port}`, {
    detect: async () => (++scans >= 3 ? { installed: true, version: '1.2.0', exePath: 'C:\\x.exe' } : { installed: false }),
  });
  try {
    assert.equal(await inst.start(FM, { minVersion: '1.2.0' }), true);
    assert.equal(await inst.start(FM), false); // aynı uygulama iki kez başlamaz
    const r = await finished;
    assert.equal(r.ok, true);
    assert.equal(ran.length, 1);
    assert.ok(fs.existsSync(r.file));
    assert.ok(updates.includes('download') && updates.includes('install'));
    assert.equal(updates.at(-1), null);
    assert.equal(inst.busy(), false);
  } finally { s.close(); }
});

test('güncellemede eski sürüm görünürken bitmez; yeni sürüm görülünce biter', async () => {
  const s = await server();
  let scans = 0;
  const { inst, finished } = make(`http://127.0.0.1:${s.address().port}`, {
    detect: async () => ({ installed: true, version: ++scans < 4 ? '1.1.0' : '1.2.0' }),
  });
  try {
    inst.start({ ...FM, wasInstalled: true }, { minVersion: '1.2.0' });
    const r = await finished;
    assert.equal(r.ok, true);
    assert.ok(scans >= 4);
  } finally { s.close(); }
});

test('kurulum kapandıktan sonra süre dolarsa install_timeout', async () => {
  const s = await server();
  const child = new EventEmitter();
  const { inst, finished } = make(`http://127.0.0.1:${s.address().port}`, { detect: async () => ({ installed: false }), child });
  try {
    inst.start(FM);
    setTimeout(() => child.emit('exit', 0), 40);
    const r = await finished;
    assert.equal(r.code, 'install_timeout');
  } finally { s.close(); }
});
