/**
 * KMBox Net UDP 协议实现 (纯 Node.js, 跨平台)
 * 基于官方 C++ 源码逆向
 */

const dgram = require('dgram');

// 命令码常量 (硬编码, 所有设备通用)
const CMD = {
  CONNECT:       0xAF3C2828,
  MOUSE_MOVE:    0xAEDE7345,
  MOUSE_LEFT:    0x9823AE8D,
  MOUSE_MIDDLE:  0x97A3AE8D,
  MOUSE_RIGHT:   0x238D8212,
  MOUSE_WHEEL:   0xFFEEAD38,
  MOUSE_AUTOMOVE:0xAEDE7346,
  KEYBOARD_ALL:  0x123C2C2F,
  BAZER_MOVE:    0xA238455A,
  REBOOT:        0xAA8855AA,
  MONITOR:       0x27388020,
};

class KMBoxNet {
  constructor() {
    this.sock = null;
    this.ip = '';
    this.port = 0;
    this.mac = 0;
    this.txIndex = 0;
  }

  _makeHeader(cmd, randVal) {
    if (randVal === undefined) randVal = Math.floor(Math.random() * 0xFFFF);
    this.txIndex++;
    const buf = Buffer.alloc(16);
    buf.writeUInt32LE(this.mac, 0);
    buf.writeUInt32LE(randVal, 4);
    buf.writeUInt32LE(this.txIndex, 8);
    buf.writeUInt32LE(cmd, 12);
    return buf;
  }

  _sendMousePacket(cmd, { button = 0, x = 0, y = 0, wheel = 0, points = [] } = {}) {
    return new Promise((resolve) => {
      let randVal = undefined;
      if (cmd === CMD.MOUSE_AUTOMOVE && points.length > 0) randVal = points[0];
      if (cmd === CMD.BAZER_MOVE && points.length > 0) randVal = points[0];

      const header = this._makeHeader(cmd, randVal);
      const payload = Buffer.alloc(56, 0);
      payload.writeInt32LE(button, 0);
      payload.writeInt32LE(x, 4);
      payload.writeInt32LE(y, 8);
      payload.writeInt32LE(wheel, 12);
      // 写入 points (用于贝塞尔等)
      const startOffset = cmd === CMD.BAZER_MOVE ? 1 : 0;
      for (let i = startOffset; i < points.length; i++) {
        const off = 16 + (i - startOffset) * 4;
        if (off + 4 <= 56) payload.writeInt32LE(points[i], off);
      }

      const packet = Buffer.concat([header, payload]);
      this.sock.send(packet, this.port, this.ip, () => resolve());
    });
  }

  _sendKeyboardPacket(ctrl, key) {
    return new Promise((resolve) => {
      const header = this._makeHeader(CMD.KEYBOARD_ALL);
      const payload = Buffer.alloc(12, 0);
      payload.writeInt8(ctrl, 0);
      payload.writeInt8(0, 1);
      payload.writeUInt8(key, 2);

      const packet = Buffer.concat([header, payload]);
      this.sock.send(packet, this.port, this.ip, () => resolve());
    });
  }

  init(ip, port, macStr) {
    return new Promise((resolve, reject) => {
      this.ip = ip;
      this.port = parseInt(port);
      this.mac = parseInt(macStr, 16);
      this.txIndex = 0;

      if (this.sock) {
        try { this.sock.close(); } catch(e) {}
      }
      this.sock = dgram.createSocket('udp4');

      const header = Buffer.alloc(16);
      header.writeUInt32LE(this.mac, 0);
      header.writeUInt32LE(this.port, 4);
      header.writeUInt32LE(0, 8);
      header.writeUInt32LE(CMD.CONNECT, 12);

      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 3000);

      this.sock.once('message', (msg) => {
        clearTimeout(timeout);
        if (msg.length >= 16) {
          resolve();
        } else {
          reject(new Error('无效响应'));
        }
      });

      this.sock.send(header, this.port, this.ip);
    });
  }

  async move(x, y) {
    await this._sendMousePacket(CMD.MOUSE_MOVE, { x, y });
  }

  async moveAuto(x, y, ms) {
    await this._sendMousePacket(CMD.MOUSE_AUTOMOVE, { x, y, points: [ms] });
  }

  async moveBeizer(x, y, ms, x1, y1, x2, y2) {
    await this._sendMousePacket(CMD.BAZER_MOVE, { x, y, points: [ms, x1, y1, x2, y2] });
  }

  async leftClick(state) {
    await this._sendMousePacket(CMD.MOUSE_LEFT, { button: state });
  }

  async rightClick(state) {
    await this._sendMousePacket(CMD.MOUSE_RIGHT, { button: state });
  }

  async middleClick(state) {
    await this._sendMousePacket(CMD.MOUSE_MIDDLE, { button: state });
  }

  async wheel(value) {
    await this._sendMousePacket(CMD.MOUSE_WHEEL, { wheel: value });
  }

  async keydown(hidCode) {
    await this._sendKeyboardPacket(0, hidCode);
  }

  async keyup(hidCode) {
    await this._sendKeyboardPacket(0, 0);
  }

  close() {
    if (this.sock) {
      try { this.sock.close(); } catch(e) {}
      this.sock = null;
    }
  }
}

module.exports = { KMBoxNet, CMD };
