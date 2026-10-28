# -*- coding: utf-8 -*-
"""一条命令构建发布包：重新生成 play/js/credits.js（来自 credits.json），打包 release/<仓库名>-v<版本>.zip。

  python -m tools.build             只重新生成 credits.js
  python -m tools.build --release   另外打包 release/*.zip（play/ + 根目录跳转页 index.html；zip 不进仓库）

play/ 是纯静态网页：双击 play/index.html 即可运行，不需要 Python、不需要联网。
网页里的规则引擎（play/js/）与 Python 引擎（core/、games/）的一致性由 tests/js 的差分测试保证。
"""
import argparse
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / "play"


def build(release=False):
    c = json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))
    js = ("/* 自动生成：python -m tools.build（来自 credits.json）；不要手改。 */\n"
          "window.DDZ_CREDITS = " + json.dumps(c, ensure_ascii=False, indent=1) + ";\n")
    (PLAY / "js" / "credits.js").write_text(js, encoding="utf-8", newline="\n")
    files = sorted(p for p in PLAY.rglob("*") if p.is_file())
    print(f"play/：{len(files)} 个文件，{sum(p.stat().st_size for p in files):,} 字节")
    if release:
        out = ROOT / "release" / f"{c['REPO_NAME']}-v{c['VERSION']}.zip"
        out.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for p in files:
                z.write(p, Path("play") / p.relative_to(PLAY))
            if (ROOT / "index.html").exists():   # 根目录跳转页：解压后双击 index.html 就能进 play/
                z.write(ROOT / "index.html", "index.html")
        print(f"发布包：release/{out.name}，{out.stat().st_size:,} 字节")
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true")
    build(ap.parse_args().release)


if __name__ == "__main__":
    main()
