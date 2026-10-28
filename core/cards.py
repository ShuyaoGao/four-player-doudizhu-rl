# -*- coding: utf-8 -*-
"""统一的牌基础设施：多副牌、花色、点数顺序。

牌 = (rank, suit) 元组：
  rank: 2..14 (J=11 Q=12 K=13 A=14)，小王=16，大王=17
  suit: '♠' '♥' '♣' '♦'，王为 ''
注意：不同游戏的"2"地位不同——斗地主/保皇/够级里 2 是大牌（用 15 表示），
升级/掼蛋里 2 是自然最小（用 2 表示）。由各游戏引擎自行选择表示。
"""

import random
from collections import Counter

SUITS = ["♠", "♥", "♣", "♦"]
SMALL_JOKER = 16
BIG_JOKER = 17

RANK_NAMES = {2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
              10: "10", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2",
              SMALL_JOKER: "小王", BIG_JOKER: "大王"}


def deck(n_decks=1, two_as=15):
    """生成 n 副牌。two_as=15 时 2 用 15 表示（斗地主系），=2 时自然表示（升级系）。"""
    cards = []
    for _ in range(n_decks):
        for s in SUITS:
            for r in range(3, 15):
                cards.append((r, s))
            cards.append((two_as, s))
        cards.append((SMALL_JOKER, ""))
        cards.append((BIG_JOKER, ""))
    return cards


def card_str(c):
    r, s = c
    return RANK_NAMES[r] if r >= SMALL_JOKER else f"{s}{RANK_NAMES[r]}"


def cards_str(cards):
    return " ".join(card_str(c) for c in cards)


def rank_counter(cards):
    """按点数计数（忽略花色）。"""
    return Counter(r for r, _ in cards)


def sort_hand(cards, order=None):
    """手牌排序：order 是 rank→排序值 的函数，默认按 rank 数值。大牌在前。"""
    key = order or (lambda r: r)
    return sorted(cards, key=lambda c: (-key(c[0]), SUITS.index(c[1]) if c[1] else -1))


def take_by_ranks(hand, ranks):
    """从手牌按点数列表取走实体牌（优先 ♠♥♣♦ 顺序），返回 (取走列表, 剩余列表)。"""
    hand = list(hand)
    taken = []
    for r in ranks:
        i = next(i for i, c in enumerate(hand) if c[0] == r)
        taken.append(hand.pop(i))
    return taken, hand


class MultiHot:
    """把一手牌编码成 (点数 × 张数档位) 的 0/1 向量，供 RL 状态用。

    max_copies: 同点数最多几张（1副=4, 2副=8, 4副=16；王分别 1/2/4）。
    """

    def __init__(self, ranks, max_copies, joker_copies):
        self.ranks = list(ranks)
        self.max_copies = max_copies
        self.joker_copies = joker_copies
        self.dim = len(self.ranks) * max_copies + 2 * joker_copies

    def encode(self, cards):
        vec = [0.0] * self.dim
        cnt = rank_counter(cards) if cards and isinstance(cards[0], tuple) else Counter(cards)
        for i, r in enumerate(self.ranks):
            c = min(cnt.get(r, 0), self.max_copies)
            base = i * self.max_copies
            for k in range(c):
                vec[base + k] = 1.0
        base = len(self.ranks) * self.max_copies
        for k in range(min(cnt.get(SMALL_JOKER, 0), self.joker_copies)):
            vec[base + k] = 1.0
        base += self.joker_copies
        for k in range(min(cnt.get(BIG_JOKER, 0), self.joker_copies)):
            vec[base + k] = 1.0
        return vec


def onehot(i, n):
    v = [0.0] * n
    if 0 <= i < n:
        v[i] = 1.0
    return v
