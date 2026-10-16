'use strict';

// Tepsi menüsü (sözleşme v1 §5): kurulu uygulamalar (simge + ad, katalog sırası) → ayırıcı → kurulu araçlar →
// ayırıcı → "Master Tool'u göster" → "Çıkış". Electron'dan bağımsız saf işlev; Menu.buildFromTemplate'e verilir.

const { splitCatalog } = require('./groups');

function buildTrayTemplate({ apps = [], t, iconFor = () => undefined, onOpen, onShow, onQuit }) {
  const installed = apps.filter((a) => a && a.installed && a.installed.installed);
  const item = (a) => {
    const it = { id: `app:${a.app}`, label: a.name, click: () => onOpen(a.app) };
    const icon = iconFor(a.app);
    if (icon) it.icon = icon;
    return it;
  };
  const { apps: mainApps, tools } = splitCatalog(installed);
  const items = mainApps.map(item);
  if (tools.length) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ id: 'tools', label: t('mt.tools'), enabled: false }, ...tools.map(item));
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
