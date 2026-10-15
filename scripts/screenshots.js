// docs/screenshots/ altına 1600×1000 Türkçe ekran görüntüleri (gece + gündüz) ve manifest.json üretir.
// Arayüz gerçek dosyalardan (src/renderer) yüklenir; window.api örnek verilerle taklit edilir — gerçek hesap,
// sunucu ya da kişisel veri kullanılmaz. Tepsi menüsü Windows'un yerel menüsüdür; burada aynı içerikle çizilir.
//
// Kullanım: npm run screenshots   (Chromium yolu: CHROMIUM_PATH ya da Playwright'ın varsayılanı)
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const W = 1600;
const H = 1000;

const svgData = (code) => `data:image/svg+xml;base64,${fs.readFileSync(path.join(ROOT, 'assets', 'brand', `${code}.svg`)).toString('base64')}`;
const MB = 1048576;

const APPS = [
  { app: 'sm', name: 'SSH Master', site: 'https://sshmasters.com/', size: 96.4 },
  { app: 'fm', name: 'FTP Masters', site: 'https://ftpmasters.com/', size: 94.8 },
  { app: 'sq', name: 'SQL Master', site: 'https://sqlmaster.app/', size: 101.2 },
  { app: 'np', name: 'Notepad Master', site: 'https://notepadmaster.com/', size: 92.6 },
  { app: 'cv', name: 'Convert Master', site: 'https://convertmaster.app/', size: 138.9 },
];

// Senaryo: hangi uygulama kurulu, hangisi iniyor
function demoState({ installed = {}, jobs = {}, updates = {} } = {}) {
  return {
    apps: APPS.map((a) => {
      const inst = installed[a.app];
      const relVersion = updates[a.app] || (inst || '1.2.0');
      return {
        app: a.app, name: a.name, site: a.site, license: 'AKTIF',
        release: { version: relVersion, size: Math.round(a.size * MB), sha256: '', date: '2026-10-01' },
        installed: inst ? { installed: true, version: inst, exePath: `C:\\Program Files\\Mastertool\\${a.name}\\${a.name}.exe` } : { installed: false },
        updateAvailable: !!(inst && updates[a.app]),
        icon: svgData(a.app),
        job: jobs[a.app] ? { phase: 'download', received: Math.round(jobs[a.app] * a.size * MB), total: Math.round(a.size * MB) } : null,
      };
    }),
    launcher: { name: 'Master Tool', release: null },
    offline: false, fresh: true, scanned: true,
    account: { loggedIn: true, email: 'ornek@example.com', user: { id: 1, name: 'Örnek Kullanıcı' } },
  };
}

const SCENES = {
  groups: demoState({ installed: { sm: '1.2.0', fm: '1.1.0', np: '1.2.0' }, updates: { fm: '1.2.0' } }),
  download: demoState({ installed: { sm: '1.2.0', np: '1.2.0' }, jobs: { fm: 0.62, cv: 0.18 } }),
};

// window.api taklidi (preload.js ile aynı yüzey)
function stubScript({ scene, settings }) {
  return `(() => {
    const STATE = ${JSON.stringify(scene)};
    const SETTINGS = ${JSON.stringify(settings)};
    const noop = () => () => {};
    window.api = {
      lang: 'tr',
      accountState: async () => ({ loggedIn: false, email: 'ornek@example.com', notice: null, appVersion: '1.0.0' }),
      login: async () => ({ ok: false }), logout: async () => {}, openWeb: async () => {}, openPortal: async () => {},
      getState: async () => STATE, refresh: async () => STATE,
      openApp: async () => ({ ok: true }), installApp: async () => ({ ok: true }), cancelInstall: async () => true,
      openSite: async () => {}, revealApp: async () => {},
      onState: noop, onJob: noop, onToast: noop, onUpdateAvailable: noop, onUpdateProgress: noop,
      storageInfo: async () => ({ dir: 'C:\\\\Users\\\\Ornek\\\\AppData\\\\Roaming\\\\Mastertool\\\\downloads', busy: false,
        files: [{ name: 'SQL-Master-Setup-1.2.0.exe', size: ${Math.round(101.2 * MB)} }], bytes: ${Math.round(101.2 * MB)} }),
      storageClear: async () => ({ ok: true }), storageOpen: async () => {},
      getSettings: async () => SETTINGS, setSettings: async () => SETTINGS,
      about: async () => ({ version: '1.0.0', electron: '33.4.11', chrome: '130.0.6723.191', openAtLogin: true }),
      checkUpdate: async () => ({ ok: true, newer: false }), selfUpdate: async () => ({ ok: true }),
      openLicenses: async () => {}, quit: async () => {},
    };
  })();`;
}

const SETTINGS = { appTheme: 'system', language: 'tr', openAtLogin: true, minimizeToTray: true, closeToTray: true, checkUpdates: true };

// Windows 11 görev çubuğu köşesi ve tepsi menüsü (yerel menünün içeriğiyle aynı)
function trayOverlay(dark, installed) {
  const c = dark
    ? { bar: 'rgba(32,32,32,.94)', menu: 'rgba(44,44,44,.97)', text: '#fff', sub: 'rgba(255,255,255,.62)', hover: 'rgba(255,255,255,.08)', line: 'rgba(255,255,255,.1)', border: 'rgba(0,0,0,.4)' }
    : { bar: 'rgba(243,243,243,.95)', menu: 'rgba(249,249,249,.98)', text: '#1b1b1b', sub: 'rgba(0,0,0,.6)', hover: 'rgba(0,0,0,.05)', line: 'rgba(0,0,0,.08)', border: 'rgba(0,0,0,.12)' };
  const items = installed.map((a, i) => `<div class="tm-item${i === 1 ? ' hov' : ''}"><img src="${svgData(a.app)}"><span>${a.name}</span></div>`).join('');
  return `
  <style>
    .tb { position: fixed; left: 0; right: 0; bottom: 0; height: 48px; background: ${c.bar}; backdrop-filter: blur(20px);
      border-top: 1px solid ${c.line}; display: flex; align-items: center; justify-content: flex-end; padding: 0 12px; gap: 6px; z-index: 900;
      font: 12px 'Segoe UI', system-ui, sans-serif; color: ${c.text}; }
    .tb .ti { width: 32px; height: 40px; display: grid; place-items: center; border-radius: 4px; }
    .tb .ti.on { background: ${c.hover}; }
    .tb .ti img { width: 18px; height: 18px; border-radius: 4px; }
    .tb .clock { text-align: right; line-height: 1.3; padding: 0 8px; }
    .tm { position: fixed; right: 108px; bottom: 56px; width: 236px; padding: 4px; border-radius: 8px; background: ${c.menu};
      backdrop-filter: blur(30px); border: 1px solid ${c.border}; box-shadow: 0 8px 28px rgba(0,0,0,.28); z-index: 901;
      font: 13.5px 'Segoe UI', system-ui, sans-serif; color: ${c.text}; }
    .tm-item { display: flex; align-items: center; gap: 12px; height: 32px; padding: 0 12px; border-radius: 4px; }
    .tm-item.hov { background: ${c.hover}; }
    .tm-item img { width: 16px; height: 16px; border-radius: 3px; }
    .tm-item.plain { padding-left: 40px; }
    .tm-sep { height: 1px; margin: 4px 0; background: ${c.line}; }
  </style>
  <div class="tm">${items}<div class="tm-sep"></div><div class="tm-item plain">Master Tool’u göster</div><div class="tm-item plain">Çıkış</div></div>
  <div class="tb">
    <div class="ti"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 15 6-6 6 6"/></svg></div>
    <div class="ti on"><img src="${svgData('mt')}"></div>
    <div class="ti"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/></svg></div>
    <div class="ti"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4h4l5 4V6L8 10z"/></svg></div>
    <div class="clock">14:32<br>15.10.2026</div>
  </div>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const manifest = [];
  const shot = async (file, theme, title, caption, run) => {
    if (caption.length > 80) throw new Error(`caption > 80: ${caption}`);
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, colorScheme: theme, locale: 'tr-TR' });
    const page = await ctx.newPage();
    await run(page, theme === 'dark');
    await page.waitForTimeout(350); // animasyonlar otursun
    await page.screenshot({ path: path.join(OUT, file) });
    await ctx.close();
    manifest.push({ file, theme, title, caption });
    console.log('✓', file);
  };
  const openMain = async (page, scene, after) => {
    await page.addInitScript(stubScript({ scene, settings: SETTINGS }));
    await page.goto('file://' + path.join(ROOT, 'src', 'renderer', 'index.html'));
    await page.waitForSelector('.tile');
    if (after) await after(page);
  };

  for (const theme of ['dark', 'light']) {
    const tn = theme === 'dark' ? 'gece' : 'gunduz';
    await shot(`01-uygulamalar-${tn}.png`, theme, 'Kurulu ve kurulu olmayan uygulamalar',
      'Kurulu uygulamalar tek tıkla açılır, kurulu olmayanlar tek tıkla kurulur', (p) => openMain(p, SCENES.groups));
    await shot(`02-indirme-${tn}.png`, theme, 'İndirme ilerlemesi',
      'Simgenin üzerinde dairesel ilerleme (yüzde, MB); birden çok indirme aynı anda', (p) => openMain(p, SCENES.download));
    await shot(`03-guncelleme-${tn}.png`, theme, 'Güncelleme rozeti',
      'Yeni sürümü olan uygulamada “Güncelleme var” rozeti ve tek tıkla Güncelle', (p) => openMain(p, SCENES.groups, async (pg) => {
        await pg.hover('.tile[data-app="fm"]');
      }));
    await shot(`04-tepsi-${tn}.png`, theme, 'Tepsi menüsü',
      'Tepsi simgesine tek tık: kurulu uygulamalar listelenir, tıklayınca açılır', (p, dark) => openMain(p, SCENES.groups, async (pg) => {
        const inst = SCENES.groups.apps.filter((a) => a.installed.installed);
        await pg.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), trayOverlay(dark, inst));
      }));
    await shot(`05-ayarlar-genel-${tn}.png`, theme, 'Ayarlar › Genel',
      'Dil, Gece/Gündüz/Sistem teması, Windows ile başlat, tepsi ve güncellemeler', (p) => openMain(p, SCENES.groups, async (pg) => {
        await pg.click('#btnSettings');
        await pg.waitForSelector('.set-wrap');
      }));
    await shot(`06-ayarlar-hesap-${tn}.png`, theme, 'Ayarlar › Hesap',
      'Tek giriş: bir kez giriş yapın; çıkış tüm Mastertool uygulamalarından çıkarır', (p) => openMain(p, SCENES.groups, async (pg) => {
        await pg.click('#btnSettings');
        await pg.click('.set-nav [data-tab="account"]');
      }));
    await shot(`07-ayarlar-depolama-${tn}.png`, theme, 'Ayarlar › Depolama',
      'İndirilen kurulum dosyaları; kurulumdan sonra kendiliğinden silinir', (p) => openMain(p, SCENES.groups, async (pg) => {
        await pg.click('#btnSettings');
        await pg.click('.set-nav [data-tab="storage"]');
      }));
    // Giriş penceresi 440×640; masaüstü zemini üzerinde ortalanır
    await shot(`08-giris-${tn}.png`, theme, 'Tek giriş',
      'Bir kez giriş yapın: SSH Master, FTP Masters ve diğerleri yeniden giriş istemez', async (p, dark) => {
        const ctx = p.context();
        const lp = await ctx.newPage();
        await lp.setViewportSize({ width: 440, height: 640 });
        await lp.addInitScript(stubScript({ scene: SCENES.groups, settings: SETTINGS }));
        await lp.goto('file://' + path.join(ROOT, 'src', 'renderer', 'login.html'));
        await lp.waitForTimeout(300);
        await lp.evaluate(() => { document.querySelector('#password').value = 'örnekşifre'; document.activeElement.blur(); });
        const png = (await lp.screenshot()).toString('base64');
        await lp.close();
        const bg = dark ? 'radial-gradient(900px 600px at 80% 0%, #1e2a4a, transparent), radial-gradient(800px 600px at 0% 100%, #0f3a44, transparent), #0b0f17'
          : 'radial-gradient(900px 600px at 80% 0%, #dbe4ff, transparent), radial-gradient(800px 600px at 0% 100%, #d5f5fb, transparent), #eef2f7';
        await p.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:${bg}">
          <div style="border-radius:10px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,${dark ? '.55' : '.22'}),0 0 0 1px rgba(${dark ? '255,255,255,.08' : '0,0,0,.08'})">
            <div style="height:32px;background:${dark ? '#1c1f26' : '#f3f3f3'};display:flex;align-items:center;gap:8px;padding:0 12px;font:12px 'Segoe UI',system-ui;color:${dark ? '#ddd' : '#333'}">
              <img src="${svgData('mt')}" style="width:16px;height:16px;border-radius:4px">Master Tool</div>
            <img src="data:image/png;base64,${png}" style="display:block;width:440px;height:640px"></div></body>`);
      });
  }
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await browser.close();
  console.log(`${manifest.length} görüntü → ${path.relative(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
