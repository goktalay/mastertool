'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTrayTemplate, createClickRouter } = require('../src/tray-menu');
const I18N = require('../src/i18n');

const t = I18N.createT('tr');
const apps = [
  { app: 'sm', name: 'SSH Master', installed: { installed: true } },
  { app: 'cv', name: 'Convert Master', installed: { installed: true } },
  { app: 'fm', name: 'FTP Masters', installed: { installed: false } },
  { app: 'np', name: 'Notepad Master' },
];

test('yalnız kurulu uygulamalar, katalog sırasıyla (group alanı olmayan eski katalog); ardından ayırıcı, göster, çıkış', () => {
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

test('kurulu araçlar ayırıcı ve "Araçlar" başlığıyla ayrı grupta; bilinmeyen group araçlara düşer', () => {
  const list = [
    { app: 'ip', name: 'IP Tools', group: 'tools', installed: { installed: true } },
    { app: 'sm', name: 'SSH Master', group: 'apps', installed: { installed: true } },
    { app: 'qp', name: 'Quick Preview', group: 'tools', installed: { installed: false } },
    { app: 'zz', name: 'Yeni Araç', group: 'widgets', installed: { installed: true } },
  ];
  const opened = [];
  const tpl = buildTrayTemplate({ apps: list, t, onOpen: (c) => opened.push(c), onShow() {}, onQuit() {} });
  assert.deepEqual(tpl.map((i) => i.label || i.type), ['SSH Master', 'separator', 'Araçlar', 'IP Tools', 'Yeni Araç', 'separator', 'Master Tool’u göster', 'Çıkış']);
  assert.equal(tpl[2].enabled, false);
  tpl[3].click();
  assert.deepEqual(opened, ['ip']);
});

test('yalnız araç kuruluysa baştaki ayırıcı olmaz', () => {
  const tpl = buildTrayTemplate({ apps: [{ app: 'fs', name: 'File Search', group: 'tools', installed: { installed: true } }], t, onOpen() {}, onShow() {}, onQuit() {} });
  assert.deepEqual(tpl.map((i) => i.label || i.type), ['Araçlar', 'File Search', 'separator', 'Master Tool’u göster', 'Çıkış']);
});
