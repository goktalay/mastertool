// Katalogdaki "group" alanına göre bölümler: "apps" (uygulamalar) ve "tools" (Araçlar).
// Bilinmeyen ya da eksik değer: uygulama kodlarından biriyse "apps", değilse "tools" — böylece sunucuya
// eklenen yeni araçlar programı güncellemeden "Araçlar"da görünür. Katalog sırası korunur.
// Hem ana süreçte (require) hem pencerelerde (<script>) çalışır.
(function (root) {
  'use strict';

  const APP_CODES = ['sm', 'fm', 'sq', 'np', 'cv'];

  function groupOf(a) {
    if (a && a.group === 'apps') return 'apps';
    if (a && a.group === 'tools') return 'tools';
    if (a && a.group == null && APP_CODES.includes(a.app)) return 'apps'; // eski katalog (group alanı yok)
    return 'tools';
  }

  function splitCatalog(list) {
    const out = { apps: [], tools: [] };
    for (const a of list || []) out[groupOf(a)].push(a);
    return out;
  }

  const api = { APP_CODES, groupOf, splitCatalog };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MTGroups = api;
})(typeof self !== 'undefined' ? self : this);
