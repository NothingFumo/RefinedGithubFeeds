#!/usr/bin/env python3
"""生成扩展图标：圆角方块 + 漏斗符号，PNG 16/32/48/128 四档。"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICON_DIR = ROOT / "icons"

BG = (36, 41, 47)      # GitHub 深灰
FG = (88, 166, 255)    # 蓝
R = 0.18               # 圆角比例


def clamp(v):
    return max(0, min(255, int(round(v))))


def signed_distance(x, y, size):
    """到圆角矩形边缘的有符号距离（内部为负）。标准 iq 式圆角盒公式。"""
    r = R * size
    half = size / 2 - 1
    cx, cy = x - size / 2, y - size / 2
    qx, qy = abs(cx) - (half - r), abs(cy) - (half - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    corner = (ax * ax + ay * ay) ** 0.5
    return min(max(qx, qy), 0.0) + corner - r

def in_funnel(x, y, size):
    """漏斗形（上宽下窄梯形+颈）判定。"""
    u = x / size
    v = y / size
    # 梯形部分: v ∈ [0.28, 0.55], 半宽从 0.26 收窄到 0.10
    if 0.28 <= v <= 0.55:
        half_w = 0.26 - (v - 0.28) * (0.16 / 0.27)
        return abs(u - 0.5) <= half_w
    # 颈部: v ∈ [0.55, 0.78], 宽 0.10
    if 0.55 < v <= 0.78:
        return abs(u - 0.5) <= 0.05
    return False


def render(size):
    rows = []
    scale = 4
    for py in range(size):
        row = bytearray([0])  # filter byte
        for px in range(size):
            # 4x 超采样抗锯齿；覆盖率归一化到 [0,1]
            cov_bg = cov_fg = 0.0
            for sy in range(scale):
                for sx in range(scale):
                    x = px + (sx + 0.5) / scale
                    y = py + (sy + 0.5) / scale
                    d = signed_distance(x, y, size)
                    alpha = min(1.0, max(0.0, -d * size * 0.5 + 0.5))
                    cov_bg += alpha
                    if in_funnel(x, y, size):
                        cov_fg += alpha
            n = scale * scale
            a = cov_bg / n
            f = a > 0 and cov_fg / n or 0.0
            r_ = BG[0] * (1 - f) + FG[0] * f
            g_ = BG[1] * (1 - f) + FG[1] * f
            b_ = BG[2] * (1 - f) + FG[2] * f
            row += bytes([clamp(r_), clamp(g_), clamp(b_), clamp(a * 255)])
        rows.append(bytes(row))
    return b"".join(rows)


def chunk(tag, data):
    c = tag + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)


def write_png(size, raw):
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    (ICON_DIR / f"icon{size}.png").write_bytes(png)


def main():
    ICON_DIR.mkdir(exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(s, render(s))
        print(f"icons/icon{s}.png")


if __name__ == "__main__":
    main()
