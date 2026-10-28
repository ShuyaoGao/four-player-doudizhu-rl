# -*- coding: utf-8 -*-
"""用 Python 引擎生成“标准答案”夹具，给浏览器版引擎（网页包里的 js/）做差分测试。

每个游戏一份 tests/fixtures/<游戏>.json：
  random_games   随机对局：开局状态、每一步的合法动作列表（含顺序）、所选动作、终局名次与回报
  greedy_games   贪心对局：每一步贪心选的动作
  （掼蛋 / 升级另有整场 match：多局连打的级别、进贡 / 还贡、坐庄轮转）
  （四人斗地主另有 dmc：状态编码与 PyTorch 的 Q 值，原始 fp32 与 fp16 反量化权重各一份）
另有 tests/fixtures/pyset.json：Python set 的遍历顺序。

用法：python -m tools.export_fixtures [--only ddz4,guandan]
"""
import argparse
import json
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from agents import GreedyAgent  # noqa: E402
from games import GAMES, MATCHES  # noqa: E402

OUT = ROOT / "tests" / "fixtures"


def cj(c):
    return [c[0], c[1]]


def mj(m):
    return [m.kind, m.main, m.length, list(m.ranks), [cj(c) for c in m.cards]]


def make(name, seed, **kw):
    cls = GAMES[name]
    rng = random.Random(seed)
    if name == "guandan":
        return cls(rng, level=kw.get("level", 2)).reset()
    if name == "shengji":
        return cls(rng, level=kw.get("level", 2), banker=kw.get("banker", 0)).reset()
    return cls(rng).reset()


def snapshot(g):
    d = {"hands": [[cj(c) for c in h] for h in g.hands], "turn": g.turn}
    for k in ("landlord", "base", "emperor", "guard", "trump_suit", "level", "banker"):
        if hasattr(g, k):
            d[k] = getattr(g, k)
    for k in ("bottom", "buried", "bottom_buried"):
        if hasattr(g, k):
            d[k] = [cj(c) for c in getattr(g, k)]
    return d


def ending(g):
    d = {"returns": list(g.returns()), "finished": list(getattr(g, "finished", []))}
    for k in ("upgrade", "winner_team", "multiplier", "spring", "emp_win", "defender_points", "level_change",
              "next_banker", "banker_win"):
        if hasattr(g, k):
            d[k] = getattr(g, k)
    return d


def play(g, chooser, record_legal=True):
    steps = []
    while not g.done:
        legal = g.legal_moves()
        i = chooser(g, legal)
        steps.append({"turn": g.turn, "legal": [mj(m) for m in legal] if record_legal else len(legal), "pick": i})
        g.step(legal[i])
    return steps


def game_cases(name, n_random, n_greedy, kwargs_of=lambda s: {}):
    rnd_games, greedy_games = [], []
    greedy = GreedyAgent()
    for seed in range(n_random):
        kw = kwargs_of(seed)
        g = make(name, seed, **kw)
        pick_rng = random.Random(10_000 + seed)
        start = snapshot(g)
        steps = play(g, lambda g_, legal: pick_rng.randrange(len(legal)))
        rnd_games.append({"seed": seed, "kw": kw, "start": start, "steps": steps, "end": ending(g)})
    for seed in range(n_greedy):
        kw = kwargs_of(seed + 500)
        g = make(name, seed + 500, **kw)
        start = snapshot(g)
        moves = []
        while not g.done:
            legal = g.legal_moves()
            m = greedy.act(g)
            moves.append(legal.index(m))
            g.step(m)
        greedy_games.append({"seed": seed + 500, "kw": kw, "start": start, "picks": moves, "end": ending(g)})
    return {"random_games": rnd_games, "greedy_games": greedy_games}


def match_cases(name, n_matches, deals):
    out = []
    for seed in range(n_matches):
        rng = random.Random(seed + 900)
        m = MATCHES[name](rng)
        pick_rng = random.Random(seed + 9_000)
        rec = {"seed": seed + 900, "deals": []}
        for _ in range(deals):
            if m.over:
                break
            g = m.new_deal()
            if name == "shengji":
                g.reset()
            d = {"start": snapshot(g), "tribute_log": list(getattr(m, "tribute_log", []))}
            d["picks"] = []
            while not g.done:
                legal = g.legal_moves()
                i = pick_rng.randrange(len(legal))
                d["picks"].append(i)
                g.step(legal[i])
            d["end"] = ending(g)
            m.apply_result(g)
            d["after"] = {"levels": list(m.levels), "over": m.over, "champion": m.champion,
                          **({"trump_team": m.trump_team} if name == "guandan" else {"banker": m.banker})}
            rec["deals"].append(d)
        out.append(rec)
    return out


def dmc_cases(n_games=6):
    import numpy as np
    import torch
    from rl_dmc import DMCAgent
    ck = ROOT / "checkpoints" / "dmc_ddz4.pt"
    a32 = DMCAgent(["landlord", "p1", "p2", "p3"]).load(ck)
    a16 = DMCAgent(["landlord", "p1", "p2", "p3"]).load(ck)
    for n in a16.nets.values():
        for p in n.parameters():
            p.data = p.data.half().float()
    out = []
    pick_rng = random.Random(77)
    for seed in range(n_games):
        g = make("ddz4", 3000 + seed)
        start = snapshot(g)
        steps = []
        while not g.done:
            legal = g.legal_moves()
            st = g.encode_state(g.turn)
            rec = {"turn": g.turn, "position": g.position(g.turn), "n_legal": len(legal)}
            if len(legal) > 1 and (len(steps) % 3 == 0 or len(legal) > 40):
                x = torch.from_numpy(np.stack([np.asarray(st + g.encode_action(m), dtype=np.float32) for m in legal]))
                with torch.no_grad():
                    rec["q_fp32"] = [float(v) for v in a32.nets[g.position(g.turn)](x)]
                    rec["q_fp16w"] = [float(v) for v in a16.nets[g.position(g.turn)](x)]
                rec["state_on"] = [i for i, v in enumerate(st) if v]
            i = pick_rng.randrange(len(legal))
            rec["pick"] = i
            steps.append(rec)
            g.step(legal[i])
        out.append({"seed": 3000 + seed, "start": start, "steps": steps})
    return out


def pyset_cases():
    rng = random.Random(5)
    out = []
    for _ in range(400):
        xs = [rng.randint(2, 17) for _ in range(rng.randint(0, 18))]
        out.append({"in": xs, "out": list(set(xs))})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    want = lambda n: (n in GAMES or (n == "pyset" and "guandan" in GAMES)) and (not a.only or n in a.only.split(","))  # noqa: E731
    OUT.mkdir(parents=True, exist_ok=True)
    data = {}
    if want("pyset"):
        data["pyset.json"] = pyset_cases()
    if want("ddz4"):
        d = game_cases("ddz4", 40, 20)
        d["dmc"] = dmc_cases()
        data["ddz4.json"] = d
    if want("guandan"):
        d = game_cases("guandan", 40, 20, lambda s: {"level": 2 + s % 13})
        d["matches"] = match_cases("guandan", 6, 8)
        data["guandan.json"] = d
    if want("shengji"):
        d = game_cases("shengji", 60, 30, lambda s: {"level": 2 + s % 13, "banker": s % 4})
        d["matches"] = match_cases("shengji", 6, 10)
        data["shengji.json"] = d
    if want("baohuang"):
        data["baohuang.json"] = game_cases("baohuang", 25, 12)
    if want("gouji"):
        data["gouji.json"] = game_cases("gouji", 25, 12)
    for nm, d in data.items():
        (OUT / nm).write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(nm, (OUT / nm).stat().st_size, "字节")


if __name__ == "__main__":
    main()
