# -*- coding: utf-8 -*-
"""甩牌类游戏（斗地主系/保皇/够级）共用骨架。

约定：
  - hands[seat] 是实体牌列表 [(rank,suit),...]
  - Move(kind, main, length, ranks)：ranks 为打出的点数元组；实体牌由 step 取走
  - 子类实现 deal / gen_moves / beats / is_over / settle 等钩子

轮转规则（覆盖出完牌后继续打的保皇/够级）：
  - 出牌者 last_mover 在场：下一位轮回到 last_mover 时清桌，由其自由出牌
  - last_mover 已出完（接风）：其余在场玩家连续过牌满一圈后清桌，
    由 last_mover 的下一位在场玩家自由出牌
"""

import random
from dataclasses import dataclass, field

from .cards import take_by_ranks

PASS_KIND = "pass"


@dataclass(frozen=True)
class Move:
    kind: str
    main: int = 0
    length: int = 1
    ranks: tuple = field(default_factory=tuple)
    cards: tuple = field(default_factory=tuple)   # 实体牌（花色敏感游戏用）

    @property
    def is_pass(self):
        return self.kind == PASS_KIND

    def size(self):
        return len(self.ranks) or len(self.cards)


PASS = Move(PASS_KIND)


class ShedGame:
    N = 3
    NAME = "shed"

    def __init__(self, rng=None):
        self.rng = rng or random.Random()

    # ---- 子类实现 ----
    def deal(self):                      raise NotImplementedError
    def gen_moves(self, seat, to_beat):  raise NotImplementedError
    def beats(self, move, last):         raise NotImplementedError
    def on_finish_seat(self, seat):      pass
    def is_over(self):                   raise NotImplementedError
    def settle(self):                    raise NotImplementedError
    def first_seat(self):                return 0
    def can_respond(self, seat, last):   return True   # 够级"只有对头能管"用
    def jiefeng_seat(self, last_mover):  return self._next_seat(last_mover)  # 掼蛋=对家

    def _remove(self, seat, move):
        """默认按点数取实体牌；花色敏感游戏（掼蛋）覆写为按 move.cards 精确移除。"""
        if move.cards:
            hand = list(self.hands[seat])
            for c in move.cards:
                hand.remove(c)
            return list(move.cards), hand
        return take_by_ranks(self.hands[seat], list(move.ranks))

    # ---- 公共流程 ----
    def reset(self):
        self.deal()
        self.turn = self.first_seat()
        self.to_beat = None
        self.last_mover = None
        self.pass_count = 0
        self.finished = []               # 出完牌的座位（按出完顺序）
        self.last_action = [PASS] * self.N
        self.played = [[] for _ in range(self.N)]
        self.history = []
        self.done = False
        self.returns_ = [0.0] * self.N
        return self

    def in_play(self, seat):
        return seat not in self.finished

    def alive_count(self):
        return self.N - len(self.finished)

    def legal_moves(self):
        seat = self.turn
        if self.to_beat is None:
            return self.gen_moves(seat, None)
        if not self.can_respond(seat, self.to_beat):
            return [PASS]
        return [PASS] + [m for m in self.gen_moves(seat, self.to_beat)
                         if not m.is_pass and self.beats(m, self.to_beat)]

    def _next_seat(self, seat):
        s = (seat + 1) % self.N
        while s in self.finished:
            s = (s + 1) % self.N
        return s

    def step(self, move):
        assert not self.done, "对局已结束"
        seat = self.turn
        self.history.append((seat, move))
        self.last_action[seat] = move

        if move.is_pass:
            self.pass_count += 1
        else:
            taken, rest = self._remove(seat, move)
            self.hands[seat] = rest
            self.played[seat].extend(taken)
            self.to_beat = move
            self.last_mover = seat
            self.pass_count = 0
            if not rest:
                self.finished.append(seat)
                self.on_finish_seat(seat)
                if self.is_over():
                    for s in range(self.N):       # 余者按当前顺序补入名次
                        if s not in self.finished:
                            self.finished.append(s)
                    self.done = True
                    self.settle()
                    return self

        # 决定清桌与下一位
        if self.to_beat is not None:
            if self.last_mover in self.finished:
                if self.pass_count >= self.alive_count():      # 全员过 → 接风
                    self.to_beat = None
                    self.pass_count = 0
                    self.turn = self.jiefeng_seat(self.last_mover)
                    return self
            else:
                nxt = self._next_seat(seat)
                if nxt == self.last_mover:                     # 无人压 → 清桌
                    self.to_beat = None
                    self.pass_count = 0
                    self.turn = self.last_mover
                    return self
        self.turn = self._next_seat(seat)
        return self

    # ---- 视图 ----
    def counts(self):
        return [len(h) for h in self.hands]

    def returns(self):
        return self.returns_
