"""4x4 变换矩阵工具（行主序 16 元素 float 列表）。"""
from __future__ import annotations
from typing import List
import math
import numpy as np


def identity() -> List[float]:
    return [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def multiply(a: List[float], b: List[float]) -> List[float]:
    ma = np.array(a, dtype=float).reshape(4, 4)
    mb = np.array(b, dtype=float).reshape(4, 4)
    return (ma @ mb).reshape(16).tolist()


def normalize_translation_mm_to_m(matrix: List[float]) -> List[float]:
    out = list(matrix)
    out[3] = matrix[3] / 1000.0
    out[7] = matrix[7] / 1000.0
    out[11] = matrix[11] / 1000.0
    return out


def z_up_to_y_up() -> List[float]:
    c = math.cos(-math.pi / 2)
    s = math.sin(-math.pi / 2)
    return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
