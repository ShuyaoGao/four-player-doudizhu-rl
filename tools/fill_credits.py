# -*- coding: utf-8 -*-
"""把 credits.json 里的署名、系列名、用户名、仓库名一次填进所有 {{占位}}，并重新构建 play/。

  python -m tools.fill_credits            填占位 + python -m tools.build --release
  python -m tools.fill_credits --check    只检查还有没有没填的占位（有就返回 1）

credits.json 里值为空字符串的键（例如 UNIVERSITY_LOGO：拿到学校书面授权后再填）视为“可选、暂不填”。
RELEASE_DATE 为空时用今天的日期。
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT_EXT = {".md", ".cff", ".txt", ".json", ".html", ".css", ".js", ".py", ".ini", ""}
SKIP_DIRS = {".git", "release", "__pycache__", ".venv", "node_modules", "fixtures"}
SKIP_FILES = {"model_dmc4.js", "credits.json"}
PLACEHOLDER = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")


def text_files():
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file() or p.name in SKIP_FILES or any(part in SKIP_DIRS for part in p.relative_to(ROOT).parts):
            continue
        if p.suffix.lower() in TEXT_EXT or p.name.startswith("LICENSE"):
            yield p


def load():
    c = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    if not c.get("RELEASE_DATE"):
        c["RELEASE_DATE"] = datetime.date.today().isoformat()
    return c


def fill(check_only=False):
    credits = load()
    changed, left = [], {}
    for p in text_files():
        if p.name == "fill_credits.py":
            continue
        s = p.read_text(encoding="utf-8")
        new = PLACEHOLDER.sub(lambda m: str(credits[m.group(1)]) if credits.get(m.group(1)) else m.group(0), s)
        for m in PLACEHOLDER.finditer(new):
            left.setdefault(m.group(1), []).append(str(p.relative_to(ROOT)))
        if new != s and not check_only:
            p.write_text(new, encoding="utf-8", newline="\n")
            changed.append(str(p.relative_to(ROOT)))
    optional = sorted(k for k, v in credits.items() if v == "")
    return changed, left, optional


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--no-build", action="store_true")
    a = ap.parse_args()
    changed, left, optional = fill(a.check)
    for f in changed:
        print("已填写", f)
    if optional:
        print("可选、暂未填写：", ", ".join(optional))
    if left:
        print("还有没填的占位：")
        for k, files in left.items():
            print(f"  {{{{{k}}}}}: {', '.join(sorted(set(files)))}")
    if not a.check and not a.no_build:
        from tools import build
        build.build(release=True)
    sys.exit(1 if left else 0)


if __name__ == "__main__":
    main()
