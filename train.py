# -*- coding: utf-8 -*-
"""通用 DMC 自博弈训练：python train.py --game ddz4 --max-minutes 10

适用全部 5 个游戏（终局 ±1 团队回报；掼蛋/升级随机级别增加多样性）。
含防塌缩措施：Q 微噪声破并列 + 15% 概率随机智能体代打。
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；直接运行也不崩

import argparse
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from games import GAMES
from agents import RandomAgent, GreedyAgent
from rl_dmc import DMCAgent

CKPT = Path(__file__).parent / "checkpoints"
CKPT.mkdir(exist_ok=True)


def make_game(name, rng):
    cls = GAMES[name]
    if name == "guandan":
        g = cls(rng, level=rng.choice(range(2, 15)))
    elif name == "shengji":
        g = cls(rng, level=rng.choice(range(2, 15)), banker=rng.randrange(4))
    else:
        g = cls(rng)
    return g.reset()


def team_winrate_vs(agent, name, opponent, n_games, seed):
    """agent 执 0 队 vs opponent 执 1 队，返回 0 队胜率（再换边平均）。"""
    wins = total = 0
    for swap in (False, True):
        rng = random.Random(seed + swap)
        for _ in range(n_games // 2):
            g = make_game(name, rng)
            teams = g.teams()
            while not g.done:
                team = teams[g.turn]
                use_agent = (team == 0) != swap
                g.step(agent.act(g) if use_agent else opponent.act(g))
            r = g.returns()
            team0_won = next(r[s] for s in range(g.N) if teams[s] == 0) > 0
            wins += team0_won != swap
            total += 1
    return wins / total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True, choices=list(GAMES))
    ap.add_argument("--episodes", type=int, default=200000)
    ap.add_argument("--max-minutes", type=float, default=10.0)
    ap.add_argument("--batch", type=int, default=512)
    ap.add_argument("--flush", type=int, default=2048)
    ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--eps-start", type=float, default=0.25)
    ap.add_argument("--eps-end", type=float, default=0.08)
    ap.add_argument("--mix-prob", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    rng = random.Random(args.seed)
    probe = make_game(args.game, random.Random(0))
    positions = probe.positions_list()

    agent = DMCAgent(positions, epsilon=args.eps_start, seed=args.seed)
    mixer = RandomAgent(args.seed + 1)
    mix_rng = random.Random(args.seed + 2)
    shuffle_rng = random.Random(args.seed + 3)
    optims = {}
    buffers = {p: [] for p in positions}

    t0 = time.time()
    deadline = t0 + args.max_minutes * 60
    print(f"[{args.game}] DMC 训练开始：身份 {positions}", flush=True)

    ep = 0
    for ep in range(1, args.episodes + 1):
        frac = min(1.0, (time.time() - t0) / max(deadline - t0, 1e-9))
        agent.epsilon = args.eps_start + (args.eps_end - args.eps_start) * frac
        g = make_game(args.game, rng)
        mixed = {s: mix_rng.random() < args.mix_prob for s in range(g.N)}
        samples = {s: [] for s in range(g.N)}
        while not g.done:
            seat = g.turn
            if mixed[seat]:
                g.step(mixer.act(g))
                continue
            legal = g.legal_moves()
            mv = agent.act(g)
            if len(legal) > 1:
                st = g.encode_state(seat)
                samples[seat].append(agent.encode_pair(g, st, mv))
            g.step(mv)
        rets = g.returns()
        for s in range(g.N):
            tgt = float(np.sign(rets[s]))
            buffers[g.position(s)].extend((x, tgt) for x in samples[s])

        for p in positions:
            buf = buffers[p]
            if len(buf) < args.flush:
                continue
            net = agent.net(p, len(buf[0][0]))
            if p not in optims:
                optims[p] = torch.optim.Adam(net.parameters(), lr=args.lr)
            shuffle_rng.shuffle(buf)
            for i in range(0, len(buf), args.batch):
                chunk = buf[i:i + args.batch]
                if len(chunk) < 32:
                    break
                x = torch.from_numpy(np.stack([c[0] for c in chunk]))
                y = torch.tensor([c[1] for c in chunk])
                loss = F.mse_loss(net(x), y)
                optims[p].zero_grad()
                loss.backward()
                optims[p].step()
            buf.clear()

        if ep % 200 == 0:
            el = time.time() - t0
            print(f"[{el:5.0f}s] 局数={ep} eps={agent.epsilon:.2f} "
                  f"速度={ep / el:.1f}局/s", flush=True)
        if ep % 2000 == 0:
            agent.save(CKPT / f"dmc_{args.game}.pt")
            eb = agent.epsilon
            agent.epsilon = 0
            wr_r = team_winrate_vs(agent, args.game, RandomAgent(9), 40, 99)
            wr_g = team_winrate_vs(agent, args.game, GreedyAgent(), 40, 99)
            agent.epsilon = eb
            print(f"    >>> 评估: DMC vs 随机 胜率={wr_r:.2f} | vs 贪心 胜率={wr_g:.2f}",
                  flush=True)
        if time.time() > deadline:
            print("达到时间上限。", flush=True)
            break

    agent.save(CKPT / f"dmc_{args.game}.pt")
    print(f"完成 {ep} 局，模型存至 {CKPT / f'dmc_{args.game}.pt'}", flush=True)


if __name__ == "__main__":
    main()
