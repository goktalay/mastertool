'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18N = require('../src/i18n');
const { compareVersions } = require('../src/api');

test('8 dil, sabit sıra', () => {
  assert.deepEqual(Object.keys(I18N.LANGUAGES), ['tr', 'en', 'fr', 'de', 'es', 'ar', 'zh', 'ru']);
  assert.equal(I18N.LANGUAGES.ar.dir, 'rtl');
});

test('her dilde anahtarlar aynı ve değişkenler korunmuş', () => {
  const ref = Object.keys(I18N.STRINGS.tr).sort();
  for (const lang of Object.keys(I18N.LANGUAGES)) {
    assert.deepEqual(Object.keys(I18N.STRINGS[lang]).sort(), ref, lang);
    for (const k of ref) {
      const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(vars(I18N.STRINGS[lang][k]), vars(I18N.STRINGS.tr[k]), `${lang} ${k}`);
    }
  }
});

test('kodda kullanılan her anahtar sözlükte var', () => {
  const dir = path.join(__dirname, '..', 'src');
  const files = ['main.js', 'renderer/app.js', 'renderer/login.js', 'tray-menu.js'];
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([a-z]+\.[A-Za-z.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/'((?:auth|mt|tray|set|acct|update|about|common)\.[A-Za-z]+)'/g)) used.add(m[1]);
  }
  for (const code of ['sm', 'fm', 'sq', 'np', 'cv', 'vm']) used.add(`mt.desc.${code}`);
  for (const k of used) assert.ok(k in I18N.STRINGS.tr, k);
});

test('sistem dili çözümleme ve geri düşme', () => {
  assert.equal(I18N.resolveLanguage('tr-TR'), 'tr');
  assert.equal(I18N.resolveLanguage('zh_CN'), 'zh');
  assert.equal(I18N.resolveLanguage('ja-JP'), 'en');
  const t = I18N.createT('ar');
  assert.equal(t('yok.boyle'), 'yok.boyle');
  assert.match(t('mt.count', { installed: 2, total: 5 }), /2\/5/);
});

test('sürüm karşılaştırma', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('v1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
});
