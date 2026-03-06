const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { KMBoxNet } = require('./kmbox-protocol');

const kmbox = new KMBoxNet();
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 700,
    height: 900,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { app.quit(); });

// ---- IPC handlers ----

ipcMain.handle('kmbox:connect', async (_, ip, port, uuid) => {
  try {
    await kmbox.init(ip, port, uuid);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('kmbox:move', async (_, x, y) => { await kmbox.move(x, y); });
ipcMain.handle('kmbox:moveAuto', async (_, x, y, ms) => { await kmbox.moveAuto(x, y, ms); });
ipcMain.handle('kmbox:moveBeizer', async (_, x, y, ms, x1, y1, x2, y2) => {
  await kmbox.moveBeizer(x, y, ms, x1, y1, x2, y2);
});
ipcMain.handle('kmbox:keydown', async (_, code) => { await kmbox.keydown(code); });
ipcMain.handle('kmbox:keyup', async (_, code) => { await kmbox.keyup(code); });

// Ollama
ipcMain.handle('ollama:listModels', async (_, baseUrl) => {
  return new Promise((resolve) => {
    const url = new URL('/api/tags', baseUrl);
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          const models = JSON.parse(data).models.map(m => m.name);
          resolve(models);
        } catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
});

ipcMain.handle('ollama:generate', async (_, baseUrl, model, prompt, system) => {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/generate', baseUrl);
    const payload = JSON.stringify({
      model, prompt, stream: false, system,
      options: { temperature: 0.8, top_p: 0.9, num_predict: 1024 },
    });
    const req = http.request(url, {
      method: 'POST', timeout: 120000,
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).response || ''); }
        catch { reject(new Error('解析失败')); }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
    req.write(payload);
    req.end();
  });
});
