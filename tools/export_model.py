# -*- coding: utf-8 -*-
"""把 checkpoints/dmc_ddz4.pt（四个身份的 Q 网络）导出成浏览器能用 <script> 加载的 .js（float16）。

权重按 float16 小端存成一个 base64 串；每层记录形状和在串里的元素偏移。格式与 doudizhu-dmc-lab 的
model_dmc.js 相同（ddz-dmc-fp16/1），只是身份是 landlord / p1 / p2 / p3 四个。

用法：python -m tools.export_model [--ckpt checkpoints/dmc_ddz4.pt] [--out play/js/model_dmc4.js]
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
POSITIONS = ("landlord", "p1", "p2", "p3")


def export(ckpt, out):
    ck = torch.load(ckpt, map_location="cpu", weights_only=True)
    chunks, nets, offset = [], {}, 0
    for pos in POSITIONS:
        sd = ck["nets"][pos]
        names = sorted({k.rsplit(".", 1)[0] for k in sd}, key=lambda s: int(s.split(".")[1]))
        layers = []
        for name in names:
            w = sd[name + ".weight"].numpy().astype(np.float16)
            b = sd[name + ".bias"].numpy().astype(np.float16)
            layers.append({"name": name, "out": int(w.shape[0]), "in": int(w.shape[1]), "w": offset, "b": offset + w.size})
            chunks += [w.astype("<f2").tobytes(), b.astype("<f2").tobytes()]
            offset += w.size + b.size
        nets[pos] = {"layers": layers, "params": int(sum(v.numel() for v in sd.values()))}
    meta = {"format": "ddz-dmc-fp16/1", "source": "checkpoints/" + Path(ckpt).name,
            "source_sha256": hashlib.sha256(Path(ckpt).read_bytes()).hexdigest(), "dtype": "float16-le",
            "activation": "relu", "positions": list(POSITIONS), "nets": nets,
            "total_params": int(sum(n["params"] for n in nets.values())), "n_values": offset}
    js = ("/* 自动生成：python -m tools.export_model；不要手改。\n"
          " * 四人斗地主 DMC Q 网络（地主 / 农民一 / 农民二 / 农民三），float16 权重。 */\n"
          "window.DDZ_MODEL = " + json.dumps(meta, ensure_ascii=False) + ";\n"
          "window.DDZ_MODEL.b64 = '" + base64.b64encode(b"".join(chunks)).decode("ascii") + "';\n")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(js, encoding="utf-8", newline="\n")
    return meta, len(js.encode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=str(ROOT / "checkpoints" / "dmc_ddz4.pt"))
    default = ROOT / "play" / "js" / "model_dmc4.js"
    ap.add_argument("--out", default=str(default))
    a = ap.parse_args()
    meta, size = export(a.ckpt, a.out)
    print(f"已导出 {a.out}：{meta['total_params']:,} 个参数，{size:,} 字节")


if __name__ == "__main__":
    main()
