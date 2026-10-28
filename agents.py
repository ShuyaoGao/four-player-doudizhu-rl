# -*- coding: utf-8 -*-
"""通用智能体：随机 / 贪心（所有游戏可用），DMC 加载器（训练后可用）。"""

import random

BOMB_KINDS = {"bomb", "rocket", "joker_bomb", "flush"}


class RandomAgent:
    def __init__(self, seed=None):
        self.rng = random.Random(seed)

    def act(self, game):
        return self.rng.choice(game.legal_moves())


class GreedyAgent:
    """领出打最长再最小；跟牌打最小能压的普通牌；炸弹仅在手牌短时使用。"""

    def act(self, game):
        if hasattr(game, "greedy_move"):
            return game.greedy_move(game.turn)
        legal = game.legal_moves()
        non_pass = [m for m in legal if not m.is_pass]
        leading = len(non_pass) == len(legal)        # 无 PASS 选项 = 自由出牌
        normal = [m for m in non_pass if m.kind not in BOMB_KINDS]
        if leading:
            pool = normal or non_pass
            return min(pool, key=lambda m: (-m.size(), m.main))
        if normal:
            return min(normal, key=lambda m: (m.main, m.size()))
        if non_pass and len(game.hands[game.turn]) <= 8:
            return min(non_pass, key=lambda m: (m.size(), m.main))
        return legal[0]                              # PASS


def load_dmc(game_name, positions, ckpt_dir="checkpoints"):
    """有训练断点则返回 DMCAgent，否则 None（调用方退化为贪心）。"""
    from pathlib import Path
    path = Path(__file__).parent / ckpt_dir / f"dmc_{game_name}.pt"
    if not path.exists():
        return None
    from rl_dmc import DMCAgent
    return DMCAgent(positions).load(path)
