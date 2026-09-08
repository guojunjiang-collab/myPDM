"""CATIA 装配树读取进度回调单元测试。

锁定「读取装配结构显示进度」：_read_product_tree 递归时每处理一个节点
（先序）调用一次 on_progress(count, name)，count 从 1 递增、name 为节点名。
用假 COM 对象构造轻量产品树，验证计数与顺序，不依赖真实 CATIA。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from cad_bridge.catia.client import CATIAClient


class FakeProducts:
    def __init__(self, items):
        self._items = items

    @property
    def Count(self):
        return len(self._items)

    def Item(self, i):
        return self._items[i - 1]


class FakeProduct:
    def __init__(self, name, children=None):
        self.Name = name
        self.ReferenceProduct = self
        self.Products = FakeProducts(children or [])
        self.Position = None
        self.Parent = None


def test_read_tree_reports_progress_counts_in_preorder():
    client = CATIAClient()
    root = FakeProduct("root", [
        FakeProduct("a"),
        FakeProduct("b", [FakeProduct("c"), FakeProduct("d")]),
    ])

    calls = []
    client._read_product_tree(
        root, path="0", level=0,
        on_progress=lambda count, name: calls.append((count, name)),
        counter={"n": 0},
    )

    assert [c[0] for c in calls] == [1, 2, 3, 4, 5]
    assert [c[1] for c in calls] == ["root", "a", "b", "c", "d"]
