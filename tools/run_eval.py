# -*- coding: utf-8 -*-
"""固定种子重跑 evaluate.py 的对战评估，写 results/result.json（内部多游戏目录里每个游戏一份 result_<游戏>.json）。

规则与 evaluate.py 完全相同（直接调用它的 team_match：每组换边各打一半，统计该智能体所在队伍的胜率）。
唯一的区别：每组开始前 torch.manual_seed(种子)——DMC 智能体用 torch.rand_like 加 1e-3 微噪声打破
Q 值并列，不设种子就不可复现。evaluate.py 本身没有改动。

用法：python -m tools.run_eval [--games 200] [--seed 2026] [--only ddz4,guandan]
"""
import argparse
import json
import os
import platform
import random
import sys
import time
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import evaluate  # noqa: E402
from agents import GreedyAgent, RandomAgent  # noqa: E402
from games import GAMES  # noqa: E402


def wilson(p, n, z=1.96):
    if n == 0:
        return [0.0, 0.0]
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / d
    return [round(c - h, 4), round(c + h, 4)]


def q_spread(name, dmc, seed, n_games=20):
    """DMC 网络对同一局面不同出牌的打分差多少：贪心对打 n_games 局，每个有 ≥2 个合法动作的决策点，
    取行动方那张网络给全部合法动作的 Q 的“最高 - 最低”，以及网络首选与贪心规则相同的比例。"""
    import numpy as np
    import torch
    greedy = GreedyAgent()
    spreads, same = [], 0
    for k in range(n_games):
        g = evaluate.make_game(name, random.Random(seed + 100 + k))
        while not g.done:
            legal = g.legal_moves()
            gm = greedy.act(g)
            if len(legal) > 1:
                st = g.encode_state(g.turn)
                x = torch.from_numpy(np.stack([np.asarray(st + g.encode_action(m), dtype=np.float32) for m in legal]))
                with torch.no_grad():
                    q = dmc.nets[g.position(g.turn)](x).numpy()
                spreads.append(float(q.max() - q.min()))
                same += legal[int(q.argmax())] == gm
            g.step(gm)
    sp = np.asarray(spreads)
    return {"games": n_games, "seed_from": seed + 100, "decisions": len(spreads),
            "spread_median": round(float(np.median(sp)), 4), "spread_p90": round(float(np.percentile(sp, 90)), 4),
            "spread_max": round(float(sp.max()), 4), "agree_with_greedy": round(same / len(spreads), 4),
            "note": "Q 的“最高 - 最低”；训练目标是赢 +1 / 输 -1，所以 2.0 是最大可能差距"}


def run(name, games, seed):
    import numpy as np
    t0 = time.time()
    rnd, greedy = RandomAgent(seed), GreedyAgent()
    rows = {}

    def one(key, a0, a1, desc):
        try:
            import torch
            torch.manual_seed(seed)
        except ImportError:
            pass
        wr = evaluate.team_match(name, a0, a1, games, seed)
        rows[key] = {"desc": desc, "games": games, "win_rate": round(wr, 4), "wilson95": wilson(wr, games)}
        print(f"  {name:<9}{desc:<28}{wr:>8.1%}", flush=True)

    one("greedy_vs_random", greedy, rnd, "贪心 vs 随机")
    ckpt = ROOT / "checkpoints" / f"dmc_{name}.pt"
    model = None
    if ckpt.exists():
        from rl_dmc import DMCAgent
        probe = evaluate.make_game(name, random.Random(0))
        dmc = DMCAgent(probe.positions_list()).load(ckpt)
        one("dmc_vs_random", dmc, rnd, "DMC vs 随机")
        one("dmc_vs_greedy", dmc, greedy, "DMC vs 贪心")
        model = {"q_spread": q_spread(name, dmc, seed), "checkpoint": f"checkpoints/{ckpt.name}", "positions": list(dmc.nets),
                 "in_dim": dmc.in_dim,
                 "params_per_net": int(sum(p.numel() for p in next(iter(dmc.nets.values())).parameters())),
                 "params_total": int(sum(p.numel() for n in dmc.nets.values() for p in n.parameters())),
                 "training_steps": None, "training_time": None,
                 "training_note": "训练步数和用时未记录；重新训练命令见 README"}
    try:
        import torch
        torch_v = torch.__version__
    except ImportError:
        torch_v = None
    return {
        "format": "cardgames/result/1", "game": name, "title": GAMES[name].TITLE,
        "eval": {"script": "evaluate.py team_match via tools/run_eval.py", "seed": seed,
                 "note": "每组换边各打一半；胜率 = 该智能体所在队伍赢的局数 / 总局数。各游戏强弱队结构不同，50% 即为同强度。",
                 "matchups": rows},
        "model": model,
        "env": {"python": platform.python_version(), "numpy": np.__version__,
                "torch": torch_v, "platform": platform.system()},
        "elapsed_seconds": round(time.time() - t0, 1),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    names = [n for n in GAMES if not a.only or n in a.only.split(",")]
    out = ROOT / "results"
    out.mkdir(exist_ok=True)
    for name in names:
        res = run(name, a.games, a.seed)
        fname = "result.json" if len(GAMES) == 1 else f"result_{name}.json"      # 公开仓库只有一个游戏
        (out / fname).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"已写入 results/{fname}（{res['elapsed_seconds']} 秒）", flush=True)


if __name__ == "__main__":
    main()
