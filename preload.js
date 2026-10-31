'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, arg) => ipcRenderer.invoke(channel, arg);
const on = (channel, cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  getState: () => call('state:get'),
  remoteVersions: () => call('versions:remote'),
  installedVersions: () => call('versions:installed'),
  downloadVersion: id => call('versions:download', id),
  deleteVersion: id => call('versions:delete', id),
  loaderVersions: loader => call('loaders:versions', loader),
  installLoader: args => call('loaders:install', args),
  addOffline: name => call('profiles:addOffline', name),
  addMicrosoft: () => call('profiles:addMicrosoft'),
  removeProfile: id => call('profiles:remove', id),
  selectProfile: id => call('profiles:select', id),
  selectVersion: id => call('version:select', id),
  setSettings: s => call('settings:set', s),
  checkJava: () => call('java:check'),
  pickJava: () => call('java:pick'),
  play: args => call('game:play', args),
  stop: () => call('game:stop'),
  openFiles: id => call('files:open', id),
  openVersionFolder: id => call('files:openVersion', id),
  servers: { list: () => call('servers:list'), add: o => call('servers:add', o), remove: id => call('servers:remove', id), ping: id => call('servers:ping', id) },
  skins: { current: id => call('skins:current', id), avatar: id => call('skins:avatar', id), lookup: n => call('skins:lookup', n), pick: () => call('skins:pick'), apply: o => call('skins:apply', o), save: o => call('skins:save', o) },
  mods: { addJar: id => call('mods:addJar', id), list: id => call('mods:list', id), toggle: o => call('mods:toggle', o), remove: o => call('mods:remove', o), folder: id => call('mods:folder', id), search: o => call('mods:search', o), install: o => call('mods:install', o) },
  shots: { list: () => call('shots:list'), thumb: p => call('shots:thumb', p), full: p => call('shots:full', p), reveal: p => call('shots:reveal', p), remove: p => call('shots:delete', p), folder: () => call('shots:folder') },
  onStats: cb => on('stats:update', cb),
  checkUpdate: () => call('update:check'),
  installUpdate: () => call('update:install'),
  onUpdateProgress: cb => on('update:progress', cb),
  uninstallInfo: () => call('uninstall:info'),
  uninstall: opts => call('uninstall:run', opts),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: cb => on('win:state', cb),
  },
  onProgress: cb => on('download:progress', cb),
  onLog: cb => on('game:log', cb),
  onGameState: cb => on('game:state', cb),
});
