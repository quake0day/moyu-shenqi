# 摸鱼神器

KMBox Net Work Simulator - 通过 KMBox Net 硬件设备模拟真人键鼠操作。

## 功能

- **自然鼠标移动** - 贝塞尔曲线 / 人类模拟 / 直线，可调间隔和范围
- **模拟人类打字** - 随机速度、思考停顿、标点停顿，完全模拟真人节奏
- **Ollama AI 无限生成** - 接入本地 Ollama 大模型，自动生成专业内容，24 小时不重复
- **KMBox Net 硬件级输入** - 操作系统和监控软件无法区分是否为真人操作

## 两个版本

### Electron (推荐，跨平台)

现代 UI，支持 Windows / macOS / Linux，无需 Python 环境。

```bash
cd electron
npm install
npm start          # 开发运行
npm run build:win  # 打包 Windows exe
npm run build:mac  # 打包 macOS dmg (需在 Mac 上执行)
```

### Python (轻量)

tkinter GUI，需要 Python 3.x 环境。

```bash
cd python
python fake_work_gui.py
```

Windows 上如果有官方 `kmNet.pyd`，会自动使用；否则使用纯 Python 协议实现 `kmnet_protocol.py`（跨平台）。

## KMBox Net 协议

`kmnet_protocol.py` / `kmbox-protocol.js` 是通过逆向官方 SDK 实现的纯协议库，不依赖任何官方二进制文件，可在任意平台运行。

### 协议结构 (UDP, Little-Endian)

```
包头 (16 bytes):
  [0-3]   mac      - 设备 UUID (u32)
  [4-7]   rand     - 随机值或参数 (u32)
  [8-11]  indexpts - 递增序号 (u32)
  [12-15] cmd      - 命令码 (u32, 硬编码常量)

命令码:
  0xAF3C2828 - connect        0xAEDE7345 - mouse_move
  0xAEDE7346 - mouse_automove 0xA238455A - mouse_beizer
  0x9823AE8D - mouse_left     0x238D8212 - mouse_right
  0x97A3AE8D - mouse_middle   0xFFEEAD38 - mouse_wheel
  0x123C2C2F - keyboard_all
```

## 使用方法

1. 将 KMBox Net 连接到电脑，确保和控制端在同一网段
2. 在软件中输入设备的 IP、端口、UUID
3. 点击连接，设置鼠标/键盘参数
4. 选择文本来源（手动输入或 AI 生成）
5. 点击开始

## License

MIT
