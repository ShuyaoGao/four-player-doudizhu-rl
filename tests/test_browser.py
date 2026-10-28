# -*- coding: utf-8 -*-
"""用本机 Edge / Chrome 无头打开 play/ 网页包，在 1920×1080 和 1366×768 下跑一遍关键操作：
观战单步、规则依据面板、（四人斗地主）大脑面板、我来玩打完一整局、规则练习、说明弹窗、退出。断言没有 JS 报错。

没装 Edge / Chrome 时跳过。Firefox 未测；Safari 需要在真实 Mac 上确认。
"""
from pathlib import Path

import pytest

from tools import edge

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "play" / "index.html").exists():
    PAGES = [ROOT / "play" / "index.html"]
else:   # 内部开发目录：play/<仓库名>/index.html
    PAGES = sorted((ROOT / "play").glob("*/index.html"))

pytestmark = pytest.mark.skipif(edge.find_browser() is None, reason="没装 Edge / Chrome")


@pytest.mark.parametrize("page", PAGES, ids=[p.parent.name for p in PAGES])
@pytest.mark.parametrize("size", ["1920,1080", "1366,768"])
def test_selftest(size, page):
    edge.wait_for_memory(1.5)
    r = edge.selftest(size, index=page)
    failed = [c for c in r.get("checks", []) if not c["ok"]]
    assert not r.get("errors"), r.get("errors")
    assert r.get("checks"), r
    assert not failed, failed
    assert r["ok"]
