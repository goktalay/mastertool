'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createSso } = require('../src/sso');
const { createAccount } = require('../src/account');
const { ApiError, deriveKeys } = require('../src/api');
const { memoryKeyring, tmpDir } = require('./helpers');

const KDF = { alg: 'PBKDF2-SHA256', iter: 1000, salt: Buffer.from('0123456789abcdef').toString('base64') };

// Sahte sunucu: prelogin/login/logout + Bearer sso ile katalog
function fakeApi({ password = 'Gizli-Sifre-1', expireCatalog = false } = {}) {
  const calls = [];
  let expected = null;
  return {
    calls,
    async request(method, route, opts = {}) {
      calls.push({ method, route, ...opts });
      if (route === '/api/mt/auth/prelogin') return { kdf: KDF };
      if (route === '/api/mt/auth/login') {
        expected = expected || (await deriveKeys(password, KDF)).authHash;
        if (opts.body.auth_hash !== expected) throw new ApiError(401, 'bad_credentials');
        assert.equal(opts.body.client, 'desktop');
        return { sso_token: 'sso-1', user: { id: 7, name: 'Örnek', email: opts.body.email }, kdf: KDF, sync_enabled: true };
      }
      if (route === '/api/mt/auth/logout') return { ok: true, sso_ended: true };
      if (route === '/api/mt/apps') {
        if (expireCatalog) throw new ApiError(401, 'session_expired');
        assert.equal(opts.token, 'sso-1');
        return { apps: [] };
      }
      throw new ApiError(404, 'not_found');
    },
  };
}

function setup(apiOpts) {
  const kr = memoryKeyring();
  const dir = tmpDir();
  const sso = createSso({ keyring: kr, stateDir: dir, pollMs: 40 });
  const api = fakeApi(apiOpts);
  const events = [];
  const acct = createAccount({ sso, api, appVersion: '1.0.0', onChange: (s) => events.push(s.reason) });
  return { kr, dir, sso, api, acct, events };
}

test('auth_hash sözleşmeye göre türetilir', async () => {
  const { master, authHash } = await deriveKeys('şifre', KDF);
  const m = crypto.pbkdf2Sync(Buffer.from('şifre'), Buffer.from(KDF.salt, 'base64'), KDF.iter, 32, 'sha256');
  assert.deepEqual(master, m);
  assert.equal(authHash, crypto.pbkdf2Sync(m, Buffer.from('şifre'), 1, 32, 'sha256').toString('base64'));
});

test('şifreyle giriş: ortak kimlik yazılır, durum "in" olur, master paylaşılır', async () => {
  const { sso, acct, events } = setup();
  await acct.login(' Ornek@Example.com ', 'Gizli-Sifre-1');
  const c = sso.readCredential();
  assert.equal(c.sso_token, 'sso-1');
  assert.equal(c.email, 'ornek@example.com');
  const { master } = await deriveKeys('Gizli-Sifre-1', KDF);
  assert.equal(c.master, master.toString('base64'));
  assert.deepEqual(sso.readState().state, 'in');
  assert.deepEqual(events, ['login']);
  assert.equal(acct.token(), 'sso-1');
});

test('hatalı şifre: kimlik yazılmaz', async () => {
  const { sso, acct } = setup();
  await assert.rejects(acct.login('a@example.com', 'yanlis'), { code: 'bad_credentials' });
  assert.equal(sso.readCredential(), null);
  assert.equal(sso.readState().gen, 0);
});

test('başka uygulamada açılmış ortak oturum açılışta kullanılır (şifre sorulmaz)', () => {
  const kr = memoryKeyring();
  const dir = tmpDir();
  createSso({ keyring: kr, stateDir: dir }).writeCredential({ email: 'b@example.com', user: { id: 1, name: 'B' }, sso_token: 'sso-x', master: Buffer.alloc(32), kdf: KDF });
  const acct = createAccount({ sso: createSso({ keyring: kr, stateDir: dir }), api: fakeApi(), appVersion: '1' });
  assert.equal(acct.isLoggedIn(), true);
  assert.equal(acct.token(), 'sso-x');
});

test('çıkış: logout ucu çağrılır, kimlik silinir, durum "out"', async () => {
  const { sso, api, acct, events } = setup();
  await acct.login('a@example.com', 'Gizli-Sifre-1');
  await acct.logout();
  const call = api.calls.find((c) => c.route === '/api/mt/auth/logout');
  assert.equal(call.token, 'sso-1');
  assert.equal(sso.readCredential(), null);
  assert.equal(sso.readState().state, 'out');
  assert.equal(sso.readState().gen, 2);
  assert.deepEqual(events, ['login', 'logout']);
});

test('401 session_expired: kimlik silinir, durum "out", oturum kapanır', async () => {
  const { sso, acct, events } = setup({ expireCatalog: true });
  await acct.login('a@example.com', 'Gizli-Sifre-1');
  await assert.rejects(acct.authed('GET', '/api/mt/apps'), { status: 401 });
  assert.equal(acct.isLoggedIn(), false);
  assert.equal(sso.readCredential(), null);
  assert.equal(sso.readState().state, 'out');
  assert.deepEqual(events, ['login', 'session_expired']);
});

test('başka uygulamada çıkış / giriş izleyiciyle fark edilir', async () => {
  const { kr, dir, acct, events } = setup();
  await acct.login('a@example.com', 'Gizli-Sifre-1');
  acct.startWatching();
  const other = createSso({ keyring: kr, stateDir: dir });
  // diğer uygulama çıkış yapar (§2 adım 4)
  other.deleteCredential();
  other.bumpState('out');
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(acct.isLoggedIn(), false);
  // diğer uygulama yeniden şifreyle giriş yapar (§2 adım 2–3)
  other.writeCredential({ email: 'a@example.com', user: { id: 7, name: 'Örnek' }, sso_token: 'sso-2', master: Buffer.alloc(32), kdf: KDF });
  other.bumpState('in');
  await new Promise((r) => setTimeout(r, 250));
  acct.stopWatching();
  assert.equal(acct.token(), 'sso-2');
  assert.deepEqual(events, ['login', 'shared_out', 'shared_in']);
});

test('kendi girişimiz izleyicide ikinci kez işlenmez', async () => {
  const { acct, events } = setup();
  acct.startWatching();
  await acct.login('a@example.com', 'Gizli-Sifre-1');
  await new Promise((r) => setTimeout(r, 200));
  acct.stopWatching();
  assert.deepEqual(events, ['login']);
});
