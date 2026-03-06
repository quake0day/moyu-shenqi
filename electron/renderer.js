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

      if (activeTab === 'manual') {
        text = val('manualText');
        if (!text) { await sleep(500); continue; }
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
      $('runStatus').textContent = `Typing... (${text.length} chars)`;
      log(`[Start] Typing ${text.length} chars`);
      await typeText(text);

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
