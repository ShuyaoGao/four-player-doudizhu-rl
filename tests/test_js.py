# -*- coding: utf-8 -*-
"""把 tests/js 下的 Node 差分测试接进 pytest：浏览器版规则引擎 vs Python 引擎（以及四人斗地主的网络前向 vs PyTorch）。

夹具（tests/fixtures/*.json）由 python -m tools.export_fixtures 生成并随仓库提交。
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
GAMES = [g for g in ("ddz4", "guandan", "shengji", "baohuang", "gouji") if (ROOT / "tests" / "fixtures" / f"{g}.json").exists()]
CASES = [("test_engine.js", g) for g in GAMES] + ([("test_parity.js", "")] if "ddz4" in GAMES else [])


@pytest.mark.parametrize("script,game", CASES, ids=[f"{s}:{g}" for s, g in CASES])
def test_node(script, game):
    if not NODE:
        pytest.skip("没装 Node.js")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    cmd = [NODE, str(ROOT / "tests" / "js" / script)] + ([game] if game else [])
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, env=env, timeout=600)
    out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    print(out)
    assert r.returncode == 0, out
