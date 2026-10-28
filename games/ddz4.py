# -*- coding: utf-8 -*-
"""四人斗地主：两副牌 108 张，1 地主 vs 3 农民。

规则要点（按主流四人玩法）：
  - 每人 25 张，8 张底牌归地主（亮明）；叫分 1/2/3 定地主，全不叫重发
  - 牌型：单、对（含对王）、三张(不带)、三带二、顺子(≥5,3~A)、连对(≥3)、
    飞机(≥2组,可不带或每组带一对)、炸弹、天王炸
  - 炸弹 = 同点 4~8 张：张数多者大，张数同比点数；天王炸(4 个王)最大
  - 不设三带一/四带二（4 张同点即炸弹，不可拆带）
  - 任意一家出完即结束：地主出完地主胜，否则农民胜
  - 计分：底分 × 2^炸弹数 × 春天(×2)；地主输赢为每农民三倍
"""

from collections import Counter
from itertools import combinations, islice

from core.cards import deck, rank_counter, MultiHot, onehot, SMALL_JOKER, BIG_JOKER
from core.shed import ShedGame, Move, PASS

CHAIN_MAX = 14          # 顺子/连对/飞机最高到 A
MAX_COMBOS = 120


def heuristic_bid(counts):
    bombs = sum(1 for r, c in counts.items() if r <= 15 and c >= 4)
    s = (counts.get(15, 0) + 2 * counts.get(SMALL_JOKER, 0)
         + 2 * counts.get(BIG_JOKER, 0) + 2 * bombs)
    return 3 if s >= 7 else 2 if s >= 5 else 1 if s >= 2 else 0


class DDZ4(ShedGame):
    N = 4
    NAME = "ddz4"
    TITLE = "四人斗地主"
    TEAM_DESC = "1 地主 vs 3 农民"
    ENC = MultiHot(range(3, 16), 8, 2)          # 108 维

    # ------------------------------------------------ 发牌与叫分
    def deal(self):
        for _ in range(20):
            cards = deck(2)
            self.rng.shuffle(cards)
            hands = [sorted(cards[i * 25:(i + 1) * 25]) for i in range(4)]
            first = self.rng.randrange(4)
            best, best_bid = None, 0
            for i in range(4):
                seat = (first + i) % 4
                b = heuristic_bid(rank_counter(hands[seat]))
                if b > best_bid:
                    best, best_bid = seat, b
                    if b == 3:
                        break
            if best is not None:
                break
        else:
            best, best_bid = 0, 1
        self.hands = hands
        self.bottom = sorted(cards[100:])
        self.landlord = best
        self.base = best_bid
        self.hands[best] = sorted(self.hands[best] + self.bottom)
        self.bombs_played = 0
        self.play_counts = [0] * 4

    def first_seat(self):
        return self.landlord

    def position(self, seat):
        return ("landlord", "p1", "p2", "p3")[(seat - self.landlord) % 4]

    def teams(self):
        return [0 if s == self.landlord else 1 for s in range(4)]

    # ------------------------------------------------ 牌型生成
    def gen_moves(self, seat, to_beat):
        cnt = rank_counter(self.hands[seat])
        moves = []
        ranks = sorted(cnt)

        for r in ranks:
            c = cnt[r]
            moves.append(Move("single", r, 1, (r,)))
            if c >= 2:
                moves.append(Move("pair", r, 1, (r, r)))
            if c >= 3 and r <= 15:
                moves.append(Move("trio", r, 1, (r, r, r)))
            for n in range(4, min(c, 8) + 1):       # 炸弹 4~8 张
                if r <= 15:
                    moves.append(Move("bomb", r, n, (r,) * n))

        if cnt.get(SMALL_JOKER, 0) >= 2 and cnt.get(BIG_JOKER, 0) >= 2:
            moves.append(Move("rocket", BIG_JOKER, 4,
                              (SMALL_JOKER, SMALL_JOKER, BIG_JOKER, BIG_JOKER)))

        pair_ranks = [r for r in ranks if cnt[r] >= 2 and r <= 15]
        for r in ranks:                              # 三带二
            if cnt[r] >= 3 and r <= 15:
                for k in pair_ranks:
                    if k != r:
                        moves.append(Move("trio_pair", r, 1,
                                          tuple(sorted((r, r, r, k, k)))))

        def windows(min_count, min_len, max_len):
            ok = [r for r in range(3, CHAIN_MAX + 1) if cnt.get(r, 0) >= min_count]
            okset = set(ok)
            out = []
            for st in ok:
                ln = 0
                while st + ln in okset:
                    ln += 1
                    if min_len <= ln <= max_len:
                        out.append(tuple(range(st, st + ln)))
            return out

        for w in windows(1, 5, 12):
            moves.append(Move("straight", w[0], len(w), w))
        for w in windows(2, 3, 10):
            moves.append(Move("pair_chain", w[0], len(w), tuple(sorted(w * 2))))
        for w in windows(3, 2, 6):
            t = len(w)
            body = tuple(sorted(w * 3))
            moves.append(Move("plane", w[0], t, body))
            avail = [k for k in pair_ranks if k not in w]
            for kick in islice(combinations(avail, t), MAX_COMBOS):
                moves.append(Move("plane_pair", w[0], t,
                                  tuple(sorted(body + tuple(kick) * 2))))
        return moves

    def beats(self, m, last):
        if m.kind == "rocket":
            return True
        if last.kind == "rocket":
            return False
        if m.kind == "bomb":
            if last.kind != "bomb":
                return True
            return (m.length, m.main) > (last.length, last.main)
        if last.kind == "bomb":
            return False
        return (m.kind == last.kind and m.length == last.length
                and m.main > last.main)

    # ------------------------------------------------ 结算
    def step(self, move):
        if not move.is_pass:
            self.play_counts[self.turn] += 1
            if move.kind in ("bomb", "rocket"):
                self.bombs_played += 1
        return super().step(move)

    def is_over(self):
        return len(self.finished) >= 1

    def settle(self):
        winner_landlord = self.finished[0] == self.landlord
        peasant_plays = sum(self.play_counts[s] for s in range(4) if s != self.landlord)
        spring = (winner_landlord and peasant_plays == 0) or \
                 (not winner_landlord and self.play_counts[self.landlord] == 1)
        mult = (2 ** self.bombs_played) * (2 if spring else 1)
        stake = self.base * mult
        self.spring, self.multiplier = spring, mult
        for s in range(4):
            if s == self.landlord:
                self.returns_[s] = (3 if winner_landlord else -3) * stake
            else:
                self.returns_[s] = (-1 if winner_landlord else 1) * stake

    # ------------------------------------------------ RL 编码
    def encode_state(self, seat):
        E = self.ENC
        feats = []
        feats += E.encode(self.hands[seat])
        unseen = Counter(r for r, _ in deck(2))
        unseen.subtract(rank_counter(self.hands[seat]))
        for p in self.played:
            unseen.subtract(rank_counter(p))
        feats += E.encode(list((+unseen).elements()))
        feats += E.encode([(r, "") for r in (self.to_beat.ranks if self.to_beat else ())])
        feats += E.encode(self.bottom)
        for d in range(1, 4):
            a = self.last_action[(seat + d) % 4]
            feats += E.encode([(r, "") for r in (a.ranks if not a.is_pass else ())])
        for d in range(4):
            feats += E.encode(self.played[(self.landlord + d) % 4])
        for d in range(1, 4):
            feats += onehot(len(self.hands[(seat + d) % 4]) - 1, 33)
        feats += onehot(min(self.bombs_played, 7), 8)
        return feats

    @classmethod
    def encode_action(cls, move):
        if move.is_pass:
            return [0.0] * cls.ENC.dim
        return cls.ENC.encode([(r, "") for r in move.ranks])

    def positions_list(self):
        return ["landlord", "p1", "p2", "p3"]
