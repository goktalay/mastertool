'use strict';

// İndir → doğrula → kurulumu başlat → kurulumu bekle (sözleşme v1 §4).
// Aynı anda birden çok uygulama indirilebilir. Kurulum başladıktan sonra 2 sn'de bir yeniden taranır:
// kurulum süreci açıkken ve kapandıktan sonra 2 dk boyunca. Süreç tutamacı yoksa (UAC için kabuk
// üzerinden başlatıldıysa) 10 dk. Uygulama bulununca kurulum dosyası silinir.

const { downloadFile } = require('./downloader');
const { compareVersions } = require('./api');

function createInstaller({
  downloadsDir, apiBase, getToken, fetchImpl, detectOne, runSetup,
  onUpdate = () => {}, onDone = () => {},
  pollMs = 2000, afterExitMs = 120000, shellWaitMs = 600000, maxWaitMs = 60 * 60 * 1000,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now,
}) {
  const jobs = new Map(); // app -> job

  const view = (j) => ({ app: j.app, phase: j.phase, received: j.received, total: j.total, version: j.version || null });
  const emit = (j) => onUpdate(j.app, view(j));

  function finish(j, result) {
    if (j.timer) clearTimer(j.timer);
    jobs.delete(j.app);
    onUpdate(j.app, null);
    onDone(j.app, result);
  }

  async function start(app, { minVersion = null, fallbackName } = {}) {
    if (jobs.has(app.app)) return false;
    const controller = new AbortController();
    const j = { app: app.app, name: app.name, phase: 'download', received: 0, total: (app.release && app.release.size) || 0, controller, file: null, timer: null };
    jobs.set(app.app, j);
    emit(j);
    try {
      const r = await downloadFile({
        url: `${apiBase}/api/mt/apps/${encodeURIComponent(app.app)}/download?kind=setup`,
        token: getToken(),
        dir: downloadsDir,
        fallbackName: fallbackName || `${app.name} Setup ${(app.release && app.release.version) || ''}.exe`,
        fetchImpl,
        signal: controller.signal,
        onProgress: ({ received, total }) => { j.received = received; j.total = total || j.total; emit(j); },
      });
      j.file = r.file;
      j.version = r.version;
    } catch (e) {
      finish(j, { ok: false, code: e.code || 'error', message: e.message, status: e.status });
      return true;
    }
    if (j.cancelled) { finish(j, { ok: false, code: 'cancelled' }); return true; }

    // Kurulum
    j.phase = 'install';
    emit(j);
    const target = minVersion || j.version || null;
    let setup;
    try {
      setup = await runSetup(j.file);
    } catch (e) {
      finish(j, { ok: false, code: 'setup_failed', message: e.message, file: j.file });
      return true;
    }
    const startedAt = now();
    let exitedAt = setup && setup.child ? null : startedAt;
    const waitAfter = setup && setup.child ? afterExitMs : shellWaitMs;
    if (setup && setup.child) setup.child.once('exit', () => { exitedAt = now(); });

    const tick = async () => {
      j.timer = null;
      if (!jobs.has(j.app)) return;
      let res = null;
      try { res = await detectOne(app); } catch { res = null; }
      const exited = exitedAt !== null && (setup && setup.child ? true : false);
      if (res && res.installed) {
        const ok = !target || (res.version ? compareVersions(res.version, target) >= 0 : exited || !app.wasInstalled);
        if (ok) { finish(j, { ok: true, file: j.file, installed: res }); return; }
      }
      const t = now();
      if ((exitedAt !== null && t - exitedAt > waitAfter) || t - startedAt > maxWaitMs) {
        finish(j, { ok: false, code: 'install_timeout', file: j.file });
        return;
      }
      j.timer = setTimer(tick, pollMs);
    };
    j.timer = setTimer(tick, pollMs);
    return true;
  }

  // İndirme sürüyorsa durdurur (yarım dosya silinir). Kurulum aşamasında yalnız beklemeyi bırakır.
  function cancel(app) {
    const j = jobs.get(app);
    if (!j) return false;
    if (j.phase === 'download') {
      j.cancelled = true;
      j.controller.abort();
    } else {
      finish(j, { ok: false, code: 'cancelled', file: j.file });
    }
    return true;
  }

  return {
    start, cancel,
    has: (app) => jobs.has(app),
    busy: () => jobs.size > 0,
    files: () => new Set([...jobs.values()].map((j) => j.file).filter(Boolean)),
    snapshot: () => Object.fromEntries([...jobs.values()].map((j) => [j.app, view(j)])),
  };
}

module.exports = { createInstaller };
