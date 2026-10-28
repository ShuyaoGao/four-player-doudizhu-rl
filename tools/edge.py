# -*- coding: utf-8 -*-
"""用本机已装的 Edge 无头打开 play/index.html：自检（读回页面里的自检结果）和电脑尺寸截图。

通过 Playwright 的 channel="msedge" 驱动系统里已经装好的 Edge（不下载 Playwright 自带的浏览器）；
新版 Edge 直接用 msedge.exe --headless --dump-dom / --screenshot 会立刻退出、没有输出，所以不再裸起 msedge.exe。
全机同一时间只跑一个 Edge：和 tools/mobile_check.py 共用 EdgeLock（空闲内存不足时等待）。

  python -m tools.edge selftest [--size 1920x1080] [--index play/index.html]
  python -m tools.edge shot out.png --query "demo=watch&steps=40" [--size 1366x768] [--index ...]
"""
import argparse
import json
import os
import shutil
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from tools.mobile_check import EdgeLock

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "play" / "index.html"
CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


def find_browser():
    """装了 Edge 且装了 Playwright（pip install playwright）才返回路径；否则 None（测试据此跳过）。"""
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:
        return None
    for c in CANDIDATES:
        if Path(c).exists():
            return c
    for name in ("msedge", "microsoft-edge"):
        p = shutil.which(name)
        if p:
            return p
    return None


def free_memory_gb():
    """Windows 上读空闲物理内存（GB）；读不到返回 None。"""
    if os.name != "nt":
        return None
    try:
        import ctypes

        class MEMSTAT(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = MEMSTAT()
        st.dwLength = ctypes.sizeof(MEMSTAT)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        return st.ullAvailPhys / 2 ** 30
    except Exception:
        return None


def wait_for_memory(min_gb=1.5, max_wait=600):
    t0 = time.time()
    while True:
        free = free_memory_gb()
        if free is None or free >= min_gb or time.time() - t0 > max_wait:
            return free
        time.sleep(15)


def url(query, index=None):
    return Path(index or INDEX).resolve().as_uri() + ("?" + query if query else "")


def _size(size):
    w, h = str(size).replace("x", ",").split(",")
    return int(w), int(h)


@contextmanager
def page_at(size, query, index=None):
    """在 EdgeLock 里打开一个电脑尺寸（无触屏、DPR 1）的页面；yield (page, errors)。"""
    from playwright.sync_api import sync_playwright

    w, h = _size(size)
    with EdgeLock(), sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        try:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, locale="zh-CN")
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
            page.goto(url(query, index))
            yield page, errors
            ctx.close()
        finally:
            browser.close()


def selftest(size="1920,1080", timeout=180, index=None):
    """打开 index.html?selftest=1，等页面把自检结果写进 <pre id="selftest-result">，读回来。"""
    try:
        with page_at(size, "selftest=1", index) as (page, errors):
            page.wait_for_function("() => !!document.getElementById('selftest-result')", timeout=timeout * 1000)
            r = json.loads(page.evaluate("() => document.getElementById('selftest-result').textContent"))
            r.setdefault("errors", [])
            r["errors"] += [e for e in errors if "favicon" not in e.lower()]
            if r["errors"]:
                r["ok"] = False
            return r
    except Exception as e:
        return {"ok": False, "checks": [], "errors": ["没有读到自检结果：%r" % (e,)]}


def shot(path, query, size="1920,1080", timeout=60, index=None):
    """截一张电脑尺寸的图：demo=… 模式会把标题改成 DEMO:READY，等到它再截。"""
    path = Path(path).resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with page_at(size, query, index) as (page, _errors):
            try:
                page.wait_for_function("() => document.title === 'DEMO:READY'", timeout=timeout * 1000)
            except Exception:
                page.wait_for_timeout(3000)
            page.wait_for_timeout(300)
            page.screenshot(path=str(path), full_page=False)
    except Exception as e:
        print("截图失败：%r" % (e,))
    return path.exists()


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s1 = sub.add_parser("selftest")
    s1.add_argument("--size", default="1920x1080")
    s1.add_argument("--index")
    s2 = sub.add_parser("shot")
    s2.add_argument("--index")
    s2.add_argument("out")
    s2.add_argument("--query", default="demo=watch&steps=40")
    s2.add_argument("--size", default="1920x1080")
    a = ap.parse_args()
    free = wait_for_memory()
    if free is not None:
        print(f"空闲内存 {free:.1f} GB")
    if a.cmd == "selftest":
        r = selftest(a.size, index=a.index)
        print(json.dumps(r, ensure_ascii=False, indent=1))
        sys.exit(0 if r.get("ok") else 1)
    print("截图", "成功" if shot(a.out, a.query, a.size, index=a.index) else "失败", a.out)


if __name__ == "__main__":
    main()
