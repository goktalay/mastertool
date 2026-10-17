'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { groupOf, splitCatalog } = require('../src/groups');
const { resolveInstalled } = require('../src/detect');

test('group alanına göre bölümler; katalog sırası korunur', () => {
  const list = [
    { app: 'sm', group: 'apps' }, { app: 'ip', group: 'tools' }, { app: 'fm', group: 'apps' },
    { app: 'fs', group: 'tools' }, { app: 'qp', group: 'tools' },
  ];
  const { apps, tools } = splitCatalog(list);
  assert.deepEqual(apps.map((a) => a.app), ['sm', 'fm']);
  assert.deepEqual(tools.map((a) => a.app), ['ip', 'fs', 'qp']);
});

test('bilinmeyen group değeri ve group alanı olmayan yeni kod "Araçlar"a düşer', () => {
  assert.equal(groupOf({ app: 'xx', group: 'widgets' }), 'tools');
  assert.equal(groupOf({ app: 'yy' }), 'tools');
  assert.equal(groupOf({ app: 'sm', group: 'tools' }), 'tools'); // sunucu ne derse
});

test('group alanı olmayan eski katalogda bilinen uygulamalar "apps"', () => {
  assert.equal(groupOf({ app: 'cv' }), 'apps');
  assert.deepEqual(splitCatalog(null), { apps: [], tools: [], games: [] });
});

test('araçlar da aynı kurallarla algılanır (Program Files\\Mastertool\\<ad>\\<ad>.exe)', () => {
  const tool = { app: 'ip', name: 'IP Tools', exe: 'IP Tools.exe', group: 'tools' };
  const env = { ProgramFiles: 'C:\\Program Files' };
  const p = 'C:\\Program Files\\Mastertool\\IP Tools\\IP Tools.exe';
  assert.equal(resolveInstalled(tool, [{ DisplayName: 'IP Tools 0.1.0', DisplayVersion: '0.1.0', InstallLocation: 'C:\\Program Files\\Mastertool\\IP Tools' }], { exists: (x) => x === p, env }).version, '0.1.0');
  assert.equal(resolveInstalled(tool, [], { exists: (x) => x === p, env }).installed, true);
});

const { normalizeCatalog, isWeb } = require('../src/groups');

test('web kaydı (oyun): "code" alanı da kabul edilir, "Oyunlar"a düşer', () => {
  const list = normalizeCatalog([
    { code: 'vf', name: 'VOLFAI', group: 'games', kind: 'web', url: 'https://mastertool.download/oyunlar/volfai/' },
    { app: 'sm', name: 'SSH Master', group: 'apps' },
    { code: 'zz', name: 'Web', kind: 'web', url: 'https://mastertool.download/oyunlar/zz/' }, // group yok → games
  ]);
  assert.deepEqual(list.map((a) => a.app), ['vf', 'sm', 'zz']);
  assert.ok(isWeb(list[0]));
  const { games, apps } = splitCatalog(list);
  assert.deepEqual(games.map((a) => a.app), ['vf', 'zz']);
  assert.deepEqual(apps.map((a) => a.app), ['sm']);
});

test('https olmayan web kaydı ve geçersiz kod atılır (exe sanılıp indirilmesin)', () => {
  const list = normalizeCatalog([
    { code: 'vf', name: 'VOLFAI', kind: 'web', url: 'http://ornek.test/' },
    { code: 'vf', name: 'VOLFAI', kind: 'web', url: 'javascript:alert(1)' },
    { code: '../x', name: 'Kötü' },
    { app: 'ip', name: 'IP Tools', group: 'tools' },
  ]);
  assert.deepEqual(list.map((a) => a.app), ['ip']);
});
