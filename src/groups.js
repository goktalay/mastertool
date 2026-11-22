// Katalogdaki "group" alanına göre bölümler: "apps" (uygulamalar), "tools" (Araçlar), "games" (Oyunlar).
// Bilinmeyen ya da eksik değer: uygulama kodlarından biriyse "apps", web kaydıysa "games", değilse "tools" — böylece
// sunucuya eklenen yeni araçlar programı güncellemeden görünür. Katalog sırası korunur.
// kind: "web" kayıtlar (ör. VOLFAI) kurulmaz; tıklayınca varsayılan tarayıcıda açılır.
// Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
(function (root) {
  'use strict';

  const APP_CODES = ['sm', 'fm', 'sq', 'np', 'cv', 'vm'];
  const GROUPS = ['apps', 'tools', 'games'];

  const isWeb = (a) => !!(a && a.kind === 'web' && /^https:\/\//i.test(String(a.url || '')));

  function groupOf(a) {
    if (a && GROUPS.includes(a.group)) return a.group;
    if (a && a.group == null && APP_CODES.includes(a.app)) return 'apps'; // eski katalog (group alanı yok)
    return isWeb(a) ? 'games' : 'tools';
  }

  // Sunucu kaydını tek biçime getirir: kod "app" ya da "code" alanında gelebilir; geçersiz kod atılır.
  // kind "web" olup https adresi olmayan kayıt da atılır (kurulabilir bir exe sanılıp indirilmeye çalışılmasın).
  function normalizeEntry(a) {
    if (!a || typeof a !== 'object') return null;
    const code = String(a.app || a.code || '');
    if (!/^[a-z0-9]{1,16}$/.test(code) || !a.name) return null;
    if (a.kind === 'web' && !isWeb(a)) return null;
    return { ...a, app: code };
  }

  function normalizeCatalog(list) {
    return (Array.isArray(list) ? list : []).map(normalizeEntry).filter(Boolean);
  }

  function splitCatalog(list) {
    const out = { apps: [], tools: [], games: [] };
    for (const a of list || []) out[groupOf(a)].push(a);
    return out;
  }

  const api = { APP_CODES, GROUPS, isWeb, groupOf, normalizeEntry, normalizeCatalog, splitCatalog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MTGroups = api;
})(typeof self !== 'undefined' ? self : this);
