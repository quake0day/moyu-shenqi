"""
KMBox Net 纯 Python 跨平台协议实现
基于官方 C++ 源码逆向

协议结构 (Little-Endian, UDP):
  cmd_head_t (16 bytes):
    [0-3]   mac      - 设备 MAC/UUID (u32 LE)
    [4-7]   rand     - 随机值或参数 (u32 LE)
    [8-11]  indexpts - 递增序号 (u32 LE)
    [12-15] cmd      - 命令码 (u32 LE, 硬编码常量)

  payload:
    鼠标: soft_mouse_t = button(i32) + x(i32) + y(i32) + wheel(i32) + point[10](i32*10)
    键盘: soft_keyboard_t = ctrl(i8) + resvel(i8) + button[10](i8*10)

命令码 (硬编码):
  cmd_connect       = 0xaf3c2828
  cmd_mouse_move    = 0xaede7345
  cmd_mouse_left    = 0x9823AE8D
  cmd_mouse_middle  = 0x97a3AE8D
  cmd_mouse_right   = 0x238d8212
  cmd_mouse_wheel   = 0xffeead38
  cmd_mouse_automove= 0xaede7346
  cmd_keyboard_all  = 0x123c2c2f
  cmd_bazerMove     = 0xa238455a
  cmd_reboot        = 0xaa8855aa
  cmd_monitor       = 0x27388020
"""

import socket
import struct
import random
import time


# 命令码常量
CMD_CONNECT       = 0xAF3C2828
CMD_MOUSE_MOVE    = 0xAEDE7345
CMD_MOUSE_LEFT    = 0x9823AE8D
CMD_MOUSE_MIDDLE  = 0x97A3AE8D
CMD_MOUSE_RIGHT   = 0x238D8212
CMD_MOUSE_WHEEL   = 0xFFEEAD38
CMD_MOUSE_AUTOMOVE= 0xAEDE7346
CMD_KEYBOARD_ALL  = 0x123C2C2F
CMD_BAZER_MOVE    = 0xA238455A
CMD_REBOOT        = 0xAA8855AA
CMD_MONITOR       = 0x27388020


class KMNet:
    """KMBox Net 纯 Python 跨平台客户端"""

    def __init__(self):
        self.sock = None
        self.addr = None
        self.mac = 0
        self.tx_index = 0

    def _make_header(self, cmd, rand_val=None):
        """构造 16 字节包头"""
        if rand_val is None:
            rand_val = random.randint(0, 0xFFFF)
        self.tx_index += 1
        return struct.pack("<IIII", self.mac, rand_val, self.tx_index, cmd)

    def _send_mouse(self, cmd, button=0, x=0, y=0, wheel=0, points=None):
        """发送鼠标命令 (72 bytes = 16 header + 56 payload)"""
        rand_val = None
        if cmd == CMD_MOUSE_AUTOMOVE:
            # move_auto 的 rand 字段存放 ms 参数
            rand_val = points[0] if points else 0
        elif cmd == CMD_BAZER_MOVE:
            rand_val = points[0] if points else 0

        header = self._make_header(cmd, rand_val)
        # soft_mouse_t: button(4) + x(4) + y(4) + wheel(4) + point[10](40)
        payload = struct.pack("<iiii", button, x, y, wheel)
        if points and len(points) > 1:
            for p in points[1:]:
                payload += struct.pack("<i", p)
        # 补齐到 56 字节
        payload += b"\x00" * (56 - len(payload))
        self.sock.sendto(header + payload, self.addr)
        try:
            self.sock.recvfrom(128)
        except socket.timeout:
            pass

    def _send_keyboard(self, ctrl, key):
        """发送键盘命令 (28 bytes = 16 header + 12 payload)"""
        header = self._make_header(CMD_KEYBOARD_ALL)
        # soft_keyboard_t: ctrl(1) + resvel(1) + button[10]
        payload = struct.pack("<bb", ctrl, 0)
        keys = [0] * 10
        keys[0] = key
        payload += bytes(keys)
        self.sock.sendto(header + payload, self.addr)
        try:
            self.sock.recvfrom(128)
        except socket.timeout:
            pass

    def init(self, ip, port, mac_str):
        """初始化连接 - 兼容官方 SDK 接口"""
        self.mac = int(mac_str, 16)
        self.addr = (ip, int(port))
        self.tx_index = 0

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.settimeout(2)

        # 发送连接命令
        header = struct.pack("<IIII", self.mac, int(port), 0, CMD_CONNECT)
        self.sock.sendto(header, self.addr)
        try:
            resp, _ = self.sock.recvfrom(128)
            if len(resp) >= 16:
                return 0  # success
        except socket.timeout:
            pass
        return -1

    def move(self, x, y):
        """鼠标相对移动"""
        self._send_mouse(CMD_MOUSE_MOVE, x=x, y=y)

    def move_auto(self, x, y, ms):
        """鼠标自动移动（模拟人类轨迹）"""
        self._send_mouse(CMD_MOUSE_AUTOMOVE, x=x, y=y, points=[ms])

    def move_beizer(self, x, y, ms, x1, y1, x2, y2):
        """鼠标贝塞尔曲线移动"""
        self._send_mouse(CMD_BAZER_MOVE, x=x, y=y, points=[ms, x1, y1, x2, y2])

    def left(self, state):
        """左键"""
        self._send_mouse(CMD_MOUSE_LEFT, button=state)

    def right(self, state):
        """右键"""
        self._send_mouse(CMD_MOUSE_RIGHT, button=state)

    def middle(self, state):
        """中键"""
        self._send_mouse(CMD_MOUSE_MIDDLE, button=state)

    def wheel(self, value):
        """滚轮"""
        self._send_mouse(CMD_MOUSE_WHEEL, wheel=value)

    def mouse(self, button, x, y, wheel):
        """鼠标复合操作"""
        self._send_mouse(CMD_MOUSE_MOVE, button=button, x=x, y=y, wheel=wheel)

    def keydown(self, hid_code):
        """键盘按下"""
        self._send_keyboard(0, hid_code)

    def keyup(self, hid_code):
        """键盘释放"""
        self._send_keyboard(0, 0)

    def close(self):
        if self.sock:
            self.sock.close()


# 模块级接口 - 兼容官方 kmNet SDK 的调用方式
_instance = KMNet()

def init(ip, port, mac):
    return _instance.init(ip, port, mac)

def move(x, y):
    _instance.move(x, y)

def move_auto(x, y, ms):
    _instance.move_auto(x, y, ms)

def move_beizer(x, y, ms, x1, y1, x2, y2):
    _instance.move_beizer(x, y, ms, x1, y1, x2, y2)

def left(state):
    _instance.left(state)

def right(state):
    _instance.right(state)

def middle(state):
    _instance.middle(state)

def wheel(value):
    _instance.wheel(value)

def mouse(button, x, y, wheel_val):
    _instance.mouse(button, x, y, wheel_val)

def keydown(hid_code):
    _instance.keydown(hid_code)

def keyup(hid_code):
    _instance.keyup(hid_code)
