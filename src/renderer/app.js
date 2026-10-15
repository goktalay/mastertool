'use strict';

// Ana pencere: kurulu / kurulu değil grupları, indirme ilerlemesi, hesap, ayarlar

const $ = (s) => document.querySelector(s);
const IS_RTL = document.documentElement.dir === 'rtl';
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

let state = { apps: [], account: {}, offline: false };
const jobs = {}; // app -> { phase, received, total }

// --- Başlangıç ---------------------------------------------------------------
$('#btnRefresh').innerHTML = icon('refresh');
$('#btnRefresh').title = t('common.refresh');
$('#btnSettings').innerHTML = icon('gear');
$('#btnSettings').title = t('mt.settings');
$('#tInstalled').textContent = t('mt.installed');
$('#tAvailable').textContent = t('mt.notInstalled');
$('#hInstalled').textContent = t('mt.installedHint');
$('#hAvailable').textContent = t('mt.notInstalledHint');
$('.topbar').appendChild(portalLink()); // en sağ üst köşe

$('#btnSettings').onclick = () => openSettings();
$('#btnRefresh').onclick = async () => {
  const b = $('#btnRefresh');
  b.disabled = true;
  b.innerHTML = '<span class="spin"></span>';
  try { apply(await window.api.refresh()); } finally { b.disabled = false; b.innerHTML = icon('refresh'); }
};

window.api.onState(apply);
window.api.onJob(({ app, job }) => {
  if (job) jobs[app] = job; else delete jobs[app];
  const a = state.apps.find((x) => x.app === app);
  if (a) { a.job = job; updateTile(a); }
});
window.api.onToast(({ key, vars, type }) => toast(t(key, vars), { type, timeout: type === 'err' ? 9000 : 4500 }));
window.api.getState().then(apply);

document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop')) return;
  if (e.key === 'F5') { e.preventDefault(); $('#btnRefresh').click(); }
  if (e.ctrlKey && e.key === ',') { e.preventDefault(); openSettings(); }
});

function apply(st) {
  state = st;
  for (const a of state.apps) { if (a.job) jobs[a.app] = a.job; else delete jobs[a.app]; }
  render();
}

// --- Gruplar ve kutucuklar ------------------------------------------------------
const isInstalled = (a) => !!(a.installed && a.installed.installed);

function render() {
  const inst = state.apps.filter(isInstalled);
  const avail = state.apps.filter((a) => !isInstalled(a));
  $('#stats').textContent = t('mt.count', { installed: inst.length, total: state.apps.length });
  $('#cInstalled').textContent = inst.length;
  $('#cAvailable').textContent = avail.length;
  fill($('#installed'), inst, t('mt.emptyInstalled'));
  fill($('#available'), avail, t('mt.allInstalled'));
  $('#offlineBar').classList.toggle('hidden', !state.offline);
  $('#offlineBar').innerHTML = `${icon('cloudOff')}<span>${esc(t('mt.offline'))}</span>`;
  renderAccountChip();
}

function fill(el, apps, emptyText) {
  el.innerHTML = '';
  if (!apps.length) { el.appendChild(h(`<div class="empty-note">${esc(emptyText)}</div>`)); return; }
  for (const a of apps) el.appendChild(tile(a));
}

function tile(a) {
  const el = h(`<div class="tile" data-app="${esc(a.app)}" tabindex="0">
    <div class="ic-wrap">
      <img class="ic" src="${esc(a.icon)}" alt="">
      <div class="ring-veil"></div>
      <svg class="ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle class="ring-bg" cx="60" cy="60" r="${RING_R}"/>
        <circle class="ring-fg" cx="60" cy="60" r="${RING_R}" stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"/>
      </svg>
      <div class="ring-pct"></div>
      <span class="badge-upd" title="">${icon('up')}</span>
    </div>
    <div class="t-name">${esc(a.name)}</div>
    <div class="t-sub"></div>
    <div class="t-desc">${esc(t(`mt.desc.${a.app}`))}</div>
    <div class="t-act"></div>
  </div>`);
  el.addEventListener('click', (e) => { if (!e.target.closest('.t-act button')) onTileClick(a.app); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTileClick(a.app); } });
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); tileMenu(a.app, e.clientX, e.clientY); });
  updateTile(a, el);
  return el;
}

function updateTile(a, el = document.querySelector(`.tile[data-app="${a.app}"]`)) {
  if (!el) return;
  const job = jobs[a.app] || null;
  const inst = isInstalled(a);
  const disabled = !inst && a.license && a.license !== 'AKTIF';
  const noRelease = !inst && !disabled && state.fresh && !a.release;
  el.className = `tile ${inst ? 'installed' : 'available'}${disabled ? ' disabled' : ''}${noRelease ? ' unreleased' : ''}${job ? ` busy ${job.phase}` : ''}${a.updateAvailable ? ' has-update' : ''}`;

  // İlerleme halkası: yüzde + MB
  const fg = el.querySelector('.ring-fg');
  const pct = job && job.phase === 'download' && job.total ? Math.min(100, Math.floor((job.received / job.total) * 100)) : 0;
  fg.setAttribute('stroke-dashoffset', (RING_C * (1 - pct / 100)).toFixed(2));
  el.querySelector('.ring-pct').innerHTML = !job ? '' : job.phase === 'download' ? `${ltr(`${pct}%`)}` : '<span class="spin"></span>';

  const sub = el.querySelector('.t-sub');
  const act = el.querySelector('.t-act');
  act.innerHTML = '';
  sub.title = '';
  if (job) {
    sub.innerHTML = job.phase === 'download' ? formatProgress(job.received, job.total) : esc(t('mt.installing'));
    sub.title = job.phase === 'download' ? t('mt.downloading') : '';
    sub.className = 't-sub accent';
  } else if (inst) {
    const v = a.installed.version;
    sub.innerHTML = esc(v ? t('mt.version', { version: v }) : t('mt.versionUnknown')) +
      (a.updateAvailable ? ` <b class="to">${ltr(`→ ${esc(a.release.version)}`)}</b>` : '');
    sub.title = a.updateAvailable ? t('mt.updateAvail', { version: a.release.version }) : '';
    sub.className = 't-sub';
    if (a.updateAvailable) {
      const b = h(`<button class="btn sm primary">${icon('download')}${esc(t('mt.update'))}</button>`);
      b.onclick = () => window.api.installApp(a.app);
      act.appendChild(b);
    }
  } else if (disabled) {
    sub.innerHTML = `${icon('lock')}${esc(t('mt.disabled'))}`;
    sub.className = 't-sub muted';
  } else if (noRelease) {
    sub.textContent = t('mt.noRelease');
    sub.className = 't-sub muted';
  } else {
    const r = a.release;
    sub.innerHTML = r ? `${esc(t('mt.version', { version: r.version }))}${r.size ? ` · ${formatSize(r.size)}` : ''}` : esc(t('mt.notInstalled'));
    sub.className = 't-sub';
  }
  el.querySelector('.badge-upd').title = a.updateAvailable ? t('mt.updateAvail', { version: a.release.version }) : '';
  el.title = job ? '' : inst ? t('mt.installedHint') : disabled ? t('mt.errAppDisabled', { name: a.name }) : noRelease ? '' : t('mt.notInstalledHint');
}

async function onTileClick(code) {
  const a = state.apps.find((x) => x.app === code);
  if (!a) return;
  const job = jobs[code];
  if (job) {
    if (job.phase !== 'download') return;
    // İndirme sürerken tekrar tıklama = iptal sorusu
    const ok = await confirmBox(t('mt.cancelTitle'), esc(t('mt.cancelMsg', { name: a.name })), { okText: t('mt.cancelOk'), cancelText: t('common.giveUp'), iconName: 'x' });
    if (ok) window.api.cancelInstall(code);
    return;
  }
  if (isInstalled(a)) {
    const el = document.querySelector(`.tile[data-app="${code}"]`);
    if (el) { el.classList.add('launching'); setTimeout(() => el.classList.remove('launching'), 900); }
    const r = await window.api.openApp(code);
    if (r && r.ok) toast(t('mt.launched', { name: a.name }), { timeout: 2200 });
    return;
  }
  if (a.license && a.license !== 'AKTIF') { toast(t('mt.errAppDisabled', { name: a.name }), { type: 'err', timeout: 7000 }); return; }
  if (state.fresh && !a.release) { toast(t('mt.errNoRelease', { name: a.name }), { type: 'err' }); return; }
  window.api.installApp(code);
}

function tileMenu(code, x, y) {
  const a = state.apps.find((v) => v.app === code);
  if (!a) return;
  const job = jobs[code];
  const inst = isInstalled(a);
  const blocked = a.license && a.license !== 'AKTIF';
  contextMenu(x, y, [
    inst && { label: t('mt.open'), icon: 'play', action: () => onTileClick(code), disabled: !!job },
    inst && a.updateAvailable && { label: t('mt.update'), icon: 'download', action: () => window.api.installApp(code), disabled: !!job },
    !inst && { label: t('mt.install'), icon: 'download', action: () => onTileClick(code), disabled: !!job || blocked || (state.fresh && !a.release) },
    job && job.phase === 'download' && { label: t('mt.cancelOk'), icon: 'x', danger: true, action: () => window.api.cancelInstall(code) },
    '-',
    { label: t('mt.visitSite'), icon: 'globe', action: () => window.api.openSite(code) },
    inst && { label: t('mt.showFolder'), icon: 'folder', action: () => window.api.revealApp(code) },
  ]);
}

// --- Hesap ----------------------------------------------------------------------
function renderAccountChip() {
  const acct = state.account || {};
  const name = (acct.user && acct.user.name) || acct.email || '?';
  const b = $('#btnAccount');
  b.querySelector('.ac-avatar').textContent = name.trim().slice(0, 1).toLocaleUpperCase(LANG);
  b.querySelector('.ac-name').textContent = (acct.user && acct.user.name) || acct.email || '';
  b.title = acct.email || '';
}

$('#btnAccount').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const acct = state.account || {};
  contextMenu(IS_RTL ? r.left : r.right - 260, r.bottom + 6, [
    { label: acct.email || '', icon: 'user', disabled: true, action: () => {} },
    '-',
    { label: t('acct.myAccount'), icon: 'open', action: () => window.api.openWeb('account') },
    { label: t('mt.settings'), icon: 'gear', action: () => openSettings() },
    '-',
    { label: t('acct.logoutAll'), icon: 'logout', danger: true, action: logout },
  ]);
};

async function logout() {
  const ok = await confirmBox(t('acct.logoutAll'), esc(t('acct.logoutMsg')), { okText: t('acct.logout'), iconName: 'logout' });
  if (ok) window.api.logout();
}

// --- Master Tool'un kendi güncellemesi -------------------------------------------------
window.api.onUpdateAvailable(({ version }) => {
  const bar = $('#updateBar');
  bar.innerHTML = `${icon('download')}<span id="updText">${esc(t('update.available', { version }))}</span>
    <button class="btn sm primary" data-a="install">${esc(t('update.install'))}</button>
    <button class="icon-btn" data-a="close" title="${esc(t('common.close'))}">${icon('x')}</button>`;
  bar.classList.remove('hidden');
  bar.querySelector('[data-a="install"]').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const r = await window.api.selfUpdate();
    if (!r.ok) {
      e.currentTarget.disabled = false;
      $('#updText').textContent = t('update.failed', { msg: r.message || r.code || '' });
    }
  };
  bar.querySelector('[data-a="close"]').onclick = () => bar.classList.add('hidden');
});
window.api.onUpdateProgress((p) => {
  const el = $('#updText');
  if (!el) return;
  if (p.phase === 'install') { el.textContent = t('update.installing'); return; }
  const pct = p.total ? Math.floor((p.received / p.total) * 100) : 0;
  el.textContent = t('update.downloading', { pct: ltr(`${pct}%`) });
});

// --- Ayarlar ----------------------------------------------------------------------
// Mastertool ortak iskeleti: Genel (dil, tema, başlangıç, güncellemeler) · Hesap · Depolama · Hakkında
const OSS = [['Master Tool', 'MIT'], ['Electron', 'MIT'], ['Chromium', 'BSD-3-Clause +'], ['Node.js', 'MIT'], ['@napi-rs/keyring', 'MIT']];

async function openSettings(startTab = 'general') {
  const [s, about, storage] = await Promise.all([window.api.getSettings(), window.api.about(), window.api.storageInfo()]);
  let appTheme = s.appTheme || 'system';
  const acct = state.account || {};
  const langOptions = Object.entries(I18N.LANGUAGES)
    .map(([code, l]) => `<option value="${code}" ${code === LANG ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  const tabs = [
    ['general', 'gear', t('set.general')],
    ['account', 'user', t('set.account')],
    ['storage', 'drive', t('set.storage')],
    ['about', 'bolt', t('set.about')],
  ];

  const body = h(`<div class="set-wrap">
    <nav class="set-nav">${tabs.map(([k, ic, label]) => `<button type="button" data-tab="${k}">${icon(ic)}<span>${esc(label)}</span></button>`).join('')}</nav>
    <div class="set-pages">
      <section data-page="general">
        <div class="field"><label>${esc(t('set.language'))}</label><select class="input" id="s-lang">${langOptions}</select>
          <small class="set-hint">${esc(t('set.languageHint'))}</small></div>
        <div class="field"><label>${esc(t('set.theme'))}</label>
          <div class="seg" id="s-theme">
            <button type="button" data-v="dark">${icon('moon')}${esc(t('set.themeDark'))}</button>
            <button type="button" data-v="light">${icon('sun')}${esc(t('set.themeLight'))}</button>
            <button type="button" data-v="system">${icon('monitor')}${esc(t('set.themeSystem'))}</button>
          </div></div>
        <div class="section-title">${esc(t('set.startup'))}</div>
        <label class="check"><input type="checkbox" id="s-login" ${about.openAtLogin ? 'checked' : ''}>
          <span>${esc(t('set.openAtLogin'))}<small>${esc(t('set.openAtLoginHint'))}</small></span></label>
        <label class="check"><input type="checkbox" id="s-min" ${s.minimizeToTray ? 'checked' : ''}>
          <span>${esc(t('set.minTray'))}<small>${esc(t('set.minTrayHint'))}</small></span></label>
        <label class="check"><input type="checkbox" id="s-close" ${s.closeToTray ? 'checked' : ''}>
          <span>${esc(t('set.closeTray'))}<small>${esc(t('set.closeTrayHint'))}</small></span></label>
        <div class="section-title">${esc(t('set.updates'))}</div>
        <label class="check"><input type="checkbox" id="s-upd" ${s.checkUpdates ? 'checked' : ''}>
          <span>${esc(t('set.autoUpdate'))}<small>${esc(t('set.autoUpdateHint'))}</small></span></label>
        <div><button class="btn sm" type="button" id="s-quit">${icon('power')}${esc(t('set.quit'))}</button></div>
      </section>

      <section data-page="account">
        <div class="acct-box">
          <div class="acct-who">${icon('user')}<span class="ltr">${esc(t('acct.signedInAs', { email: acct.email || '' }))}</span></div>
          <div class="set-hint">${esc(t('acct.ssoInfo'))}</div>
          <div class="acct-actions">
            <button class="btn sm" type="button" id="s-web">${icon('open')}${esc(t('acct.myAccount'))}</button>
            <span style="flex:1"></span>
            <button class="btn sm danger" type="button" id="s-logout">${icon('logout')}${esc(t('acct.logoutAll'))}</button>
          </div>
        </div>
      </section>

      <section data-page="storage">
        <div class="field"><label>${esc(t('set.storageDir'))}</label>
          <div class="path-row"><span class="path" id="s-dir">${esc(storage.dir)}</span>
            <button class="btn sm" type="button" id="s-open">${icon('folder')}${esc(t('set.storageOpen'))}</button></div></div>
        <div class="storage-box">
          <div class="storage-used" id="s-used"></div>
          <ul class="oss" id="s-files"></ul>
          <div class="acct-actions"><button class="btn sm" type="button" id="s-clean">${icon('trash')}${esc(t('set.storageClean'))}</button></div>
        </div>
        <div class="set-hint">${esc(t('set.storageHint'))}</div>
      </section>

      <section data-page="about">
        <div class="about-head">
          <img src="../../build/icon.png" alt="">
          <div><div class="about-name">Master Tool</div>
            <div class="about-ver">${esc(t('about.version', { version: about.version }))}</div></div>
        </div>
        <div class="set-hint">${esc(t('about.family'))}</div>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-update">${icon('refresh')}${esc(t('about.checkUpdate'))}</button>
          <span class="about-update" id="s-update-result"></span>
        </div>
        <div class="section-title">${esc(t('about.licenses'))}</div>
        <div class="set-hint">${esc(t('about.licensesIntro'))}</div>
        <ul class="oss">${OSS.map(([n, l]) => `<li><span>${esc(n)}</span><span>${esc(l)}</span></li>`).join('')}</ul>
        <div class="acct-actions">
          <button class="btn sm" type="button" id="s-licenses">${icon('file')}${esc(t('about.chromium'))}</button>
          <span class="set-hint">Electron ${esc(about.electron)} · Chromium ${esc(about.chrome)}</span>
        </div>
      </section>
    </div>
  </div>`);

  const q = (sel) => body.querySelector(sel);
  const showTab = (k) => {
    body.querySelectorAll('.set-nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    body.querySelectorAll('.set-pages section').forEach((p) => p.classList.toggle('hidden', p.dataset.page !== k));
  };
  body.querySelectorAll('.set-nav button').forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  showTab(startTab);

  // Tema seçimi anında uygulanır (önizleme); İptal edilirse eski temaya döner
  const originalTheme = appTheme;
  const setTheme = (v) => {
    appTheme = v;
    body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    window.api.setSettings({ appTheme: v });
  };
  body.querySelectorAll('#s-theme button').forEach((b) => (b.onclick = () => setTheme(b.dataset.v)));
  body.querySelectorAll('#s-theme button').forEach((b) => b.classList.toggle('on', b.dataset.v === appTheme));

  q('#s-quit').onclick = () => window.api.quit();
  q('#s-web').onclick = () => window.api.openWeb('account');
  q('#s-logout').onclick = logout;

  // Depolama: indirilen kurulum dosyaları
  const renderStorage = (st) => {
    q('#s-used').textContent = st.files.length ? t('set.storageUsed', { n: st.files.length, size: formatSize(st.bytes) }) : t('set.storageEmpty');
    q('#s-files').innerHTML = st.files.map((f) => `<li><span class="ltr">${esc(f.name)}</span><span>${formatSize(f.size)}</span></li>`).join('');
    q('#s-files').classList.toggle('hidden', !st.files.length);
    q('#s-clean').disabled = !st.files.length;
  };
  renderStorage(storage);
  q('#s-open').onclick = () => window.api.storageOpen();
  q('#s-clean').onclick = async () => {
    const r = await window.api.storageClear();
    if (!r.ok) { toast(t('set.storageBusy'), { type: 'err' }); return; }
    toast(t('set.storageCleaned'), { type: 'ok' });
    renderStorage(await window.api.storageInfo());
  };

  // Hakkında: yeni sürüm denetimi ve lisanslar
  q('#s-update').onclick = async () => {
    const out = q('#s-update-result');
    out.className = 'about-update';
    out.textContent = t('about.checking');
    const r = await window.api.checkUpdate();
    if (!r.ok) { out.classList.add('err'); out.textContent = t('about.checkFailed', { msg: r.message || r.code }); return; }
    if (r.newer) { out.classList.add('new'); out.textContent = t('update.available', { version: r.latest }); }
    else { out.classList.add('ok'); out.textContent = t('about.upToDate'); }
  };
  q('#s-licenses').onclick = () => window.api.openLicenses();

  const res = await openModal({
    title: t('set.title'), iconName: 'gear', width: 760, body,
    buttons: [
      { label: t('common.cancel'), value: null },
      {
        label: t('common.save'), cls: 'primary',
        onClick: (m) => ({
          appTheme,
          language: m.querySelector('#s-lang').value,
          openAtLogin: m.querySelector('#s-login').checked,
          minimizeToTray: m.querySelector('#s-min').checked,
          closeToTray: m.querySelector('#s-close').checked,
          checkUpdates: m.querySelector('#s-upd').checked,
        }),
      },
    ],
  });
  if (!res) {
    if (appTheme !== originalTheme) window.api.setSettings({ appTheme: originalTheme });
    return;
  }
  const langChanged = res.language !== LANG;
  if (!langChanged) delete res.language; // dil değişmediyse pencereyi yeniden yükleme
  await window.api.setSettings(res);
  if (!langChanged) toast(t('set.saved'), { type: 'ok' });
}
