'use strict';

// Tepsi menüsü (sözleşme v1 §5): kurulu uygulamalar (simge + ad, katalog sırası) → ayırıcı →
// "Master Tool'u göster" → "Çıkış". Electron'dan bağımsız saf işlev; Menu.buildFromTemplate'e verilir.

const ORDER = ['sm', 'fm', 'sq', 'np', 'cv'];

function buildTrayTemplate({ apps = [], t, iconFor = () => undefined, onOpen, onShow, onQuit }) {
  const installed = apps
    .filter((a) => a && a.installed && a.installed.installed)
    .sort((a, b) => (ORDER.indexOf(a.app) + 1 || 99) - (ORDER.indexOf(b.app) + 1 || 99));
  const items = installed.map((a) => {
    const item = { id: `app:${a.app}`, label: a.name, click: () => onOpen(a.app) };
    const icon = iconFor(a.app);
    if (icon) item.icon = icon;
    return item;
  });
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

module.exports = { buildTrayTemplate, createClickRouter, ORDER };
