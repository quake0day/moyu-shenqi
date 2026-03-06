"""
KMBox Net 模拟工作 GUI
功能: 连接管理、自然鼠标移动、模拟人类打字、Ollama AI 无限生成文本
"""

import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import threading
import queue
import time
import random
import json
import urllib.request

# 优先使用官方 pyd，不存在则用纯 Python 实现（跨平台）
try:
    import kmNet
except ImportError:
    import kmnet_protocol as kmNet

# ASCII 字符到 HID 扫描码的映射
CHAR_TO_HID = {}
for i, c in enumerate("abcdefghijklmnopqrstuvwxyz"):
    CHAR_TO_HID[c] = (0x04 + i, False)
for i, c in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
    CHAR_TO_HID[c] = (0x04 + i, True)
for i, c in enumerate("1234567890"):
    CHAR_TO_HID[c] = (0x1E + i, False)
CHAR_TO_HID[' '] = (0x2C, False)
CHAR_TO_HID['\n'] = (0x28, False)
CHAR_TO_HID['\t'] = (0x2B, False)
CHAR_TO_HID['-'] = (0x2D, False)
CHAR_TO_HID['='] = (0x2E, False)
CHAR_TO_HID['['] = (0x2F, False)
CHAR_TO_HID[']'] = (0x30, False)
CHAR_TO_HID['\\'] = (0x31, False)
CHAR_TO_HID[';'] = (0x33, False)
CHAR_TO_HID["'"] = (0x34, False)
CHAR_TO_HID[','] = (0x36, False)
CHAR_TO_HID['.'] = (0x37, False)
CHAR_TO_HID['/'] = (0x38, False)
CHAR_TO_HID['!'] = (0x1E, True)
CHAR_TO_HID['@'] = (0x1F, True)
CHAR_TO_HID['#'] = (0x20, True)
CHAR_TO_HID['$'] = (0x21, True)
CHAR_TO_HID['%'] = (0x22, True)
CHAR_TO_HID['^'] = (0x23, True)
CHAR_TO_HID['&'] = (0x24, True)
CHAR_TO_HID['*'] = (0x25, True)
CHAR_TO_HID['('] = (0x26, True)
CHAR_TO_HID[')'] = (0x27, True)
CHAR_TO_HID['_'] = (0x2D, True)
CHAR_TO_HID['+'] = (0x2E, True)
CHAR_TO_HID['{'] = (0x2F, True)
CHAR_TO_HID['}'] = (0x30, True)
CHAR_TO_HID['|'] = (0x31, True)
CHAR_TO_HID[':'] = (0x33, True)
CHAR_TO_HID['"'] = (0x34, True)
CHAR_TO_HID['<'] = (0x36, True)
CHAR_TO_HID['>'] = (0x37, True)
CHAR_TO_HID['?'] = (0x38, True)

HID_LEFT_SHIFT = 0xE1


class OllamaClient:
    """Ollama API 客户端"""

    def __init__(self, base_url="http://localhost:11434"):
        self.base_url = base_url

    def list_models(self):
        """获取可用模型列表"""
        try:
            req = urllib.request.Request(f"{self.base_url}/api/tags")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                return [m["name"] for m in data.get("models", [])]
        except Exception:
            return []

    def generate(self, model, prompt, system=None):
        """生成文本（非流式）"""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.8,
                "top_p": 0.9,
                "num_predict": 1024,
            }
        }
        if system:
            payload["system"] = system

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            return result.get("response", "")


class FakeWorkApp:
    def __init__(self, root):
        self.root = root
        self.root.title("KMBox Net - Work Simulator")
        self.root.geometry("620x880")
        self.root.resizable(False, False)

        self.connected = False
        self.running = False
        self.worker_thread = None
        self.ollama = OllamaClient()

        # AI 生成的文本队列，worker 线程从这里取文本
        self.text_queue = queue.Queue()
        self.ai_generating = False

        self._build_ui()
        # 启动时刷新模型列表
        threading.Thread(target=self._refresh_models, daemon=True).start()

    def _build_ui(self):
        # 使用 canvas + scrollbar 实现整体滚动
        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill="both", expand=True)

        # ---- 连接设置 ----
        conn_frame = ttk.LabelFrame(main_frame, text="连接设置", padding=10)
        conn_frame.pack(fill="x", padx=10, pady=(10, 5))

        row1 = ttk.Frame(conn_frame)
        row1.pack(fill="x")
        ttk.Label(row1, text="IP:").pack(side="left")
        self.ip_var = tk.StringVar(value="192.168.2.188")
        ttk.Entry(row1, textvariable=self.ip_var, width=16).pack(side="left", padx=(5, 15))
        ttk.Label(row1, text="端口:").pack(side="left")
        self.port_var = tk.StringVar(value="9418")
        ttk.Entry(row1, textvariable=self.port_var, width=8).pack(side="left", padx=(5, 15))
        ttk.Label(row1, text="UUID:").pack(side="left")
        self.uuid_var = tk.StringVar(value="EEDA0C3D")
        ttk.Entry(row1, textvariable=self.uuid_var, width=12).pack(side="left", padx=(5, 0))

        row1b = ttk.Frame(conn_frame)
        row1b.pack(fill="x", pady=(8, 0))
        self.conn_btn = ttk.Button(row1b, text="连接", command=self._connect)
        self.conn_btn.pack(side="left")
        self.conn_status = ttk.Label(row1b, text="未连接", foreground="red")
        self.conn_status.pack(side="left", padx=10)

        # ---- 鼠标设置 ----
        mouse_frame = ttk.LabelFrame(main_frame, text="鼠标设置", padding=10)
        mouse_frame.pack(fill="x", padx=10, pady=5)

        self.mouse_enabled = tk.BooleanVar(value=True)
        ttk.Checkbutton(mouse_frame, text="启用鼠标移动", variable=self.mouse_enabled).pack(anchor="w")

        m_row1 = ttk.Frame(mouse_frame)
        m_row1.pack(fill="x", pady=(5, 0))
        ttk.Label(m_row1, text="移动间隔 (秒):").pack(side="left")
        self.mouse_min_interval = tk.DoubleVar(value=3.0)
        ttk.Entry(m_row1, textvariable=self.mouse_min_interval, width=6).pack(side="left", padx=(5, 5))
        ttk.Label(m_row1, text="~").pack(side="left")
        self.mouse_max_interval = tk.DoubleVar(value=10.0)
        ttk.Entry(m_row1, textvariable=self.mouse_max_interval, width=6).pack(side="left", padx=(5, 15))
        ttk.Label(m_row1, text="移动范围 (px):").pack(side="left")
        self.mouse_range = tk.IntVar(value=120)
        ttk.Entry(m_row1, textvariable=self.mouse_range, width=6).pack(side="left", padx=(5, 0))

        m_row2 = ttk.Frame(mouse_frame)
        m_row2.pack(fill="x", pady=(5, 0))
        ttk.Label(m_row2, text="移动方式:").pack(side="left")
        self.mouse_mode = tk.StringVar(value="beizer")
        ttk.Radiobutton(m_row2, text="贝塞尔曲线", variable=self.mouse_mode, value="beizer").pack(side="left", padx=5)
        ttk.Radiobutton(m_row2, text="人类模拟", variable=self.mouse_mode, value="auto").pack(side="left", padx=5)
        ttk.Radiobutton(m_row2, text="直线", variable=self.mouse_mode, value="direct").pack(side="left", padx=5)

        # ---- 键盘设置 ----
        key_frame = ttk.LabelFrame(main_frame, text="键盘设置", padding=10)
        key_frame.pack(fill="x", padx=10, pady=5)

        self.key_enabled = tk.BooleanVar(value=True)
        ttk.Checkbutton(key_frame, text="启用键盘输入", variable=self.key_enabled).pack(anchor="w")

        k_row1 = ttk.Frame(key_frame)
        k_row1.pack(fill="x", pady=(5, 0))
        ttk.Label(k_row1, text="打字速度 (秒/字):").pack(side="left")
        self.type_min = tk.DoubleVar(value=0.05)
        ttk.Entry(k_row1, textvariable=self.type_min, width=6).pack(side="left", padx=(5, 5))
        ttk.Label(k_row1, text="~").pack(side="left")
        self.type_max = tk.DoubleVar(value=0.25)
        ttk.Entry(k_row1, textvariable=self.type_max, width=6).pack(side="left", padx=(5, 15))

        ttk.Label(k_row1, text="思考停顿:").pack(side="left")
        self.think_min = tk.DoubleVar(value=1.0)
        ttk.Entry(k_row1, textvariable=self.think_min, width=5).pack(side="left", padx=(5, 5))
        ttk.Label(k_row1, text="~").pack(side="left")
        self.think_max = tk.DoubleVar(value=3.0)
        ttk.Entry(k_row1, textvariable=self.think_max, width=5).pack(side="left", padx=(5, 0))

        k_row2 = ttk.Frame(key_frame)
        k_row2.pack(fill="x", pady=(5, 0))
        ttk.Label(k_row2, text="连续打字数:").pack(side="left")
        self.burst_min = tk.IntVar(value=20)
        ttk.Entry(k_row2, textvariable=self.burst_min, width=5).pack(side="left", padx=(5, 5))
        ttk.Label(k_row2, text="~").pack(side="left")
        self.burst_max = tk.IntVar(value=60)
        ttk.Entry(k_row2, textvariable=self.burst_max, width=5).pack(side="left", padx=(5, 15))

        ttk.Label(k_row2, text="段落间隔:").pack(side="left")
        self.loop_min = tk.DoubleVar(value=8.0)
        ttk.Entry(k_row2, textvariable=self.loop_min, width=5).pack(side="left", padx=(5, 5))
        ttk.Label(k_row2, text="~").pack(side="left")
        self.loop_max = tk.DoubleVar(value=20.0)
        ttk.Entry(k_row2, textvariable=self.loop_max, width=5).pack(side="left", padx=(5, 0))

        # ---- 文本来源 ----
        src_frame = ttk.LabelFrame(main_frame, text="文本来源", padding=10)
        src_frame.pack(fill="x", padx=10, pady=5)

        self.text_source = tk.StringVar(value="manual")
        src_row = ttk.Frame(src_frame)
        src_row.pack(fill="x")
        ttk.Radiobutton(src_row, text="手动输入（循环）", variable=self.text_source, value="manual",
                        command=self._toggle_source).pack(side="left", padx=(0, 15))
        ttk.Radiobutton(src_row, text="Ollama AI 无限生成", variable=self.text_source, value="ollama",
                        command=self._toggle_source).pack(side="left")

        # ---- Ollama 设置 ----
        self.ollama_frame = ttk.LabelFrame(main_frame, text="Ollama AI 设置", padding=10)
        self.ollama_frame.pack(fill="x", padx=10, pady=5)

        o_row1 = ttk.Frame(self.ollama_frame)
        o_row1.pack(fill="x")
        ttk.Label(o_row1, text="Ollama 地址:").pack(side="left")
        self.ollama_url = tk.StringVar(value="http://localhost:11434")
        ttk.Entry(o_row1, textvariable=self.ollama_url, width=25).pack(side="left", padx=(5, 10))
        self.refresh_btn = ttk.Button(o_row1, text="刷新模型", command=lambda: threading.Thread(
            target=self._refresh_models, daemon=True).start())
        self.refresh_btn.pack(side="left")

        o_row2 = ttk.Frame(self.ollama_frame)
        o_row2.pack(fill="x", pady=(5, 0))
        ttk.Label(o_row2, text="模型:").pack(side="left")
        self.model_var = tk.StringVar()
        self.model_combo = ttk.Combobox(o_row2, textvariable=self.model_var, width=30, state="readonly")
        self.model_combo.pack(side="left", padx=(5, 0))

        o_row3 = ttk.Frame(self.ollama_frame)
        o_row3.pack(fill="x", pady=(5, 0))
        ttk.Label(o_row3, text="主题:").pack(side="left")
        self.ai_topic = tk.StringVar(value="pharmaceutical research, drug development, clinical trials")
        ttk.Entry(o_row3, textvariable=self.ai_topic, width=50).pack(side="left", padx=(5, 0))

        o_row4 = ttk.Frame(self.ollama_frame)
        o_row4.pack(fill="x", pady=(5, 0))
        ttk.Label(o_row4, text="AI 提示词:").pack(anchor="w")
        self.ai_prompt_box = scrolledtext.ScrolledText(o_row4, height=3, wrap="word")
        self.ai_prompt_box.pack(fill="x", pady=(3, 0))
        self.ai_prompt_box.insert("1.0",
            "You are a pharmaceutical professional writing work emails and reports. "
            "Write a detailed paragraph about the given topic. "
            "Use professional language. Only output the text content, no titles or formatting. "
            "Each response should be a different subtopic. Keep it between 200-400 words."
        )

        self.ai_status = ttk.Label(self.ollama_frame, text="", foreground="gray")
        self.ai_status.pack(anchor="w", pady=(5, 0))

        # ---- 手动输入文本 ----
        self.text_frame = ttk.LabelFrame(main_frame, text="手动输入文本内容", padding=10)
        self.text_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self.text_box = scrolledtext.ScrolledText(self.text_frame, height=6, wrap="word")
        self.text_box.pack(fill="both", expand=True)
        self.text_box.insert("1.0",
            "Dear Team,\n\nI have reviewed the latest project requirements and would like to share "
            "some thoughts on the implementation plan. Based on our discussion yesterday, I think we "
            "should focus on the following areas:\n\n"
            "1. Database optimization - We need to improve query performance.\n"
            "2. API refactoring - Better error handling and validation.\n"
            "3. Unit test coverage - At least 80% on critical modules.\n\n"
            "Please let me know if you have any questions.\n\nBest regards"
        )

        # ---- 控制按钮 ----
        ctrl_frame = ttk.Frame(main_frame, padding=10)
        ctrl_frame.pack(fill="x", padx=10)

        self.start_btn = ttk.Button(ctrl_frame, text="开始运行", command=self._start, state="disabled")
        self.start_btn.pack(side="left", padx=(0, 10))
        self.stop_btn = ttk.Button(ctrl_frame, text="停止", command=self._stop, state="disabled")
        self.stop_btn.pack(side="left")
        self.status_label = ttk.Label(ctrl_frame, text="就绪", foreground="gray")
        self.status_label.pack(side="right")

        # ---- 日志 ----
        log_frame = ttk.LabelFrame(main_frame, text="日志", padding=5)
        log_frame.pack(fill="x", padx=10, pady=(0, 10))

        self.log_box = scrolledtext.ScrolledText(log_frame, height=4, wrap="word", state="disabled")
        self.log_box.pack(fill="x")

        self._toggle_source()

    def _toggle_source(self):
        """切换文本来源显示"""
        if self.text_source.get() == "ollama":
            for child in self.ollama_frame.winfo_children():
                child.pack_configure()
            self.ollama_frame.pack(fill="x", padx=10, pady=5)
            self.text_frame.pack_forget()
        else:
            self.text_frame.pack(fill="both", expand=True, padx=10, pady=5)

    def _refresh_models(self):
        """刷新 Ollama 模型列表"""
        self.ollama.base_url = self.ollama_url.get().strip()
        models = self.ollama.list_models()
        def update():
            self.model_combo["values"] = models
            if models:
                self.model_combo.current(0)
                self.ai_status.config(text=f"找到 {len(models)} 个模型", foreground="green")
            else:
                self.ai_status.config(text="未找到模型，请确认 Ollama 已启动", foreground="red")
        self.root.after(0, update)

    def _log(self, msg):
        def _update():
            self.log_box.config(state="normal")
            self.log_box.insert("end", f"{time.strftime('%H:%M:%S')}  {msg}\n")
            self.log_box.see("end")
            # 限制日志行数，防止内存增长
            lines = int(self.log_box.index("end-1c").split(".")[0])
            if lines > 200:
                self.log_box.delete("1.0", f"{lines - 200}.0")
            self.log_box.config(state="disabled")
        self.root.after(0, _update)

    def _set_status(self, text, color="gray"):
        self.root.after(0, lambda: self.status_label.config(text=text, foreground=color))

    def _connect(self):
        ip = self.ip_var.get().strip()
        port = self.port_var.get().strip()
        uuid = self.uuid_var.get().strip()
        if not all([ip, port, uuid]):
            messagebox.showwarning("提示", "请填写完整的连接信息")
            return
        try:
            kmNet.init(ip, port, uuid)
            self.connected = True
            self.conn_status.config(text="已连接", foreground="green")
            self.conn_btn.config(text="重新连接")
            self.start_btn.config(state="normal")
            self._log(f"已连接到 {ip}:{port}")
        except Exception as e:
            messagebox.showerror("连接失败", str(e))
            self._log(f"连接失败: {e}")

    def _start(self):
        if not self.connected:
            messagebox.showwarning("提示", "请先连接设备")
            return

        self.running = True
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self._set_status("运行中...", "green")
        self._log("开始模拟")

        # 清空队列
        while not self.text_queue.empty():
            self.text_queue.get()

        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()

    def _stop(self):
        self.running = False
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self._set_status("已停止", "orange")
        self._log("已停止")

    def _type_char(self, char):
        if char not in CHAR_TO_HID:
            return False
        hid_code, need_shift = CHAR_TO_HID[char]
        # 先释放所有键（防止上次 keyup 丢包导致卡键）
        kmNet.keyup(0)
        if need_shift:
            kmNet.keydown(HID_LEFT_SHIFT)
            time.sleep(random.uniform(0.01, 0.02))
        kmNet.keydown(hid_code)
        time.sleep(random.uniform(0.03, 0.08))
        # 发送两次 keyup 降低 UDP 丢包概率
        kmNet.keyup(0)
        time.sleep(0.005)
        kmNet.keyup(0)
        if need_shift:
            kmNet.keyup(HID_LEFT_SHIFT)
        return True

    def _mouse_move(self):
        r = self.mouse_range.get()
        dx = random.randint(-r, r)
        dy = random.randint(-r, r)
        ms = random.randint(200, 800)
        mode = self.mouse_mode.get()
        if mode == "beizer":
            cx1 = random.randint(-50, 50)
            cy1 = random.randint(-50, 50)
            cx2 = random.randint(-50, 50)
            cy2 = random.randint(-50, 50)
            kmNet.move_beizer(dx, dy, ms, cx1, cy1, cx2, cy2)
        elif mode == "auto":
            kmNet.move_auto(dx, dy, ms)
        else:
            kmNet.move(dx, dy)
            ms = 0
        self._log(f"[鼠标] ({dx:+d}, {dy:+d}) {ms}ms")

    def _ai_generate_text(self):
        """在后台持续生成文本，放入队列"""
        self.ollama.base_url = self.ollama_url.get().strip()
        model = self.model_var.get()
        topic = self.ai_topic.get().strip()
        system_prompt = self.ai_prompt_box.get("1.0", "end-1c").strip()

        round_num = 0
        subtopics = [
            "latest research findings", "regulatory updates", "clinical trial progress",
            "manufacturing process improvements", "quality control measures",
            "pharmacovigilance reports", "market analysis", "competitive landscape",
            "patient safety data", "formulation development", "bioequivalence studies",
            "supply chain management", "intellectual property strategy",
            "medical affairs activities", "real-world evidence", "pricing and reimbursement",
            "partnership opportunities", "technology transfer", "environmental compliance",
            "data integrity and IT systems", "training and development programs",
            "risk management strategies", "post-marketing surveillance",
            "biosimilar development", "gene therapy advances",
        ]

        while self.running:
            # 当队列中文本不足时生成新的
            if self.text_queue.qsize() < 2:
                round_num += 1
                subtopic = subtopics[(round_num - 1) % len(subtopics)]
                prompt = (
                    f"Topic: {topic}\n"
                    f"Subtopic focus: {subtopic}\n"
                    f"This is paragraph {round_num} of a continuous professional document. "
                    f"Continue writing naturally. Do not repeat previous content."
                )

                self._log(f"[AI] 正在生成第 {round_num} 段: {subtopic}...")
                self.root.after(0, lambda: self.ai_status.config(
                    text=f"生成中... 第 {round_num} 段", foreground="blue"))

                try:
                    text = self.ollama.generate(model, prompt, system=system_prompt)
                    # 清理文本：去掉开头结尾空白，确保结尾有换行
                    text = text.strip()
                    if text:
                        text += "\n\n"
                        self.text_queue.put(text)
                        self._log(f"[AI] 第 {round_num} 段已生成 ({len(text)} 字符)")
                        self.root.after(0, lambda: self.ai_status.config(
                            text=f"已生成 {round_num} 段", foreground="green"))
                except Exception as e:
                    self._log(f"[AI 错误] {e}")
                    self.root.after(0, lambda: self.ai_status.config(
                        text=f"生成失败: {e}", foreground="red"))
                    # 出错后等一会再重试
                    for _ in range(50):
                        if not self.running:
                            return
                        time.sleep(0.1)
            else:
                time.sleep(1)

    def _sleep_interruptible(self, duration):
        """可中断的 sleep"""
        end = time.time() + duration
        while time.time() < end and self.running:
            time.sleep(0.1)

    def _do_mouse_check(self, last_mouse_time, next_mouse_delay):
        """检查并执行鼠标移动，返回更新后的时间和延迟"""
        if self.mouse_enabled.get() and time.time() - last_mouse_time >= next_mouse_delay:
            try:
                self._mouse_move()
            except Exception as e:
                self._log(f"[鼠标错误] {e}")
            return time.time(), random.uniform(self.mouse_min_interval.get(), self.mouse_max_interval.get())
        return last_mouse_time, next_mouse_delay

    def _type_text(self, text, last_mouse_time, next_mouse_delay):
        """输入一段文本，返回更新后的鼠标时间和延迟"""
        chars_in_burst = 0
        burst_limit = random.randint(self.burst_min.get(), self.burst_max.get())

        for i, char in enumerate(text):
            if not self.running:
                break

            # 穿插鼠标移动
            last_mouse_time, next_mouse_delay = self._do_mouse_check(last_mouse_time, next_mouse_delay)

            try:
                self._type_char(char)
            except Exception as e:
                self._log(f"[键盘错误] {e}")

            chars_in_burst += 1

            if chars_in_burst % 30 == 0:
                self._log(f"[键盘] 已输入 {i + 1}/{len(text)}")

            # 根据字符类型停顿
            if char == '\n':
                time.sleep(random.uniform(0.5, 1.5))
            elif char in '.!?':
                time.sleep(random.uniform(0.3, 0.8))
            elif char in ',;:':
                time.sleep(random.uniform(0.2, 0.5))
            else:
                time.sleep(random.uniform(self.type_min.get(), self.type_max.get()))

            # 思考停顿
            if chars_in_burst >= burst_limit:
                pause = random.uniform(self.think_min.get(), self.think_max.get())
                self._log(f"[思考] 停顿 {pause:.1f}s")
                self._sleep_interruptible(pause)
                chars_in_burst = 0
                burst_limit = random.randint(self.burst_min.get(), self.burst_max.get())

        return last_mouse_time, next_mouse_delay

    def _worker(self):
        last_mouse_time = time.time()
        next_mouse_delay = random.uniform(self.mouse_min_interval.get(), self.mouse_max_interval.get())

        use_ollama = self.text_source.get() == "ollama"

        # 如果使用 Ollama，启动 AI 生成线程
        if use_ollama:
            ai_thread = threading.Thread(target=self._ai_generate_text, daemon=True)
            ai_thread.start()
            self._log("[AI] 已启动 AI 文本生成线程")

        while self.running:
            # 鼠标移动
            last_mouse_time, next_mouse_delay = self._do_mouse_check(last_mouse_time, next_mouse_delay)

            if not self.key_enabled.get():
                time.sleep(0.1)
                continue

            if use_ollama:
                # 从队列获取 AI 生成的文本
                try:
                    text = self.text_queue.get(timeout=1)
                except queue.Empty:
                    continue

                self._log(f"[开始] 输入 AI 生成文本 ({len(text)} 字符)")
                last_mouse_time, next_mouse_delay = self._type_text(
                    text, last_mouse_time, next_mouse_delay)

                # 段落间停顿
                if self.running:
                    gap = random.uniform(self.loop_min.get(), self.loop_max.get())
                    self._log(f"[段落间隔] {gap:.0f}s")
                    end = time.time() + gap
                    while time.time() < end and self.running:
                        last_mouse_time, next_mouse_delay = self._do_mouse_check(
                            last_mouse_time, next_mouse_delay)
                        time.sleep(0.1)
            else:
                # 手动文本模式
                text = self.text_box.get("1.0", "end-1c")
                if not text:
                    time.sleep(0.5)
                    continue

                self._log(f"[开始] 输入手动文本 ({len(text)} 字符)")
                last_mouse_time, next_mouse_delay = self._type_text(
                    text, last_mouse_time, next_mouse_delay)

                if self.running:
                    self._log("[完成] 文本输入完毕")
                    gap = random.uniform(self.loop_min.get(), self.loop_max.get())
                    self._log(f"[等待] {gap:.0f}s 后重新开始")
                    end = time.time() + gap
                    while time.time() < end and self.running:
                        last_mouse_time, next_mouse_delay = self._do_mouse_check(
                            last_mouse_time, next_mouse_delay)
                        time.sleep(0.1)

        self.root.after(0, lambda: self.start_btn.config(state="normal"))
        self.root.after(0, lambda: self.stop_btn.config(state="disabled"))
        self._set_status("已停止", "orange")


def main():
    root = tk.Tk()
    app = FakeWorkApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
