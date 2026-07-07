"""4x4 变换矩阵工具（行主序 16 元素 float 列表）。"""
from __future__ import annotations
from typing import List
import math


def identity() -> List[float]:
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def multiply(a: List[float], b: List[float]) -> List[float]:
    """返回 a × b（父世界矩阵 × 子本地矩阵），行主序 16 元素。"""
    result = [0.0] * 16
    for i in range(4):
        for j in range(4):
            s = 0.0
            for k in range(4):
                s += a[i * 4 + k] * b[k * 4 + j]
            result[i * 4 + j] = s
    return result


def normalize_translation_mm_to_m(matrix: List[float]) -> List[float]:
    """把平移分量从毫米转米（/1000），旋转部分保持不变。"""
    out = list(matrix)
    out[3] = matrix[3] / 1000.0
    out[7] = matrix[7] / 1000.0
    out[11] = matrix[11] / 1000.0
    return out


def z_up_to_y_up() -> List[float]:
    """绕 X 轴 -90° 的 4x4：把 STEP/OCCT 的 Z-up 右手系转成 three.js 的 Y-up。"""
    c = math.cos(-math.pi / 2)
    s = math.sin(-math.pi / 2)
    return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
