'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  // arayüz dili (açılışta senkron alınır ki ilk çizim doğru dilde olsun)
  lang: ipcRenderer.sendSync('app:lang'),

  // ortak oturum (mastertool.download)
  accountState: () => ipcRenderer.invoke('account:state'),
  login: (email, password) => ipcRenderer.invoke('account:login', { email, password }),
  logout: () => ipcRenderer.invoke('account:logout'),
  openWeb: (page) => ipcRenderer.invoke('account:openWeb', page), // 'forgot' | 'register' | 'account'
  openPortal: () => ipcRenderer.invoke('app:openPortal'),

  // uygulamalar
  getState: () => ipcRenderer.invoke('mt:state'),
  refresh: () => ipcRenderer.invoke('mt:refresh'),
  openApp: (app) => ipcRenderer.invoke('mt:open', app),
  installApp: (app) => ipcRenderer.invoke('mt:install', app),
  cancelInstall: (app) => ipcRenderer.invoke('mt:cancel', app),
  openSite: (app) => ipcRenderer.invoke('mt:site', app),
  revealApp: (app) => ipcRenderer.invoke('mt:reveal', app),
  onState: on('mt:state'),
  onJob: on('mt:job'),     // { app, job: { phase, received, total } | null }
  onToast: on('mt:toast'), // { key, vars, type }

  // depolama (indirilenler)
  storageInfo: () => ipcRenderer.invoke('storage:info'),
  storageClear: () => ipcRenderer.invoke('storage:clear'),
  storageOpen: () => ipcRenderer.invoke('storage:open'),

  // ayarlar ve Hakkında
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  about: () => ipcRenderer.invoke('app:about'),
  checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  selfUpdate: () => ipcRenderer.invoke('app:selfUpdate'),
  openLicenses: () => ipcRenderer.invoke('app:openLicenses'),
  quit: () => ipcRenderer.invoke('app:quit'),
  onUpdateAvailable: on('app:update'),
  onUpdateProgress: on('app:updateProgress'),
});
