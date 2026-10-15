'use strict';

// Master Tool'un oturumu = cihazdaki ortak (sso) oturum. Master Tool yalnız /api/mt/* uçlarını kullandığı için
// ayrı bir uygulama token'ı tutmaz; sso_token'ı doğrudan Bearer olarak gönderir (sözleşme v1 §1, §3).
//
// Akışlar (§2):
//   giriş    → prelogin → auth_hash → POST /api/mt/auth/login {client:"desktop"} → ortak kimliği yaz → durum {gen+1,"in"}
//   çıkış    → POST /api/mt/auth/logout → ortak kimliği sil → durum {gen+1,"out"}
//   durum değişti (başka uygulama) → ortak kimliği yeniden oku: varsa ve farklıysa onu kullan, yoksa oturumu kapat
//   401 / hesap askıda → ortak kimliği sil, durum "out", giriş ekranı

const os = require('os');
const { ApiError, deriveKeys } = require('./api');

function createAccount({ sso, api, appVersion, onChange = () => {}, deviceName = () => `${os.hostname()} (Windows)` }) {
  let session = sso.readCredential(); // { email, user, sso_token, master, kdf, at } | null
  let watcher = null;

  const publicState = () => ({
    loggedIn: !!session,
    email: session ? session.email : '',
    user: session ? session.user : null,
  });

  function changed(reason) {
    onChange({ ...publicState(), reason });
  }

  // Kendi yazdığımız durum değişikliğini izleyiciye "görüldü" diye bildiririz; aksi halde onu başka
  // bir uygulamanın değişikliği sanıp ikinci kez işlerdik.
  function bump(state) {
    const s = sso.bumpState(state);
    if (watcher) watcher.seen(s.gen);
    return s;
  }

  async function login(email, password) {
    email = String(email || '').trim().toLowerCase();
    const pre = await api.request('POST', '/api/mt/auth/prelogin', { body: { email } });
    let { master, authHash } = await deriveKeys(password, pre.kdf);
    const res = await api.request('POST', '/api/mt/auth/login', {
      body: { email, auth_hash: authHash, client: 'desktop', device: deviceName().slice(0, 120), app_version: String(appVersion).slice(0, 30) },
    });
    if (!res.sso_token) throw new ApiError(500, 'no_sso_token');
    // Sunucu güncel kdf'yi döner; tuz farklıysa (şifre bu arada değişmiş) master yeniden türetilir
    const kdf = res.kdf || pre.kdf;
    if (kdf.salt !== pre.kdf.salt || Number(kdf.iter) !== Number(pre.kdf.iter)) ({ master } = await deriveKeys(password, kdf));
    const user = { id: res.user && res.user.id, name: (res.user && res.user.name) || '' };
    sso.writeCredential({ email: (res.user && res.user.email) || email, user, sso_token: res.sso_token, master, kdf });
    master.fill(0);
    session = sso.readCredential();
    if (!session) throw new ApiError(500, 'credential_store_failed');
    bump('in');
    changed('login');
    return publicState();
  }

  async function logout() {
    const token = session && session.sso_token;
    if (token) await api.request('POST', '/api/mt/auth/logout', { token, timeout: 8000 }).catch(() => {});
    sso.deleteCredential();
    session = null;
    bump('out');
    changed('logout');
  }

  // Ortak oturum sunucuda düştü (401 session_expired, askıya alma…): tüm aile için kapat
  function expire(code = 'session_expired') {
    if (!session) return;
    sso.deleteCredential();
    session = null;
    bump('out');
    changed(code);
  }

  async function authed(method, route, opts = {}) {
    if (!session) throw new ApiError(401, 'session_expired');
    try {
      return await api.request(method, route, { ...opts, token: session.sso_token });
    } catch (e) {
      if (e.status === 401) expire('session_expired');
      else if (e.status === 403 && (e.code === 'suspended' || e.code === 'unauthorized')) expire(e.code);
      throw e;
    }
  }

  // Başka bir uygulama durum dosyasını değiştirdi: gerçek durum ortak kimlikten okunur
  function syncFromShared() {
    const cred = sso.readCredential();
    if (cred && (!session || cred.sso_token !== session.sso_token)) {
      session = cred;
      changed('shared_in');
    } else if (!cred && session) {
      session = null;
      changed('shared_out');
    }
  }

  function startWatching() {
    if (watcher) return;
    watcher = sso.watch(() => syncFromShared());
  }

  function stopWatching() {
    if (watcher) watcher.stop();
    watcher = null;
  }

  return {
    isLoggedIn: () => !!session,
    token: () => (session ? session.sso_token : null),
    state: publicState,
    login, logout, expire, authed, syncFromShared, startWatching, stopWatching,
  };
}

module.exports = { createAccount };
