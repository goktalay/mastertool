'use strict';

// Kurulu uygulamaları algılama (sözleşme v1 §4).
// 1) HKCU ve HKLM, 64 ve 32 bit görünüm: Software\Microsoft\Windows\CurrentVersion\Uninstall\*
//    DisplayName'i uygulama adıyla başlayan kayıt → InstallLocation\<exe>, DisplayVersion.
// 2) Yedek yollar: %ProgramFiles%\Mastertool\<ad>\<exe>, %LOCALAPPDATA%\Programs\Mastertool\<ad>\<exe>,
//    eski %ProgramFiles%\<ad>\<exe>, %LOCALAPPDATA%\Programs\<ad>\<exe>.
// Exe yoksa kurulu sayılmaz; taşınabilir sürüm bu yerlerde olmadığından kurulu sayılmaz.

const fs = require('fs');
const path = require('path').win32;
const { execFile } = require('child_process');

// reg.exe çıktısı konsol kod sayfasında gelir (ör. "C:\Users\Gökhan" bozulur). Bu yüzden kayıt defteri
// PowerShell + .NET ile okunur ve UTF-8 JSON olarak alınır. Görünümler (Registry64/Registry32) açıkça seçilir.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$out = New-Object System.Collections.ArrayList
foreach ($hive in @('CurrentUser','LocalMachine')) {
  foreach ($view in @('Registry64','Registry32')) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
    $root = $base.OpenSubKey('Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    if ($root -eq $null) { continue }
    foreach ($name in $root.GetSubKeyNames()) {
      $k = $root.OpenSubKey($name)
      if ($k -eq $null) { continue }
      $dn = $k.GetValue('DisplayName')
      if ($dn) {
        [void]$out.Add([ordered]@{ hive = $hive; view = $view; key = $name; DisplayName = [string]$dn;
          DisplayVersion = [string]$k.GetValue('DisplayVersion'); InstallLocation = [string]$k.GetValue('InstallLocation');
          DisplayIcon = [string]$k.GetValue('DisplayIcon') })
      }
      $k.Close()
    }
    $root.Close()
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

function readUninstallEntries({ timeout = 15000 } = {}) {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err && !stdout) return resolve([]);
        resolve(parseEntries(stdout));
      });
  });
}

function parseEntries(stdout) {
  try {
    const v = JSON.parse(String(stdout || '').replace(/^\uFEFF/, '').trim() || '[]');
    return (Array.isArray(v) ? v : [v]).filter((e) => e && e.DisplayName);
  } catch {
    return [];
  }
}

// "SSH Master" ↔ "SSH Master 1.1.0" (electron-builder DisplayName'e sürümü ekler). "SSH Masters" gibi
// başka bir ürün eşleşmesin diye addan sonra ya hiçbir şey ya da boşluk gelmeli.
function nameMatches(displayName, name) {
  const d = String(displayName || '').trim().toLowerCase();
  const n = String(name || '').trim().toLowerCase();
  return !!n && (d === n || d.startsWith(n + ' '));
}

const unquote = (s) => String(s || '').trim().replace(/^"(.*)"$/, '$1');

// DisplayIcon: "C:\...\SSH Master.exe,0" → klasör
function dirFromIcon(icon) {
  const p = unquote(String(icon || '').replace(/,\s*-?\d+\s*$/, ''));
  return p ? path.dirname(p) : '';
}

function fallbackPaths(app, env) {
  const out = [];
  const pf = env.ProgramW6432 || env.ProgramFiles;
  const local = env.LOCALAPPDATA;
  if (pf) out.push(path.join(pf, 'Mastertool', app.name, app.exe));
  if (local) out.push(path.join(local, 'Programs', 'Mastertool', app.name, app.exe));
  if (pf) out.push(path.join(pf, app.name, app.exe));
  if (local) out.push(path.join(local, 'Programs', app.name, app.exe));
  return [...new Set(out)];
}

// Saf işlev (testlerde kayıtlar ve dosya varlığı sahte verilir).
// app: { app, name, exe } → { installed, exePath, version, source, dir }
function resolveInstalled(app, entries, { exists = fs.existsSync, env = process.env } = {}) {
  const exe = app.exe || `${app.name}.exe`;
  for (const e of entries || []) {
    if (!nameMatches(e.DisplayName, app.name)) continue;
    const dirs = [unquote(e.InstallLocation), dirFromIcon(e.DisplayIcon)].filter(Boolean);
    for (const dir of dirs) {
      const p = path.join(dir, exe);
      if (exists(p)) {
        const version = String(e.DisplayVersion || '').trim() || versionFromName(e.DisplayName, app.name);
        return { installed: true, exePath: p, dir, version: version || null, source: 'registry' };
      }
    }
  }
  for (const p of fallbackPaths({ ...app, exe }, env)) {
    if (exists(p)) return { installed: true, exePath: p, dir: path.dirname(p), version: null, source: 'path' };
  }
  return { installed: false, exePath: null, dir: null, version: null, source: null };
}

function versionFromName(displayName, name) {
  const rest = String(displayName || '').slice(String(name || '').length).trim();
  return /^\d+(\.\d+)*/.test(rest) ? rest.match(/^\d+(\.\d+)*/)[0] : '';
}

async function detectAll(apps, opts = {}) {
  const entries = opts.entries || (await (opts.readEntries || readUninstallEntries)());
  const out = {};
  for (const a of apps) out[a.app] = resolveInstalled(a, entries, opts);
  return out;
}

module.exports = { detectAll, resolveInstalled, readUninstallEntries, parseEntries, nameMatches, fallbackPaths, dirFromIcon, PS_SCRIPT };
