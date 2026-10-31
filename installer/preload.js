'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const call = (ch, arg) => ipcRenderer.invoke(ch, arg);

contextBridge.exposeInMainWorld('setup', {
  init: () => call('init:get'),
  freeSpace: dir => call('dir:free', dir),
  pickDir: current => call('dir:pick', current),
  install: opts => call('install:run', opts),
  launch: exe => call('app:launch', exe),
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  quit: () => ipcRenderer.send('app:quit'),
  onProgress: cb => { ipcRenderer.on('install:progress', (_e, d) => cb(d)); },
});
