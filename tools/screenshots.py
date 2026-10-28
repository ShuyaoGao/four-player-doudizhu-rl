# -*- coding: utf-8 -*-
"""截 README 用的截图到 docs/img/（一次只开一个浏览器）：python -m tools.screenshots

电脑尺寸（1920×1080、1366×768）用 tools/edge.py（Playwright 驱动本机 Edge）；
手机尺寸（390×844，DPR 3，触屏）用 tools/mobile_check.py（DevTools 协议模拟，--window-size 截不出真实的手机布局）。
中间文件放在环境变量 CG_CHECK_OUT 指定的目录（默认系统临时目录）。
"""
import os
import shutil
import tempfile
from pathlib import Path

from tools import edge, mobile_check

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "play" / "index.html"
OUT = ROOT / "docs" / "img"
DESKTOP = [("screenshot-watch.png", "demo=watch&steps=40", "1920,1080"),
           ("screenshot-play.png", "demo=play&steps=12&pane=rules", "1366,768")]
PHONE = {"name": "m390x844", "kind": "mobile", "w": 390, "h": 844, "dpr": 3}
MOBILE = [("screenshot-mobile-play.png", "demo=play&steps=12", "play"),
          ("screenshot-mobile-watch.png", "demo=watch&steps=30", "watch")]


def mobile_shot(name, query, mode):
    url = INDEX.resolve().as_uri() + "?" + query
    base = os.environ.get("CG_CHECK_OUT")
    tmp = Path(tempfile.mkdtemp(prefix="cg_shot_", dir=base if base else None))

    def scenario(page, size):
        page.wait_for_function("() => document.title === 'DEMO:READY'", timeout=30000)
        if mode == "play":
            page.evaluate("() => { CGApp.hint(); }")   # 让贪心规则替我选好牌，截图里能看到抬起的牌
        page.wait_for_timeout(200)
        return []

    rep = mobile_check.run(url, tmp, scenario=scenario, sizes=[PHONE], settle_ms=600)
    ok = rep["ok"] and Path(rep["sizes"][0]["screenshot"]).exists()
    if ok:
        shutil.copy2(rep["sizes"][0]["screenshot"], OUT / name)
    shutil.rmtree(tmp, ignore_errors=True)
    return ok


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, query, size in DESKTOP:
        ok = edge.shot(OUT / name, query, size, index=INDEX)
        print(("已保存 " if ok else "失败 ") + f"docs/img/{name}")
    for name, query, mode in MOBILE:
        ok = mobile_shot(name, query, mode)
        print(("已保存 " if ok else "失败 ") + f"docs/img/{name}")


if __name__ == "__main__":
    main()
