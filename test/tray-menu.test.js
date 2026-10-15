'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrayTemplate, createClickRouter } = require('../src/tray-menu');
const I18N = require('../src/i18n');

const t = I18N.createT('tr');
const apps = [
  { app: 'cv', name: 'Convert Master', installed: { installed: true } },
  { app: 'sm', name: 'SSH Master', installed: { installed: true } },
  { app: 'fm', name: 'FTP Masters', installed: { installed: false } },
  { app: 'np', name: 'Notepad Master' },
];

test('yalnız kurulu uygulamalar, katalog sırasıyla; ardından ayırıcı, göster, çıkış', () => {
  const opened = [];
  const tpl = buildTrayTemplate({ apps, t, iconFor: (c) => `icon-${c}`, onOpen: (c) => opened.push(c), onShow: () => opened.push('show'), onQuit: () => opened.push('quit') });
  assert.deepEqual(tpl.map((i) => i.label || i.type), ['SSH Master', 'Convert Master', 'separator', 'Master Tool’u göster', 'Çıkış']);
  assert.equal(tpl[0].icon, 'icon-sm');
  tpl[0].click(); tpl[1].click(); tpl[3].click(); tpl[4].click();
  assert.deepEqual(opened, ['sm', 'cv', 'show', 'quit']);
});

test('kurulu uygulama yoksa pasif "Kurulu uygulama yok" satırı', () => {
  const tpl = buildTrayTemplate({ apps: [], t, onOpen() {}, onShow() {}, onQuit() {} });
  assert.equal(tpl[0].label, 'Kurulu uygulama yok');
  assert.equal(tpl[0].enabled, false);
  assert.equal(tpl.length, 4);
});

test('tek tık menüyü açar; çift tıkta menü açılmaz, pencere gösterilir', async () => {
  const log = [];
  const r = createClickRouter({ onSingle: () => log.push('menu'), onDouble: () => log.push('show'), delay: 30 });
  r.click();
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(log, ['menu']);
  r.click(); r.doubleClick();
  await new Promise((res) => setTimeout(res, 60));
  assert.deepEqual(log, ['menu', 'show']);
});
