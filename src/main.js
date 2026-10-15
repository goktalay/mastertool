'use strict';

// Master Tool: Mastertool uygulamalarını (SSH Master, FTP Masters, SQL Master, Notepad Master, Convert Master)
// kurulu / kurulu değil diye gösterir, tek tıkla açar ya da indirip kurar; cihazdaki ortak oturumu (SSO) yönetir.
// Sözleşme: mastertool.download docs/mastertool-api.md (v1).

const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const I18N = require('./i18n');
const { createApi, compareVersions, API_BASE } = require('./api');
const { createSso } = require('./sso');
const { createAccount } = require('./account');
const { detectAll, resolveInstalled, readUninstallEntries } = require('./detect');
const { createInstaller } = require('./installs');
const { downloadFile, listDownloads, clearDownloads } = require('./downloader');
const { buildTrayTemplate, createClickRouter } = require('./tray-menu');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const BRAND_DIR = path.join(ROOT, 'assets', 'brand');

// Arayüz dili: ayarlarda seçilen ya da sistem dili (desteklenmiyorsa İngilizce)
let t = I18N.createT('en');
const currentLang = () => (store && store.settings.language) || I18N.resolveLanguage(app.getLocale());
function applyLanguage() { t = I18N.createT(currentLang()); }

// Ortak klasör (diğer Mastertool uygulamalarıyla paylaşılır): %APPDATA%\Mastertool
const sharedDir = () => path.join(app.getPath('appData'), 'Mastertool');
const downloadsDir = () => path.join(sharedDir(), 'downloads');

// ---------------------------------------------------------------------------
// Ayarlar (userData/store.json)
// ---------------------------------------------------------------------------
const storePath = () => path.join(app.getPath('userData'), 'store.json');
const defaultSettings = () => ({
  appTheme: 'system',    // 'dark' | 'light' | 'system' (Mastertool standardı: varsayılan Sistem)
  language: null,        // null = sistem dili (desteklenmiyorsa İngilizce)
  openAtLogin: false,    // Windows oturumu açılınca başlat
  minimizeToTray: true,  // küçültülünce tepsiye gizle
  closeToTray: true,     // kapat (X) tepsiye gizler; çıkış tepsi menüsünden / Ayarlar'dan
  checkUpdates: true,    // açılışta güncelleme denetimi
  trayHintShown: false,
});
let store = null;

function loadStore() {
  try {
    const s = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    store = { settings: { ...defaultSettings(), ...(s.settings || {}) } };
  } catch {
    store = { settings: defaultSettings() };
  }
  applyAppTheme();
  applyLanguage();
}

function saveStore() {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
}

// Gece / Gündüz / Sistem: tüm pencerelerin prefers-color-scheme'ini ve başlık çubuklarını belirler
function applyAppTheme() {
  const v = store.settings.appTheme;
  nativeTheme.themeSource = v === 'dark' || v === 'light' ? v : 'system';
}
const windowBg = () => (nativeTheme.shouldUseDarkColors ? '#0b0f17' : '#eef2f7');
const themeParam = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

// ---------------------------------------------------------------------------
// Katalog (GET /api/mt/apps) — çevrimdışı açılış için userData/catalog.json'da saklanır
// ---------------------------------------------------------------------------
const DEFAULT_APPS = [
  { app: 'sm', name: 'SSH Master', site: 'https://sshmasters.com/' },
  { app: 'fm', name: 'FTP Masters', site: 'https://ftpmasters.com/' },
  { app: 'sq', name: 'SQL Master', site: 'https://sqlmaster.app/' },
  { app: 'np', name: 'Notepad Master', site: 'https://notepadmaster.com/' },
  { app: 'cv', name: 'Convert Master', site: 'https://convertmaster.app/' },
].map((a) => ({ ...a, exe: `${a.name}.exe`, install_dir: `Mastertool\\${a.name}`, icon_png: `/brand/${a.app}.png`, icon_svg: `/brand/${a.app}.svg`, license: null, release: null }));

const catalogPath = () => path.join(app.getPath('userData'), 'catalog.json');
let catalog = { apps: DEFAULT_APPS, launcher: { name: 'Master Tool', release: null } };
let catalogFresh = false;   // bu açılışta sunucudan alındı mı
let offline = false;
let installed = {};         // app -> { installed, exePath, dir, version, source }
let scanning = false;

function loadCatalogCache() {
  try {
    const c = JSON.parse(fs.readFileSync(catalogPath(), 'utf8'));
    if (Array.isArray(c.apps) && c.apps.length) catalog = c;
  } catch { /* ilk açılış */ }
}

async function refreshCatalog() {
  if (!account.isLoggedIn()) return;
  try {
    const c = await account.authed('GET', '/api/mt/apps');
    if (Array.isArray(c.apps)) {
      catalog = { apps: c.apps, launcher: c.launcher || catalog.launcher };
      catalogFresh = true;
      offline = false;
      fs.writeFileSync(catalogPath(), JSON.stringify(catalog), 'utf8');
      refreshIcons();
    }
  } catch (e) {
    offline = e.code === 'offline';
  }
  broadcast();
}

// Uygulama simgeleri sunucudan (https://mastertool.download/brand/<kod>.svg|png) alınıp önbelleğe yazılır;
// önbellek yoksa paketle gelen kopya kullanılır.
const iconsDir = () => path.join(app.getPath('userData'), 'icons');
let iconsFetched = false;

async function refreshIcons() {
  if (iconsFetched) return;
  iconsFetched = true;
  fs.mkdirSync(iconsDir(), { recursive: true });
  for (const a of catalog.apps) {
    for (const [field, ext] of [['icon_svg', 'svg'], ['icon_png', 'png']]) {
      if (!a[field] || !/^\/[\w./-]+$/.test(a[field])) continue;
      try {
        const res = await fetch(API_BASE + a[field]);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const okType = ext === 'svg' ? /^\s*<(\?xml|svg)/.test(buf.subarray(0, 64).toString('utf8')) : buf.subarray(0, 4).toString('hex') === '89504e47';
        if (okType && buf.length < 512 * 1024) fs.writeFileSync(path.join(iconsDir(), `${a.app}.${ext}`), buf);
      } catch { /* çevrimdışı: paketteki simge */ }
    }
  }
  trayIcons.clear();
  broadcast();
  updateTrayMenu();
}

function iconFile(code, ext) {
  const cached = path.join(iconsDir(), `${code}.${ext}`);
  if (fs.existsSync(cached)) return cached;
  const bundled = path.join(BRAND_DIR, `${code}.${ext}`);
  return fs.existsSync(bundled) ? bundled : null;
}

function iconDataUrl(code) {
  const svg = iconFile(code, 'svg');
  if (svg) return `data:image/svg+xml;base64,${fs.readFileSync(svg).toString('base64')}`;
  const png = iconFile(code, 'png');
  return png ? `data:image/png;base64,${fs.readFileSync(png).toString('base64')}` : '';
}

const trayIcons = new Map();
function trayIconFor(code) {
  if (!trayIcons.has(code)) {
    const png = iconFile(code, 'png');
    trayIcons.set(code, png ? nativeImage.createFromPath(png).resize({ width: 16, height: 16, quality: 'best' }) : undefined);
  }
  return trayIcons.get(code);
}

// ---------------------------------------------------------------------------
// Kurulu algılama
// ---------------------------------------------------------------------------
let lastScan = 0;
async function rescan() {
  if (scanning) return;
  scanning = true;
  try {
    installed = await detectAll(catalog.apps);
    lastScan = Date.now();
  } finally {
    scanning = false;
  }
  broadcast();
  updateTrayMenu();
}

async function detectOne(a) {
  const r = resolveInstalled(a, await readUninstallEntries());
  installed[a.app] = r;
  return r;
}

function appView(a) {
  const inst = installed[a.app] || { installed: false };
  const rel = a.release || null;
  return {
    app: a.app, name: a.name, site: a.site, license: a.license, release: rel,
    installed: inst,
    updateAvailable: !!(inst.installed && inst.version && rel && rel.version && compareVersions(rel.version, inst.version) > 0),
    icon: iconDataUrl(a.app),
    job: installer ? installer.snapshot()[a.app] || null : null,
  };
}

function viewState() {
  return {
    apps: catalog.apps.map(appView),
    launcher: catalog.launcher,
    offline,
    fresh: catalogFresh,
    scanned: lastScan > 0,
    account: account ? account.state() : { loggedIn: false },
  };
}

let broadcastTimer = null;
function broadcast() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mt:state', viewState());
  }, 30);
}

function sendToast(key, vars = {}, type = '') {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mt:toast', { key, vars, type });
  // Pencere gizliyken önemli sonuçlar tepsi balonuyla bildirilir
  if (tray && (!mainWindow || !mainWindow.isVisible()) && (type === 'ok' || type === 'err')) {
    tray.displayBalloon({ iconType: type === 'ok' ? 'info' : 'error', title: 'Master Tool', content: t(key, vars) });
  }
}

// ---------------------------------------------------------------------------
// Uygulama açma ve kurulum başlatma
// ---------------------------------------------------------------------------
function launchExe(exePath) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exePath, [], { detached: true, stdio: 'ignore', cwd: path.dirname(exePath), windowsHide: false });
    } catch (e) {
      return resolve({ ok: false, message: e.message });
    }
    child.once('error', (e) => resolve({ ok: false, message: e.message }));
    child.once('spawn', () => { child.unref(); resolve({ ok: true }); });
  });
}

// Kurulum doğrudan başlatılır; yükseltme (UAC) gerektiği için başlatılamazsa kabuk üzerinden açılır.
function runSetup(file) {
  return new Promise((resolve, reject) => {
    let child;
    const viaShell = () => shell.openPath(file).then((err) => (err ? reject(new Error(err)) : resolve({ child: null })));
    try {
      child = spawn(file, [], { detached: true, stdio: 'ignore', cwd: path.dirname(file) });
    } catch {
      return viaShell();
    }
    child.once('error', viaShell);
    child.once('spawn', () => { child.unref(); resolve({ child }); });
  });
}

let installer = null;

function initInstaller() {
  installer = createInstaller({
    downloadsDir: downloadsDir(),
    apiBase: API_BASE,
    getToken: () => account.token(),
    detectOne,
    runSetup,
    onUpdate: (code, job) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('mt:job', { app: code, job });
      if (!job) broadcast();
    },
    onDone: (code, r) => {
      const a = catalog.apps.find((x) => x.app === code) || { name: code };
      if (r.ok) {
        if (r.file) try { fs.unlinkSync(r.file); } catch { /* kurulum dosyayı hâlâ tutuyorsa Depolama'dan silinir */ }
        sendToast('mt.installedToast', { name: a.name }, 'ok');
        rescan();
        return;
      }
      if (r.status === 401) account.expire('session_expired');
      const msgKey = {
        cancelled: null,
        sha_mismatch: 'mt.errSha',
        app_disabled: 'mt.errAppDisabled',
        no_release: 'mt.errNoRelease',
        no_file: 'mt.errNoRelease',
        install_timeout: 'mt.installTimeout',
        session_expired: null,
      }[r.code];
      if (msgKey) sendToast(msgKey, { name: a.name }, r.code === 'install_timeout' ? '' : 'err');
      else if (msgKey === undefined) sendToast('mt.errDownload', { name: a.name, msg: friendlyCode(r) }, 'err');
      if (r.code === 'app_disabled') refreshCatalog();
    },
  });
}

function friendlyCode(r) {
  if (r.code === 'offline') return t('auth.errOffline');
  if (r.code === 'rate_limited') return t('auth.errRateLimited');
  return r.message && r.message !== r.code ? r.message : r.code;
}

async function openApp(code) {
  const a = catalog.apps.find((x) => x.app === code);
  if (!a) return { ok: false };
  let inst = installed[code];
  if (!inst || !inst.installed || !fs.existsSync(inst.exePath)) inst = await detectOne(a);
  if (!inst.installed) { broadcast(); updateTrayMenu(); return { ok: false, code: 'not_installed' }; }
  const r = await launchExe(inst.exePath);
  if (!r.ok) sendToast('mt.errLaunch', { name: a.name, msg: r.message }, 'err');
  return r;
}

function installApp(code) {
  const a = catalog.apps.find((x) => x.app === code);
  if (!a || !account.isLoggedIn()) return { ok: false };
  if (a.license && a.license !== 'AKTIF') { sendToast('mt.errAppDisabled', { name: a.name }, 'err'); return { ok: false, code: 'app_disabled' }; }
  const inst = installed[code];
  const minVersion = a.release && a.release.version;
  installer.start({ ...a, wasInstalled: !!(inst && inst.installed) }, { minVersion });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ortak oturum
// ---------------------------------------------------------------------------
const api = createApi();
let sso = null;
let account = null;
let loginNotice = null;

function initAccount() {
  sso = createSso({ stateDir: sharedDir() });
  account = createAccount({ sso, api, appVersion: app.getVersion(), onChange: onAccountChange });
  account.startWatching();
}

function onAccountChange(st) {
  if (st.loggedIn) {
    loginNotice = null;
    // Giriş bu uygulamada ya da başka bir Mastertool uygulamasında yapıldı
    const showNow = !!loginWindow || (mainWindow && mainWindow.isVisible());
    if (!mainWindow) createMainWindow({ show: showNow });
    if (loginWindow) loginWindow.destroy();
    catalogFresh = false;
    iconsFetched = false;
    refreshCatalog().then(() => checkSelfUpdate());
  } else {
    loginNotice = {
      shared_out: t('auth.signedOutElsewhere'),
      session_expired: t('auth.errSessionExpired'),
      suspended: t('auth.errSuspended'),
    }[st.reason] || null;
    for (const code of Object.keys(installer ? installer.snapshot() : {})) installer.cancel(code);
    const wasVisible = !!(mainWindow && mainWindow.isVisible());
    if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
    // Pencere tepsideyse giriş ekranı zorla açılmaz; tepsiden "göster" ile açılır
    if (wasVisible || st.reason === 'logout') showLogin();
  }
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// Pencereler
// ---------------------------------------------------------------------------
let mainWindow = null;
let loginWindow = null;
let isQuitting = false;

const webPrefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false });

function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 440, height: 640, resizable: false, maximizable: false,
    backgroundColor: windowBg(), title: 'Master Tool', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  loginWindow.setMenuBarVisibility(false);
  loginWindow.loadFile(path.join(__dirname, 'renderer', 'login.html'));
  loginWindow.on('closed', () => (loginWindow = null));
}

function showLogin() {
  if (!loginWindow) createLoginWindow();
  else { loginWindow.show(); loginWindow.focus(); }
}

function createMainWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    width: 1120, height: 760, minWidth: 760, minHeight: 520, show,
    backgroundColor: windowBg(), title: 'Master Tool', icon: ICON, autoHideMenuBar: true, webPreferences: webPrefs(),
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('minimize', (e) => {
    if (!store.settings.minimizeToTray) return;
    e.preventDefault();
    hideToTray();
  });
  mainWindow.on('close', (e) => {
    if (store.settings.closeToTray && !isQuitting) {
      e.preventDefault();
      hideToTray();
    }
  });
  // Pencere öne gelince kurulu uygulamalar yeniden taranır (en çok 10 sn'de bir); kaldırılanlar da fark edilir
  mainWindow.on('focus', () => { if (Date.now() - lastScan > 10000) rescan(); });
  mainWindow.on('closed', () => (mainWindow = null));
}

function showMainWindow() {
  if (!account || !account.isLoggedIn()) { showLogin(); return; }
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function hideToTray() {
  if (!mainWindow) return;
  mainWindow.hide();
  if (!store.settings.trayHintShown && tray) {
    store.settings.trayHintShown = true;
    saveStore();
    tray.displayBalloon({ iconType: 'info', title: t('tray.balloonTitle'), content: t('tray.balloonBody') });
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// Sistem tepsisi: her zaman görünür. Tek tık = kurulu uygulamalar menüsü, çift tık = pencereyi göster
// ---------------------------------------------------------------------------
let tray = null;
let trayMenu = null;

function trayTemplate() {
  return buildTrayTemplate({
    apps: catalog.apps.map((a) => ({ app: a.app, name: a.name, installed: installed[a.app] })),
    t,
    iconFor: trayIconFor,
    onOpen: (code) => openApp(code),
    onShow: showMainWindow,
    onQuit: quitApp,
  });
}

function updateTrayMenu() {
  if (!tray) return;
  trayMenu = Menu.buildFromTemplate(trayTemplate());
  tray.setContextMenu(trayMenu); // sağ tık
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip('Master Tool');
  const router = createClickRouter({
    onSingle: () => { if (trayMenu) tray.popUpContextMenu(trayMenu); },
    onDouble: showMainWindow,
  });
  tray.on('click', () => router.click());
  tray.on('double-click', () => router.doubleClick());
  updateTrayMenu();
}

// ---------------------------------------------------------------------------
// Master Tool'un kendi güncellemesi (GET /api/mt/releases/latest, /api/mt/apps/mt/download)
// ---------------------------------------------------------------------------
let selfUpdate = null; // { version, notes } | null
let selfUpdating = false;

async function checkSelfUpdate({ manual = false } = {}) {
  if (!manual && !store.settings.checkUpdates) return null;
  try {
    const r = await account.authed('GET', '/api/mt/releases/latest');
    const newer = !!(r && r.version && compareVersions(r.version, app.getVersion()) > 0);
    selfUpdate = newer ? { version: r.version, notes: r.notes || '' } : null;
    if (newer && mainWindow) {
      const send = () => mainWindow && mainWindow.webContents.send('app:update', selfUpdate);
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send); else send();
    }
    return { latest: (r && r.version) || null, current: app.getVersion(), newer };
  } catch (e) {
    if (manual) throw e;
    return null;
  }
}

async function runSelfUpdate() {
  if (selfUpdating || !account.isLoggedIn()) return { ok: false };
  selfUpdating = true;
  const progress = (p) => mainWindow && mainWindow.webContents.send('app:updateProgress', p);
  try {
    const r = await downloadFile({
      url: `${API_BASE}/api/mt/apps/mt/download?kind=setup`,
      token: account.token(),
      dir: downloadsDir(),
      fallbackName: `Master-Tool-Setup-${selfUpdate ? selfUpdate.version : 'latest'}.exe`,
      onProgress: progress,
    });
    progress({ phase: 'install' });
    await runSetup(r.file);
    setTimeout(quitApp, 800); // kurulum çalışan uygulamayı değiştirebilsin
    return { ok: true };
  } catch (e) {
    selfUpdating = false;
    if (e.status === 401) account.expire('session_expired');
    return { ok: false, code: e.code, message: e.message };
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
ipcMain.on('app:lang', (e) => { e.returnValue = currentLang(); });

ipcMain.handle('account:state', () => ({ ...account.state(), notice: loginNotice, appVersion: app.getVersion() }));

ipcMain.handle('account:login', async (_e, { email, password }) => {
  try {
    await account.login(email, password); // pencere geçişi onAccountChange'de
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code || 'error', message: e.message };
  }
});

ipcMain.handle('account:logout', () => account.logout());

// Hesap sayfaları: https://mastertool.download/<yol>?lang=&theme=&app=mt
ipcMain.handle('account:openWeb', (_e, page) => {
  const allowed = { forgot: '/sifremi-unuttum', register: '/kayit', account: '/hesabim' };
  if (!allowed[page]) return;
  const q = new URLSearchParams({ lang: currentLang(), theme: themeParam(), app: 'mt' });
  shell.openExternal(`${API_BASE}${allowed[page]}?${q}`);
});

ipcMain.handle('app:openPortal', () => {
  shell.openExternal(`${API_BASE}/?${new URLSearchParams({ lang: currentLang(), theme: themeParam() })}`);
});

ipcMain.handle('mt:state', () => viewState());
ipcMain.handle('mt:refresh', async () => { await Promise.all([refreshCatalog(), rescan()]); return viewState(); });
ipcMain.handle('mt:open', (_e, code) => openApp(code));
ipcMain.handle('mt:install', (_e, code) => installApp(code));
ipcMain.handle('mt:cancel', (_e, code) => installer.cancel(code));
ipcMain.handle('mt:site', (_e, code) => {
  const a = catalog.apps.find((x) => x.app === code);
  if (!a || !/^https:\/\//.test(a.site || '')) return;
  const u = new URL(a.site);
  u.searchParams.set('lang', currentLang());
  u.searchParams.set('theme', themeParam());
  shell.openExternal(u.toString());
});
ipcMain.handle('mt:reveal', (_e, code) => {
  const inst = installed[code];
  if (inst && inst.exePath) shell.showItemInFolder(inst.exePath);
});

ipcMain.handle('storage:info', () => ({ dir: downloadsDir(), ...listDownloads(downloadsDir()), busy: installer.busy() }));
ipcMain.handle('storage:clear', () => {
  if (installer.busy() || selfUpdating) return { ok: false, code: 'busy' };
  return { ok: true, removed: clearDownloads(downloadsDir()) };
});
ipcMain.handle('storage:open', () => {
  fs.mkdirSync(downloadsDir(), { recursive: true });
  return shell.openPath(downloadsDir());
});

ipcMain.handle('settings:get', () => store.settings);
ipcMain.handle('settings:set', (_e, patch) => {
  const allowed = ['appTheme', 'language', 'openAtLogin', 'minimizeToTray', 'closeToTray', 'checkUpdates'];
  for (const k of Object.keys(patch || {})) if (allowed.includes(k)) store.settings[k] = patch[k];
  saveStore();
  if ('openAtLogin' in patch) applyOpenAtLogin();
  if ('appTheme' in patch) applyAppTheme();
  if ('language' in patch) {
    applyLanguage();
    updateTrayMenu();
    if (mainWindow) mainWindow.webContents.reload();
    if (loginWindow) loginWindow.webContents.reload();
  }
  return store.settings;
});

// Windows oturumu açılınca başlat (yalnız paketlenmiş uygulamada; geliştirmede electron.exe kaydedilmesin)
function applyOpenAtLogin() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.settings.openAtLogin, args: ['--hidden'] });
}

ipcMain.handle('app:about', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  openAtLogin: app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : !!store.settings.openAtLogin,
}));

ipcMain.handle('app:checkUpdate', async () => {
  try {
    return { ok: true, ...(await checkSelfUpdate({ manual: true })) };
  } catch (e) {
    return { ok: false, code: e.code || 'error', message: e.message };
  }
});
ipcMain.handle('app:selfUpdate', () => runSelfUpdate());

// Chromium/Electron lisans dosyaları kurulum klasöründe durur
ipcMain.handle('app:openLicenses', () => {
  const file = path.join(path.dirname(process.execPath), 'LICENSES.chromium.html');
  if (fs.existsSync(file)) return shell.openPath(file);
  return shell.openExternal('https://www.electronjs.org/docs/latest#license');
});
ipcMain.handle('app:quit', () => quitApp());

// ---------------------------------------------------------------------------
app.setAppUserModelId('com.mastertool.app');

app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e) => e.preventDefault());
});

// Tek örnek (§2): ikinci kez başlatılınca gizli/simge durumundaki pencere gösterilip öne getirilir
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', () => (isQuitting = true));

  app.whenReady().then(() => {
    loadStore();
    fs.mkdirSync(downloadsDir(), { recursive: true });
    loadCatalogCache();
    initAccount();
    initInstaller();
    createTray();
    rescan();

    // Windows oturumuyla başlatıldıysa ve tepsiye küçültme açıksa doğrudan tepside başla
    const hidden = process.argv.includes('--hidden') && store.settings.minimizeToTray;
    if (account.isLoggedIn()) {
      createMainWindow({ show: !hidden });
      refreshCatalog().then(() => checkSelfUpdate());
    } else if (!hidden) {
      createLoginWindow();
    }
  });

  // Tepsi her zaman açık kalır; çıkış yalnız tepsi menüsünden / Ayarlar'dan
  app.on('window-all-closed', () => { if (isQuitting) app.quit(); });
  app.on('will-quit', () => { if (account) account.stopWatching(); });
}
