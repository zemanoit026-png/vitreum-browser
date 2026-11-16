const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vitreumAPI', {
  minimizeWindow: () => ipcRenderer.send('window-action', 'minimize'),
  maximizeWindow: () => ipcRenderer.send('window-action', 'maximize'),
  closeWindow: () => ipcRenderer.send('window-action', 'close'),
  toggleAdBlock: (status) => ipcRenderer.send('toggle-adblock', status),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  openFolder: (filePath) => ipcRenderer.invoke('open-folder', filePath),
  
  performEditAction: (action, webContentsId, selectionText) => ipcRenderer.send('perform-edit-action', { action, webContentsId, selectionText }),
  copyLinkAddress: (linkURL) => ipcRenderer.send('copy-link-address', linkURL),
  inspectElement: (webContentsId, x, y) => ipcRenderer.send('inspect-element', { webContentsId, x, y }),
  downloadUrl: (url, webContentsId) => ipcRenderer.send('download-url', { url, webContentsId }),
  copyImage: (webContentsId, x, y) => ipcRenderer.send('copy-image', { webContentsId, x, y }),
  onVpnDropped: (cb) => ipcRenderer.on('vpn-dropped', () => cb()),
  googleSignedIn: () => ipcRenderer.invoke('google-signed-in'),
  clearSiteData: () => ipcRenderer.invoke('clear-site-data'),
  getOfflineHtml: () => ipcRenderer.invoke('get-offline-html'),
  getOfflineUrl: () => ipcRenderer.sendSync('get-offline-url'),
  setRegion: (region) => ipcRenderer.send('set-region', region),

  parseVpnSub: (url) => ipcRenderer.invoke('vpn-parse-sub', url),
  connectVpn: (server) => ipcRenderer.invoke('vpn-connect', server),
  disconnectVpn: () => ipcRenderer.invoke('vpn-disconnect'),

  onDownloadStarted: (cb) => ipcRenderer.on('download-started', (e, data) => cb(data)),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (e, data) => cb(data)),
  onConfirmExit: (cb) => ipcRenderer.on('confirm-exit', (e, n) => cb(n)),
  confirmExit: () => ipcRenderer.send('confirm-exit-yes'),
  setFlags: (f) => ipcRenderer.send('set-flags', f),
  openDownloads: () => ipcRenderer.invoke('open-downloads'),
  getAbout: () => ipcRenderer.invoke('get-about'),
  getGfxCompat: () => ipcRenderer.invoke('get-gfx-compat'),
  setGfxCompat: (on) => ipcRenderer.send('set-gfx-compat', on),
  getDefaultSub: () => ipcRenderer.invoke('get-default-sub'),
  savePage: (webContentsId, kind) => ipcRenderer.invoke('save-page', { webContentsId, kind }),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  onShortcut: (cb) => ipcRenderer.on('shortcut', (e, name) => cb(name)),
  onDownloadIcon: (cb) => ipcRenderer.on('download-icon', (e, data) => cb(data)),
  onDownloadCompleted: (cb) => ipcRenderer.on('download-completed', (e, data) => cb(data)),
  onOpenInNewTab: (cb) => ipcRenderer.on('open-in-new-tab', (e, url) => cb(url)),
  onShowContextMenu: (cb) => ipcRenderer.on('show-context-menu', (e, params) => cb(params)),
  onHideContextMenu: (cb) => ipcRenderer.on('hide-context-menu', () => cb())
});

window.addEventListener('win-minimize', () => ipcRenderer.send('window-action', 'minimize'));
window.addEventListener('win-maximize', () => ipcRenderer.send('window-action', 'maximize'));
window.addEventListener('win-close', () => ipcRenderer.send('window-action', 'close'));