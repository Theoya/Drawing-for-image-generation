const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let mainWindow = null;
let cmdSeq = 0;
const pending = new Map(); // id -> { resolve }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Sketchpad',
    // Transparent + frameless. On Windows, transparent windows break
    // -webkit-app-region drag, so window dragging is done via JS (mousedown
    // on the top bar -> win:drag-move IPC); min/close/resize are custom
    // controls (see renderer). The CSS app-region rule stays as a fallback
    // for platforms where it works.
    frame: false,
    transparent: true,
    resizable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  startCommandServer();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ================= MCP / programmatic command server =================
   A localhost HTTP server so the MCP server (or any script) can drive the
   app like a human: set tools, draw strokes, screenshot, save, etc. */

function sendCommand(action, payload, timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve({ ok: false, error: 'no window open' });
      return;
    }
    const id = ++cmdSeq;
    const t = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: `command "${action}" timed out` });
    }, timeoutMs);
    pending.set(id, { resolve: (r) => { clearTimeout(t); resolve(r); } });
    mainWindow.webContents.send('mcp:command', { id, action, payload: payload || {} });
  });
}

function startCommandServer() {
  const port = parseInt(process.env.SKETCHPAD_PORT || '8391', 10);
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ ok: true, window: !!mainWindow }));
      return;
    }
    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let parsed;
        try { parsed = JSON.parse(body || '{}'); }
        catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'bad json' })); return; }
        const result = await sendCommand(parsed.action, parsed.payload);
        res.end(JSON.stringify(result));
      });
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`[sketchpad] command server on http://127.0.0.1:${port}`);
  });
}

// Renderer resolves a command by id.
ipcMain.handle('mcp:respond', (event, { id, result }) => {
  const p = pending.get(id);
  if (p) { pending.delete(id); p.resolve(result); }
  return true;
});

/* ================= window controls (frameless window) ================= */

ipcMain.on('win:minimize', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w) w.minimize();
});

ipcMain.on('win:close', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (w) w.close();
});

ipcMain.on('win:drag-move', (event, { x, y }) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w || !Number.isFinite(x) || !Number.isFinite(y)) return;
  w.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on('win:resize', (event, { width, height }) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w) return;
  const ww = Math.max(w.getMinimumSize()[0], Math.round(width));
  const wh = Math.max(w.getMinimumSize()[1], Math.round(height));
  w.setSize(ww, wh);
});

ipcMain.handle('win:get-bounds', (event) => {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w || w.isDestroyed()) return null;
  const [x, y] = w.getPosition();
  const [width, height] = w.getSize();
  return { x, y, width, height };
});

/* ================= dialogs ================= */

ipcMain.handle('save-image', async (event, payload) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { dataUrl, defaultName } = payload;
  const isJpg = /\.jpe?g$/i.test(defaultName);
  const ext = isJpg ? { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] } : { name: 'PNG Image', extensions: ['png'] };
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save drawing',
    defaultPath: path.join(app.getPath('pictures'), defaultName),
    filters: [ext, { name: 'All Files', extensions: ['*'] }]
  });
  if (canceled || !filePath) return { saved: false };
  await fs.promises.writeFile(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { saved: true, path: filePath };
});

// Headless save straight to a path (used by MCP, no dialog).
ipcMain.handle('save-image-path', async (event, { dataUrl, filePath }) => {
  if (!filePath) return { saved: false, error: 'filePath required' };
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { saved: true, path: filePath };
});

ipcMain.handle('open-image', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open image',
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (canceled || !filePaths.length) return null;
  const filePath = filePaths[0];
  const buf = await fs.promises.readFile(filePath);
  const mime =
    /\.jpe?g$/i.test(filePath) ? 'image/jpeg'
    : /\.webp$/i.test(filePath) ? 'image/webp'
    : /\.gif$/i.test(filePath) ? 'image/gif'
    : /\.bmp$/i.test(filePath) ? 'image/bmp'
    : 'image/png';
  return { name: path.basename(filePath), dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
});

// Headless load from a path (used by MCP, no dialog).
ipcMain.handle('open-image-path', async (event, { filePath }) => {
  if (!filePath) return null;
  const buf = await fs.promises.readFile(filePath);
  const mime =
    /\.jpe?g$/i.test(filePath) ? 'image/jpeg'
    : /\.webp$/i.test(filePath) ? 'image/webp'
    : /\.gif$/i.test(filePath) ? 'image/gif'
    : /\.bmp$/i.test(filePath) ? 'image/bmp'
    : 'image/png';
  return { name: path.basename(filePath), dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
});
