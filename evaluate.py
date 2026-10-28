# -*- coding: utf-8 -*-
"""基线评估：每个游戏 贪心 vs 随机（双边换位各半），可加载 DMC 断点参战。

用法: python evaluate.py [--games 100] [--dmc]
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；直接运行也不崩

import argparse
import random
from pathlib import Path

from games import GAMES
from agents import RandomAgent, GreedyAgent


def make_game(name, rng):
    cls = GAMES[name]
    if name == "guandan":
        return cls(rng, level=rng.choice(range(2, 15))).reset()
    if name == "shengji":
        return cls(rng, level=rng.choice(range(2, 15)),
                   banker=rng.randrange(4)).reset()
    return cls(rng).reset()


def team_match(name, a0, a1, n, seed):
    """a0 执 0 队、a1 执 1 队，换边各打一半，返回 a0 的胜率。"""
    wins = total = 0
    for swap in (False, True):
        rng = random.Random(seed + swap)
        for _ in range(n // 2):
            g = make_game(name, rng)
            teams = g.teams()
            while not g.done:
                mine = (teams[g.turn] == 0) != swap
                g.step((a0 if mine else a1).act(g))
            r = g.returns()
            t0_won = next(r[s] for s in range(g.N) if teams[s] == 0) > 0
            wins += t0_won != swap
            total += 1
    return wins / total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=100)
    ap.add_argument("--dmc", action="store_true", help="同时评估已训练的 DMC 断点")
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()

    rnd, greedy = RandomAgent(args.seed), GreedyAgent()
    print(f"每组 {args.games} 局（换边各半）")
    print("=" * 62)
    print(f"{'游戏':<14}{'贪心 vs 随机':>14}", end="")
    if args.dmc:
        print(f"{'DMC vs 随机':>14}{'DMC vs 贪心':>14}")
    else:
        print()
    print("-" * 62)
    for name, cls in GAMES.items():
        wr = team_match(name, greedy, rnd, args.games, args.seed)
        line = f"{cls.TITLE:<14}{wr:>13.1%}"
        if args.dmc:
            ckpt = Path(__file__).parent / "checkpoints" / f"dmc_{name}.pt"
            if ckpt.exists():
                from rl_dmc import DMCAgent
                probe = make_game(name, random.Random(0))
                dmc = DMCAgent(probe.positions_list()).load(ckpt)
                w1 = team_match(name, dmc, rnd, args.games, args.seed)
                w2 = team_match(name, dmc, greedy, args.games, args.seed)
                line += f"{w1:>13.1%}{w2:>13.1%}"
            else:
                line += f"{'（无断点）':>13}"
        print(line, flush=True)
    print("=" * 62)
    print("注：胜率为该智能体所在队伍的对局胜率；各游戏强弱队结构不同，"
          "50% 即为同强度。")


if __name__ == "__main__":
    main()
