'use strict';

// Tepsi menüsü (sözleşme v1 §5): kurulu uygulamalar (simge + ad, katalog sırası) → ayırıcı → kurulu araçlar →
// ayırıcı → oyunlar (web) → ayırıcı → "Master Tool'u göster" → "Çıkış". Electron'dan bağımsız saf işlev; Menu.buildFromTemplate'e verilir.

const { splitCatalog, isWeb } = require('./groups');

function buildTrayTemplate({ apps = [], t, iconFor = () => undefined, onOpen, onShow, onQuit }) {
  // Kurulabilenler yalnız kuruluysa listelenir; web kayıtları (Oyunlar) her zaman açılabilir
  const installed = apps.filter((a) => a && (isWeb(a) || (a.installed && a.installed.installed)));
  const item = (a) => {
    const it = { id: `app:${a.app}`, label: a.name, click: () => onOpen(a.app) };
    const icon = iconFor(a.app);
    if (icon) it.icon = icon;
    return it;
  };
  const { apps: mainApps, tools, games } = splitCatalog(installed);
  const items = mainApps.map(item);
  for (const [id, list] of [['tools', tools], ['games', games]]) {
    if (!list.length) continue;
    if (items.length) items.push({ type: 'separator' });
    items.push({ id, label: t(`mt.${id}`), enabled: false }, ...list.map(item));
  }
  if (!items.length) items.push({ id: 'none', label: t('tray.none'), enabled: false });
  return [
    ...items,
    { type: 'separator' },
    { id: 'show', label: t('tray.show'), click: onShow },
    { id: 'quit', label: t('tray.quit'), click: onQuit },
  ];
}

// Windows'ta çift tıktan önce bir de "click" gelir. Tek tık menüyü biraz geciktirerek açar;
// bu arada çift tık gelirse menü açılmaz, pencere gösterilir.
function createClickRouter({ onSingle, onDouble, delay = 280, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  return {
    click() {
      if (timer) return;
      timer = setTimer(() => { timer = null; onSingle(); }, delay);
    },
    doubleClick() {
      if (timer) { clearTimer(timer); timer = null; }
      onDouble();
    },
  };
}

module.exports = { buildTrayTemplate, createClickRouter };
