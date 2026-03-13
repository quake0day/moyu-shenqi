const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const mammoth = require('mammoth');
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

// ---- Word Document ----
ipcMain.handle('docx:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Word Documents', extensions: ['docx'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return { ok: false };
  return { ok: true, path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});

ipcMain.handle('docx:parse', async (_, filePath, mode) => {
  try {
    const buffer = fs.readFileSync(filePath);
    if (mode === 'markdown') {
      // Convert to HTML then to Markdown-like text
      const result = await mammoth.convertToHtml({ buffer });
      const markdown = htmlToMarkdown(result.value);
      return { ok: true, text: markdown, warnings: result.messages };
    } else {
      // Rich mode: return structured HTML for format-aware typing
      const result = await mammoth.convertToHtml({ buffer });
      const actions = htmlToActions(result.value);
      return { ok: true, actions, warnings: result.messages };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Strip HTML tags and decode entities from a string
function stripTags(s) {
  s = s.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  s = s.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  s = s.replace(/<br\s*\/?>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.trim();
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

// Parse an HTML <table> block into { hasHeader, rows: [[cell, ...], ...] }
function parseHtmlTable(tableHtml) {
  const rows = [];
  let hasHeader = false;
  const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];

  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellRegex = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = cellRegex.exec(rowHtml)) !== null) {
      if (m[1].toLowerCase() === 'th') hasHeader = true;
      cells.push(stripTags(m[2]));
    }
    if (cells.length) rows.push(cells);
  }

  return { hasHeader, rows };
}

// Convert parsed table to Markdown table string
function tableToMarkdown(table) {
  if (!table.rows.length) return '';

  // Normalize column count (some rows might have fewer cells)
  const colCount = Math.max(...table.rows.map(r => r.length));
  const normalized = table.rows.map(r => {
    while (r.length < colCount) r.push('');
    return r;
  });

  // Calculate column widths for alignment
  const widths = [];
  for (let c = 0; c < colCount; c++) {
    widths[c] = Math.max(3, ...normalized.map(r => r[c].length));
  }

  const lines = [];
  // First row (header or first data row)
  lines.push('| ' + normalized[0].map((cell, c) => cell.padEnd(widths[c])).join(' | ') + ' |');
  // Separator row
  lines.push('| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |');
  // Remaining rows
  for (let r = 1; r < normalized.length; r++) {
    lines.push('| ' + normalized[r].map((cell, c) => cell.padEnd(widths[c])).join(' | ') + ' |');
  }

  return lines.join('\n');
}

// Simple HTML → Markdown converter for mammoth's clean output
function htmlToMarkdown(html) {
  let md = html;

  // Step 1: Convert tables FIRST (before stripping tags)
  md = md.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match) => {
    const table = parseHtmlTable(match);
    return '\n\n' + tableToMarkdown(table) + '\n\n';
  });

  // Headings
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  // Bold & italic
  md = md.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<em>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<u>(.*?)<\/u>/gi, '$1');
  // Lists - handle ordered lists with numbers
  let olCounter = 0;
  md = md.replace(/<ol>/gi, () => { olCounter = 0; return '\n'; });
  md = md.replace(/<\/ol>/gi, '\n');
  md = md.replace(/<ul>/gi, '\n');
  md = md.replace(/<\/ul>/gi, '\n');
  md = md.replace(/<li>(.*?)<\/li>/gi, (_, content) => {
    // Check if we're inside an ol (crude heuristic: if olCounter was reset recently)
    // Since regex is sequential, we track via olCounter
    olCounter++;
    return `- ${content}\n`;
  });
  // Paragraphs & breaks
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  // Strip remaining tags
  md = md.replace(/<[^>]+>/g, '');
  // Decode entities
  md = decodeEntities(md);
  // Clean up excessive newlines
  md = md.replace(/\n{3,}/g, '\n\n');
  return md.trim();
}

// Convert a parsed table into rich-mode actions
// In Word/Google Docs: Tab moves to next cell, Enter creates new row
// Strategy: type first cell, Tab, second cell, Tab, ..., Enter for new row
function tableToActions(tableHtml) {
  const table = parseHtmlTable(tableHtml);
  const actions = [];

  // Signal table start - renderer can insert table via shortcut if needed
  actions.push({ type: 'format', key: 'table_start', rows: table.rows.length, cols: table.rows[0] ? table.rows[0].length : 0 });

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c]) actions.push({ type: 'text', value: row[c] });
      // Tab to next cell (except after last cell in row)
      if (c < row.length - 1) {
        actions.push({ type: 'format', key: 'table_next_cell' });
      }
    }
    // Tab after last cell moves to next row's first cell in Word/Docs table
    if (r < table.rows.length - 1) {
      actions.push({ type: 'format', key: 'table_next_row' });
    }
  }

  actions.push({ type: 'format', key: 'table_end' });
  return actions;
}

// Parse HTML into typing actions: [{type:'text', value:'...'}, {type:'format', key:'bold_on'}, ...]
function htmlToActions(html) {
  const actions = [];

  // Step 1: Extract tables and replace with placeholders
  const tablePlaceholders = [];
  const htmlNoTables = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match) => {
    const idx = tablePlaceholders.length;
    tablePlaceholders.push(match);
    return `%%TABLE_${idx}%%`;
  });

  // Step 2: Parse the rest with state machine
  let i = 0;
  let textBuf = '';

  function flush() {
    if (textBuf) { actions.push({ type: 'text', value: textBuf }); textBuf = ''; }
  }

  while (i < htmlNoTables.length) {
    // Check for table placeholder
    const placeholderMatch = htmlNoTables.substring(i).match(/^%%TABLE_(\d+)%%/);
    if (placeholderMatch) {
      flush();
      const tableIdx = parseInt(placeholderMatch[1]);
      const tableActions = tableToActions(tablePlaceholders[tableIdx]);
      actions.push(...tableActions);
      i += placeholderMatch[0].length;
      continue;
    }

    if (htmlNoTables[i] === '<') {
      const tagEnd = htmlNoTables.indexOf('>', i);
      if (tagEnd === -1) { textBuf += htmlNoTables[i]; i++; continue; }
      const tag = htmlNoTables.substring(i, tagEnd + 1);
      i = tagEnd + 1;

      // Headings
      if (/^<h([1-6])>/i.test(tag)) {
        flush();
        actions.push({ type: 'format', key: 'heading_' + RegExp.$1 });
      } else if (/^<\/h[1-6]>/i.test(tag)) {
        flush();
        actions.push({ type: 'text', value: '\n\n' });
      }
      // Bold
      else if (/^<strong>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'bold_on' }); }
      else if (/^<\/strong>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'bold_off' }); }
      // Italic
      else if (/^<em>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'italic_on' }); }
      else if (/^<\/em>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'italic_off' }); }
      // Underline
      else if (/^<u>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'underline_on' }); }
      else if (/^<\/u>/i.test(tag)) { flush(); actions.push({ type: 'format', key: 'underline_off' }); }
      // List items
      else if (/^<li>/i.test(tag)) { flush(); }
      else if (/^<\/li>/i.test(tag)) { flush(); actions.push({ type: 'text', value: '\n' }); }
      // Paragraph
      else if (/^<p[^>]*>/i.test(tag)) { flush(); }
      else if (/^<\/p>/i.test(tag)) { flush(); actions.push({ type: 'text', value: '\n\n' }); }
      // BR
      else if (/^<br/i.test(tag)) { flush(); actions.push({ type: 'text', value: '\n' }); }
      // Skip other tags silently
    } else {
      // Decode common entities inline
      if (htmlNoTables[i] === '&') {
        const semi = htmlNoTables.indexOf(';', i);
        if (semi !== -1 && semi - i < 10) {
          const ent = htmlNoTables.substring(i, semi + 1);
          textBuf += decodeEntities(ent);
          i = semi + 1;
          continue;
        }
      }
      textBuf += htmlNoTables[i];
      i++;
    }
  }
  flush();
  return actions;
}

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
