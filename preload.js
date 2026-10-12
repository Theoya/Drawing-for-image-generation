const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  saveImage: (payload) => ipcRenderer.invoke('save-image', payload),
  saveToPath: (payload) => ipcRenderer.invoke('save-image-path', payload),
  openImage: () => ipcRenderer.invoke('open-image'),
  openFromPath: (payload) => ipcRenderer.invoke('open-image-path', payload),

  // MCP / programmatic control
  onCommand: (callback) => ipcRenderer.on('mcp:command', (event, msg) => callback(msg)),
  respondCommand: (msg) => ipcRenderer.invoke('mcp:respond', msg),

  // Frameless window controls
  winMinimize: () => ipcRenderer.send('win:minimize'),
  winDragMove: (x, y) => ipcRenderer.send('win:drag-move', { x, y }),
  winClose: () => ipcRenderer.send('win:close'),
  winResize: (width, height) => ipcRenderer.send('win:resize', { width, height }),
  winGetBounds: () => ipcRenderer.invoke('win:get-bounds')
});
