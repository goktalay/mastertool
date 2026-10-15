'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInstalled, detectAll, parseEntries, nameMatches, dirFromIcon } = require('../src/detect');

const SM = { app: 'sm', name: 'SSH Master', exe: 'SSH Master.exe' };
const FM = { app: 'fm', name: 'FTP Masters', exe: 'FTP Masters.exe' };
const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\Gökhan\\AppData\\Local' };
const existsIn = (...paths) => (p) => paths.includes(p);

test('DisplayName adla başlamalı; benzer başka ürün eşleşmez', () => {
  assert.ok(nameMatches('SSH Master 1.1.0', 'SSH Master'));
  assert.ok(nameMatches('SSH Master', 'SSH Master'));
  assert.ok(!nameMatches('SSH Masters 2', 'SSH Master'));
  assert.ok(!nameMatches('Notepad++', 'Notepad Master'));
});

test('kayıt defteri: InstallLocation + exe, DisplayVersion', () => {
  const entries = [
    { DisplayName: 'Başka Uygulama', InstallLocation: 'C:\\X' },
    { DisplayName: 'SSH Master 1.1.0', DisplayVersion: '1.1.0', InstallLocation: 'C:\\Program Files\\Mastertool\\SSH Master' },
  ];
  const r = resolveInstalled(SM, entries, { exists: existsIn('C:\\Program Files\\Mastertool\\SSH Master\\SSH Master.exe'), env });
  assert.deepEqual(r, { installed: true, exePath: 'C:\\Program Files\\Mastertool\\SSH Master\\SSH Master.exe', dir: 'C:\\Program Files\\Mastertool\\SSH Master', version: '1.1.0', source: 'registry' });
});

test('InstallLocation boşsa DisplayIcon klasörü; sürüm addan', () => {
  const dir = 'C:\\Users\\Gökhan\\AppData\\Local\\Programs\\Mastertool\\SSH Master';
  const entries = [{ DisplayName: 'SSH Master 1.2.3', InstallLocation: '', DisplayIcon: `"${dir}\\SSH Master.exe",0` }];
  const r = resolveInstalled(SM, entries, { exists: existsIn(`${dir}\\SSH Master.exe`), env });
  assert.equal(r.installed, true);
  assert.equal(r.version, '1.2.3');
  assert.equal(dirFromIcon(`"${dir}\\SSH Master.exe",0`), dir);
});

test('kayıt var ama exe yoksa kurulu değil', () => {
  const entries = [{ DisplayName: 'SSH Master 1.1.0', InstallLocation: 'C:\\Silinmiş' }];
  assert.equal(resolveInstalled(SM, entries, { exists: () => false, env }).installed, false);
});

test('yedek yollar: Mastertool klasörü, yalnız bu kullanıcı, eski konumlar', () => {
  const cases = [
    'C:\\Program Files\\Mastertool\\FTP Masters\\FTP Masters.exe',
    'C:\\Users\\Gökhan\\AppData\\Local\\Programs\\Mastertool\\FTP Masters\\FTP Masters.exe',
    'C:\\Program Files\\FTP Masters\\FTP Masters.exe',
    'C:\\Users\\Gökhan\\AppData\\Local\\Programs\\FTP Masters\\FTP Masters.exe',
  ];
  for (const p of cases) {
    const r = resolveInstalled(FM, [], { exists: existsIn(p), env });
    assert.equal(r.installed, true, p);
    assert.equal(r.exePath, p);
    assert.equal(r.source, 'path');
    assert.equal(r.version, null);
  }
});

test('taşınabilir sürüm (ör. İndirilenler klasöründe) kurulu sayılmaz', () => {
  const r = resolveInstalled(FM, [], { exists: existsIn('C:\\Users\\Gökhan\\Downloads\\FTP-Masters-Portable-1.0.0.exe'), env });
  assert.equal(r.installed, false);
});

test('detectAll her uygulama için sonuç döndürür', async () => {
  const entries = [{ DisplayName: 'SSH Master 1.1.0', DisplayVersion: '1.1.0', InstallLocation: 'D:\\Apps\\SSH Master' }];
  const out = await detectAll([SM, FM], { entries, exists: existsIn('D:\\Apps\\SSH Master\\SSH Master.exe'), env });
  assert.equal(out.sm.installed, true);
  assert.equal(out.fm.installed, false);
});

test('PowerShell JSON çıktısı (BOM, tek nesne, boş) ayrıştırılır', () => {
  assert.equal(parseEntries('\uFEFF[{"DisplayName":"SSH Master 1.0.0"}]').length, 1);
  assert.equal(parseEntries('{"DisplayName":"Tek"}').length, 1);
  assert.deepEqual(parseEntries(''), []);
  assert.deepEqual(parseEntries('bozuk'), []);
});
