# -*- coding: utf-8 -*-
"""四人斗地主引擎测试（python -m pytest，或 python tests/test_ddz4.py）。"""

import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.cards import deck, SMALL_JOKER, BIG_JOKER  # noqa: E402,F401
from core.shed import Move, PASS  # noqa: E402,F401
from games import DDZ4  # noqa: E402
from agents import RandomAgent, GreedyAgent  # noqa: E402,F401

PASSED = 0

def check(cond, name):
    global PASSED
    assert cond, f"测试失败: {name}"
    PASSED += 1
    print(f"  ✓ {name}")



def play_random(game, max_steps=3000):
    rng = random.Random(123)
    steps = 0
    while not game.done:
        game.step(rng.choice(game.legal_moves()))
        steps += 1
        assert steps < max_steps, "对局未终止"
    return steps



def find(moves, kind, **kw):
    return [m for m in moves if m.kind == kind
            and all(getattr(m, k) == v for k, v in kw.items())]



def test_ddz4():
    check(len(deck(2)) == 108, "两副牌 108 张")
    g = DDZ4(random.Random(1)).reset()
    check(sum(len(h) for h in g.hands) == 108, "发牌后总牌数 108(底牌已并入地主)")
    check(len(g.hands[g.landlord]) == 33, "地主 33 张")

    g.hands[0] = [(r, "♠") for r in (3, 3, 3, 3, 3, 9, 9, 9, 9, 9)] + \
                 [(SMALL_JOKER, ""), (SMALL_JOKER, ""), (BIG_JOKER, ""), (BIG_JOKER, "")]
    mv = g.gen_moves(0, None)
    check(find(mv, "bomb", main=3, length=5), "5 张炸弹生成")
    check(find(mv, "rocket"), "天王炸(4王)生成")
    b4 = Move("bomb", 14, 4, (14,) * 4)
    b5 = Move("bomb", 3, 5, (3,) * 5)
    check(g.beats(b5, b4), "5 张 3 炸 > 4 张 A 炸（张数优先）")
    check(g.beats(find(mv, "rocket")[0], Move("bomb", 15, 8, (15,) * 8)),
          "天王炸 > 8 张炸")
    check(not find(mv, "trio_single", main=3), "四人版无三带一")

    for seed in range(20):
        g = DDZ4(random.Random(seed)).reset()
        play_random(g)
        total = sum(len(h) for h in g.hands) + sum(len(p) for p in g.played)
        assert total == 108, "牌数守恒"
        assert abs(sum(g.returns())) < 1e-9, "四家得分零和"
    check(True, "20 局随机对战：终止 + 守恒 + 零和")



def test_greedy_ddz4():
    greedy = GreedyAgent()
    for seed in range(5):
        g = DDZ4(random.Random(99 + seed))
        g.reset()
        steps = 0
        while not g.done:
            g.step(greedy.act(g))
            steps += 1
            assert steps < 5000, "贪心对局未终止"
    check(True, "贪心智能体可完整打完 5 局")


if __name__ == "__main__":
    for fn in [test_ddz4, test_greedy_ddz4]:
        print(f"\n[{fn.__name__}]")
        fn()
    print(f"\n全部通过：共 {PASSED} 项断言 ✓")
