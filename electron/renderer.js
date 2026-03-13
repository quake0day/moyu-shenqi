// ---- HID 键码映射 ----
const CHAR_TO_HID = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { CHAR_TO_HID[c] = [0x04 + i, false]; });
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { CHAR_TO_HID[c] = [0x04 + i, true]; });
'1234567890'.split('').forEach((c, i) => { CHAR_TO_HID[c] = [0x1E + i, false]; });
Object.assign(CHAR_TO_HID, {
  ' ': [0x2C, false], '\n': [0x28, false], '\t': [0x2B, false],
  '-': [0x2D, false], '=': [0x2E, false], '[': [0x2F, false], ']': [0x30, false],
  '\\': [0x31, false], ';': [0x33, false], "'": [0x34, false],
  ',': [0x36, false], '.': [0x37, false], '/': [0x38, false],
  '!': [0x1E, true], '@': [0x1F, true], '#': [0x20, true], '$': [0x21, true],
  '%': [0x22, true], '^': [0x23, true], '&': [0x24, true], '*': [0x25, true],
  '(': [0x26, true], ')': [0x27, true], '_': [0x2D, true], '+': [0x2E, true],
  '{': [0x2F, true], '}': [0x30, true], '|': [0x31, true], ':': [0x33, true],
  '"': [0x34, true], '<': [0x36, true], '>': [0x37, true], '?': [0x38, true],
});
const HID_LEFT_SHIFT = 0xE1;

// ---- 状态 ----
let connected = false;
let running = false;
let activeTab = 'manual';

const SUBTOPICS = [
  'latest research findings', 'regulatory updates', 'clinical trial progress',
  'manufacturing process improvements', 'quality control measures',
  'pharmacovigilance reports', 'market analysis', 'competitive landscape',
  'patient safety data', 'formulation development', 'bioequivalence studies',
  'supply chain management', 'intellectual property strategy',
  'medical affairs activities', 'real-world evidence', 'pricing and reimbursement',
  'partnership opportunities', 'technology transfer', 'environmental compliance',
  'data integrity and IT systems', 'training and development programs',
  'risk management strategies', 'post-marketing surveillance',
  'biosimilar development', 'gene therapy advances',
];

// ---- 工具函数 ----
const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;
const numVal = (id) => parseFloat($(id).value);
const randRange = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(randRange(min, max + 1));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const box = $('logBox');
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  box.innerHTML += `<div>${time}  ${msg}</div>`;
  box.scrollTop = box.scrollHeight;
  // 限制日志行数
  while (box.children.length > 150) box.removeChild(box.firstChild);
}

// ---- Tab 切换 ----
document.querySelectorAll('.tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    $('tabManual').classList.toggle('hidden', activeTab !== 'manual');
    $('tabOllama').classList.toggle('hidden', activeTab !== 'ollama');
    $('tabDocx').classList.toggle('hidden', activeTab !== 'docx');
    $('tabPaste').classList.toggle('hidden', activeTab !== 'paste');
  };
});

// ---- Radio 按钮 ----
document.querySelectorAll('.radio-group').forEach(group => {
  group.querySelectorAll('.radio-btn').forEach(btn => {
    btn.onclick = () => {
      group.querySelectorAll('.radio-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    };
  });
});

// ---- 连接 ----
$('btnConnect').onclick = async () => {
  const result = await window.kmbox.connect(val('ip'), val('port'), val('uuid'));
  if (result.ok) {
    connected = true;
    $('connDot').classList.replace('off', 'on');
    $('connLabel').textContent = 'Connected';
    $('btnStart').disabled = false;
    log('<span style="color:#2ecc71">Connected</span>');
  } else {
    log(`<span style="color:#e74c3c">Connection failed: ${result.error}</span>`);
  }
};

// ---- Ollama ----
$('btnRefresh').onclick = async () => {
  const models = await window.ollama.listModels(val('ollamaUrl'));
  const select = $('ollamaModel');
  select.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    select.appendChild(opt);
  });
  $('modelStatus').textContent = models.length ? `${models.length} models` : 'No models found';
};
// 启动时刷新
setTimeout(() => $('btnRefresh').click(), 500);

// ---- Word Document ----
let docxFilePath = null;
let docxParsedText = '';      // markdown mode text
let docxParsedActions = null;  // rich mode actions

$('btnOpenDocx').onclick = async () => {
  const result = await window.docx.openFile();
  if (!result.ok) return;
  docxFilePath = result.path;
  $('docxFileName').textContent = result.name;
  await parseDocx();
};

async function parseDocx() {
  if (!docxFilePath) return;
  const mode = document.querySelector('#docxMode .radio-btn.active').dataset.v;
  log(`<span style="color:#3498db">[Word] Parsing (${mode} mode)...</span>`);

  const result = await window.docx.parse(docxFilePath, mode);
  if (!result.ok) {
    log(`<span style="color:#e74c3c">[Word] Error: ${result.error}</span>`);
    return;
  }

  if (mode === 'markdown') {
    docxParsedText = result.text;
    docxParsedActions = null;
    $('docxPreview').value = docxParsedText;
    $('docxStats').textContent = `${docxParsedText.length} chars (Markdown)`;
  } else {
    docxParsedActions = result.actions;
    docxParsedText = '';
    // Build preview from actions
    const preview = result.actions.map(a => a.type === 'text' ? a.value : `[${a.key}]`).join('');
    $('docxPreview').value = preview;
    const textLen = result.actions.filter(a => a.type === 'text').reduce((s, a) => s + a.value.length, 0);
    const fmtCount = result.actions.filter(a => a.type === 'format').length;
    $('docxStats').textContent = `${textLen} chars, ${fmtCount} format commands (Rich)`;
  }

  if (result.warnings && result.warnings.length) {
    result.warnings.forEach(w => log(`<span style="color:#f39c12">[Word] ${w.message}</span>`));
  }
  log(`<span style="color:#2ecc71">[Word] Parse complete</span>`);
}

// Re-parse when mode changes
document.querySelector('#docxMode').addEventListener('click', (e) => {
  const btn = e.target.closest('.radio-btn');
  if (btn && docxFilePath) setTimeout(parseDocx, 50);
});

// ---- Rich Paste ----
let pasteParsedText = '';
let pasteParsedActions = null;
let pasteParseTimer = null;

async function parsePasteContent() {
  const editor = $('richEditor');
  const html = editor.innerHTML;
  if (!html || html === '<br>') {
    pasteParsedText = '';
    pasteParsedActions = null;
    $('pastePreview').value = '';
    $('pasteStats').textContent = '';
    return;
  }

  const mode = document.querySelector('#pasteMode .radio-btn.active').dataset.v;
  log(`<span style="color:#3498db">[Paste] Parsing (${mode} mode)...</span>`);

  const result = await window.docx.parseHtml(html, mode);
  if (!result.ok) {
    log(`<span style="color:#e74c3c">[Paste] Error: ${result.error}</span>`);
    return;
  }

  if (mode === 'markdown') {
    pasteParsedText = result.text;
    pasteParsedActions = null;
    $('pastePreview').value = pasteParsedText;
    $('pasteStats').textContent = `${pasteParsedText.length} chars (Markdown)`;
  } else {
    pasteParsedActions = result.actions;
    pasteParsedText = '';
    const preview = result.actions.map(a => a.type === 'text' ? a.value : `[${a.key}]`).join('');
    $('pastePreview').value = preview;
    const textLen = result.actions.filter(a => a.type === 'text').reduce((s, a) => s + a.value.length, 0);
    const fmtCount = result.actions.filter(a => a.type === 'format').length;
    $('pasteStats').textContent = `${textLen} chars, ${fmtCount} format commands (Rich)`;
  }

  log(`<span style="color:#2ecc71">[Paste] Parse complete</span>`);
}

// Debounced parse on content change
function schedulePasteParse() {
  clearTimeout(pasteParseTimer);
  pasteParseTimer = setTimeout(parsePasteContent, 500);
}

$('richEditor').addEventListener('input', schedulePasteParse);
$('richEditor').addEventListener('paste', () => setTimeout(schedulePasteParse, 100));

// Re-parse when mode changes
document.querySelector('#pasteMode').addEventListener('click', (e) => {
  const btn = e.target.closest('.radio-btn');
  if (btn && $('richEditor').innerHTML && $('richEditor').innerHTML !== '<br>') {
    setTimeout(parsePasteContent, 50);
  }
});

// Clear button
$('btnPasteClear').onclick = () => {
  $('richEditor').innerHTML = '';
  pasteParsedText = '';
  pasteParsedActions = null;
  $('pastePreview').value = '';
  $('pasteStats').textContent = '';
  log('[Paste] Cleared');
};

// ---- Rich format typing (send keyboard shortcuts) ----
const HID_LEFT_CTRL = 0xE0;

async function sendCtrlKey(hidKeyCode) {
  // Release all first
  await window.kmbox.keyup(0);
  // Press Ctrl
  await window.kmbox.keydown(HID_LEFT_CTRL);
  await sleep(randRange(15, 30));
  // Press the key
  await window.kmbox.keydown(hidKeyCode);
  await sleep(randRange(30, 60));
  // Release
  await window.kmbox.keyup(0);
  await sleep(5);
  await window.kmbox.keyup(0);
  await window.kmbox.keyup(HID_LEFT_CTRL);
  await sleep(randRange(30, 80));
}

async function typeActions(actions) {
  let burst = 0;
  const burstLimit = randInt(numVal('burstMin'), numVal('burstMax'));
  let currentBurstLimit = burstLimit;
  let totalChars = actions.filter(a => a.type === 'text').reduce((s, a) => s + a.value.length, 0);
  let typed = 0;

  for (let ai = 0; ai < actions.length && running; ai++) {
    const action = actions[ai];

    if (action.type === 'format') {
      // Send format keyboard shortcut
      switch (action.key) {
        case 'bold_on':
        case 'bold_off':
          await sendCtrlKey(0x05); // Ctrl+B
          log('[Format] Bold toggle');
          break;
        case 'italic_on':
        case 'italic_off':
          await sendCtrlKey(0x0C); // Ctrl+I
          log('[Format] Italic toggle');
          break;
        case 'underline_on':
        case 'underline_off':
          await sendCtrlKey(0x18); // Ctrl+U
          log('[Format] Underline toggle');
          break;
        case 'heading_1': case 'heading_2': case 'heading_3':
        case 'heading_4': case 'heading_5': case 'heading_6':
          // Skip heading format in rich mode - just type as plain text
          break;

        // ---- Table handling ----
        // In Word/Google Docs: Tab moves between cells in an existing table
        // Strategy: insert table first (rows x cols), then Tab through cells
        case 'table_start':
          log(`[Format] Table ${action.rows}x${action.cols}`);
          // Insert table in Word: Alt+N → T → I (Insert Table dialog)
          // Or in Google Docs: Alt+I → T
          // For now: we just start typing, user should have cursor in a table
          // or we send Tab-separated text that can be converted to table later
          break;
        case 'table_next_cell':
          // Tab key moves to next cell in Word/Docs table
          await typeChar('\t');
          await sleep(randRange(100, 300));
          break;
        case 'table_next_row':
          // In a Word table, Tab from last cell creates/moves to next row
          // Outside table, just use Enter
          await typeChar('\t');
          await sleep(randRange(200, 500));
          break;
        case 'table_end':
          // Move out of table: press Enter twice or Down arrow
          await typeChar('\n');
          await sleep(randRange(200, 400));
          log('[Format] Table end');
          break;
      }
      await sleep(randRange(50, 150));
      continue;
    }

    // Text action - type char by char
    const text = action.value;
    for (let i = 0; i < text.length && running; i++) {
      await typeChar(text[i]);
      typed++;
      burst++;

      if (typed % 30 === 0) log(`[Keyboard] ${typed}/${totalChars} chars`);

      // Pauses
      const char = text[i];
      if (char === '\n') await sleep(randRange(500, 1500));
      else if ('.!?'.includes(char)) await sleep(randRange(300, 800));
      else if (',;:'.includes(char)) await sleep(randRange(200, 500));
      else await sleep(randRange(numVal('typeMin') * 1000, numVal('typeMax') * 1000));

      // Think pause
      if (burst >= currentBurstLimit) {
        const pause = randRange(numVal('thinkMin'), numVal('thinkMax'));
        log(`[Think] ${pause.toFixed(1)}s pause`);
        await sleepInterruptible(pause * 1000);
        burst = 0;
        currentBurstLimit = randInt(numVal('burstMin'), numVal('burstMax'));
      }
    }
  }
}

// ---- 模拟打字 ----
async function typeChar(char) {
  const entry = CHAR_TO_HID[char];
  if (!entry) return;
  const [code, shift] = entry;

  // 先确保所有键释放（防止上次 keyup 丢包导致卡键）
  await window.kmbox.keyup(0);

  if (shift) {
    await window.kmbox.keydown(HID_LEFT_SHIFT);
    await sleep(randRange(10, 20));
  }
  await window.kmbox.keydown(code);
  await sleep(randRange(30, 80));

  // 发送两次 keyup 降低 UDP 丢包概率
  await window.kmbox.keyup(0);
  await sleep(5);
  await window.kmbox.keyup(0);

  if (shift) {
    await window.kmbox.keyup(HID_LEFT_SHIFT);
  }
}

async function mouseMove() {
  const range = numVal('mouseRange');
  const dx = randInt(-range, range);
  const dy = randInt(-range, range);
  const ms = randInt(200, 800);
  const mode = document.querySelector('#mouseMode .radio-btn.active').dataset.v;

  if (mode === 'beizer') {
    await window.kmbox.moveBeizer(dx, dy, ms,
      randInt(-50, 50), randInt(-50, 50), randInt(-50, 50), randInt(-50, 50));
  } else if (mode === 'auto') {
    await window.kmbox.moveAuto(dx, dy, ms);
  } else {
    await window.kmbox.move(dx, dy);
  }
  log(`[Mouse] (${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy}) ${ms}ms`);
}

// ---- 主循环 ----
async function sleepInterruptible(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end && running) await sleep(100);
}

async function typeText(text) {
  let burst = 0;
  const burstLimit = randInt(numVal('burstMin'), numVal('burstMax'));
  let currentBurstLimit = burstLimit;

  for (let i = 0; i < text.length && running; i++) {
    const char = text[i];
    await typeChar(char);
    burst++;

    if (burst % 30 === 0) log(`[Keyboard] ${i + 1}/${text.length} chars`);

    // 停顿
    if (char === '\n') await sleep(randRange(500, 1500));
    else if ('.!?'.includes(char)) await sleep(randRange(300, 800));
    else if (',;:'.includes(char)) await sleep(randRange(200, 500));
    else await sleep(randRange(numVal('typeMin') * 1000, numVal('typeMax') * 1000));

    // 思考停顿
    if (burst >= currentBurstLimit) {
      const pause = randRange(numVal('thinkMin'), numVal('thinkMax'));
      log(`[Think] ${pause.toFixed(1)}s pause`);
      await sleepInterruptible(pause * 1000);
      burst = 0;
      currentBurstLimit = randInt(numVal('burstMin'), numVal('burstMax'));
    }
  }
}

async function runLoop() {
  let lastMouseTime = Date.now();
  let nextMouseDelay = randRange(numVal('mouseMinInt'), numVal('mouseMaxInt')) * 1000;
  let aiRound = 0;

  while (running) {
    // 鼠标
    if ($('mouseEnabled').checked && Date.now() - lastMouseTime >= nextMouseDelay) {
      try { await mouseMove(); } catch (e) { log(`[Mouse Error] ${e.message}`); }
      lastMouseTime = Date.now();
      nextMouseDelay = randRange(numVal('mouseMinInt'), numVal('mouseMaxInt')) * 1000;
    }

    // 键盘
    if ($('keyEnabled').checked) {
      let text = '';
      let useActions = false;

      if (activeTab === 'manual') {
        text = val('manualText');
        if (!text) { await sleep(500); continue; }
      } else if (activeTab === 'docx') {
        // Word Document mode
        const docxModeVal = document.querySelector('#docxMode .radio-btn.active').dataset.v;
        if (docxModeVal === 'markdown') {
          text = docxParsedText;
          if (!text) {
            log('<span style="color:#f39c12">[Word] No document loaded</span>');
            await sleep(1000); continue;
          }
        } else {
          if (!docxParsedActions || !docxParsedActions.length) {
            log('<span style="color:#f39c12">[Word] No document loaded</span>');
            await sleep(1000); continue;
          }
          useActions = true;
        }
      } else if (activeTab === 'paste') {
        // Rich Paste mode
        const pasteModeVal = document.querySelector('#pasteMode .radio-btn.active').dataset.v;
        if (pasteModeVal === 'markdown') {
          text = pasteParsedText;
          if (!text) {
            log('<span style="color:#f39c12">[Paste] No content pasted</span>');
            await sleep(1000); continue;
          }
        } else {
          if (!pasteParsedActions || !pasteParsedActions.length) {
            log('<span style="color:#f39c12">[Paste] No content pasted</span>');
            await sleep(1000); continue;
          }
          useActions = true;
        }
      } else {
        // Ollama AI 生成
        aiRound++;
        const subtopic = SUBTOPICS[(aiRound - 1) % SUBTOPICS.length];
        const prompt = `Topic: ${val('aiTopic')}\nSubtopic: ${subtopic}\nParagraph ${aiRound}. Continue writing naturally.`;
        log(`<span style="color:#3498db">[AI] Generating #${aiRound}: ${subtopic}...</span>`);
        $('runStatus').textContent = `AI generating #${aiRound}...`;

        try {
          text = await window.ollama.generate(
            val('ollamaUrl'), $('ollamaModel').value, prompt, val('aiPrompt')
          );
          text = text.trim() + '\n\n';
          log(`<span style="color:#2ecc71">[AI] #${aiRound} ready (${text.length} chars)</span>`);
        } catch (e) {
          log(`<span style="color:#e74c3c">[AI Error] ${e.message}</span>`);
          await sleepInterruptible(5000);
          continue;
        }
      }

      if (!running) break;

      if (useActions) {
        const currentActions = activeTab === 'paste' ? pasteParsedActions : docxParsedActions;
        const totalChars = currentActions.filter(a => a.type === 'text').reduce((s, a) => s + a.value.length, 0);
        $('runStatus').textContent = `Typing... (${totalChars} chars, rich format)`;
        log(`[Start] Typing ${totalChars} chars with formatting`);
        await typeActions(currentActions);
      } else {
        $('runStatus').textContent = `Typing... (${text.length} chars)`;
        log(`[Start] Typing ${text.length} chars`);
        await typeText(text);
      }

      if (!running) break;

      if (activeTab === 'manual' && !$('loopText').checked) {
        log('[Done] Text complete, mouse only');
        while (running) {
          if ($('mouseEnabled').checked && Date.now() - lastMouseTime >= nextMouseDelay) {
            try { await mouseMove(); } catch(e) {}
            lastMouseTime = Date.now();
            nextMouseDelay = randRange(numVal('mouseMinInt'), numVal('mouseMaxInt')) * 1000;
          }
          await sleep(100);
        }
        break;
      }

      // 段落间隔
      const gap = randRange(numVal('loopMin'), numVal('loopMax'));
      log(`[Gap] ${gap.toFixed(0)}s before next`);
      $('runStatus').textContent = `Waiting ${gap.toFixed(0)}s...`;
      const gapEnd = Date.now() + gap * 1000;
      while (Date.now() < gapEnd && running) {
        if ($('mouseEnabled').checked && Date.now() - lastMouseTime >= nextMouseDelay) {
          try { await mouseMove(); } catch(e) {}
          lastMouseTime = Date.now();
          nextMouseDelay = randRange(numVal('mouseMinInt'), numVal('mouseMaxInt')) * 1000;
        }
        await sleep(100);
      }
    } else {
      await sleep(100);
    }
  }

  $('runStatus').textContent = 'Stopped';
  $('btnStart').disabled = false;
  $('btnStop').disabled = true;
}

// ---- 开始 / 停止 ----
$('btnStart').onclick = () => {
  if (!connected) return;
  running = true;
  $('btnStart').disabled = true;
  $('btnStop').disabled = false;
  $('runStatus').textContent = 'Running...';
  log('<span style="color:#2ecc71">Started</span>');
  runLoop();
};

$('btnStop').onclick = () => {
  running = false;
  log('<span style="color:#f39c12">Stopping...</span>');
};
