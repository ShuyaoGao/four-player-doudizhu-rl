/* 四人斗地主引擎，移植自 games/ddz4.py（两副牌 108 张，1 地主 vs 3 农民）。
 * 每人 25 张、8 张底牌；牌型：单、对（含对王）、三张、三带二、顺子(≥5)、连对(≥3)、飞机(可带对)、
 * 炸弹（同点 4~8 张，张数优先）、天王炸（4 个王）。任意一家出完即结束；地主输赢为每农民三倍。
 * 依赖：CG（core.js）、PyRandom。
 */
(function (root) {
  'use strict';
  var CG = root.CG, SJ = CG.SMALL_JOKER, BJ = CG.BIG_JOKER, Move = CG.Move;
  var CHAIN_MAX = 14, MAX_COMBOS = 120;
  var ENC = new CG.MultiHot([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 8, 2);   // 108 维
  var POSITIONS = ['landlord', 'p1', 'p2', 'p3'];

  function heuristicBid(cnt) {
    var bombs = 0;
    cnt.keys().forEach(function (r) { if (r <= 15 && cnt.get(r) >= 4) bombs++; });
    var s = cnt.get(15) + 2 * cnt.get(SJ) + 2 * cnt.get(BJ) + 2 * bombs;
    return s >= 7 ? 3 : s >= 5 ? 2 : s >= 2 ? 1 : 0;
  }

  function DDZ4(rng) { this.rng = rng || new root.PyRandom(); }
  CG.inherit(DDZ4);
  DDZ4.prototype.N = 4;
  DDZ4.prototype.NAME = 'ddz4';
  DDZ4.prototype.TITLE = '四人斗地主';
  DDZ4.ENC = ENC;

  DDZ4.prototype.deal = function () {
    var cards, hands, best = null, bestBid = 0, broke = false;
    for (var t = 0; t < 20; t++) {
      cards = CG.deck(2);
      this.rng.shuffle(cards);
      hands = [0, 1, 2, 3].map(function (i) { return CG.sortCards(cards.slice(i * 25, (i + 1) * 25)); });
      var first = this.rng.randrange(4);
      best = null; bestBid = 0;
      for (var i = 0; i < 4; i++) {
        var seat = (first + i) % 4, b = heuristicBid(CG.rankCounter(hands[seat]));
        if (b > bestBid) { best = seat; bestBid = b; if (b === 3) break; }
      }
      if (best !== null) { broke = true; break; }
    }
    if (!broke) { best = 0; bestBid = 1; }
    this.hands = hands;
    this.bottom = CG.sortCards(cards.slice(100));
    this.landlord = best;
    this.base = bestBid;
    this.hands[best] = CG.sortCards(this.hands[best].concat(this.bottom));
    this.bombsPlayed = 0;
    this.playCounts = [0, 0, 0, 0];
  };
  DDZ4.prototype.firstSeat = function () { return this.landlord; };
  DDZ4.prototype.position = function (seat) { return POSITIONS[((seat - this.landlord) % 4 + 4) % 4]; };
  DDZ4.prototype.positionsList = function () { return POSITIONS.slice(); };
  DDZ4.prototype.teams = function () { var L = this.landlord; return [0, 1, 2, 3].map(function (s) { return s === L ? 0 : 1; }); };

  DDZ4.prototype.genMoves = function (seat) {
    var cnt = CG.rankCounter(this.hands[seat]), moves = [], ranks = CG.sortedNums(cnt.keys());
    ranks.forEach(function (r) {
      var c = cnt.get(r);
      moves.push(Move('single', r, 1, [r]));
      if (c >= 2) moves.push(Move('pair', r, 1, [r, r]));
      if (c >= 3 && r <= 15) moves.push(Move('trio', r, 1, [r, r, r]));
      for (var n = 4; n <= Math.min(c, 8); n++) if (r <= 15) moves.push(Move('bomb', r, n, new Array(n).fill(r)));
    });
    if (cnt.get(SJ) >= 2 && cnt.get(BJ) >= 2) moves.push(Move('rocket', BJ, 4, [SJ, SJ, BJ, BJ]));
    var pairRanks = ranks.filter(function (r) { return cnt.get(r) >= 2 && r <= 15; });
    ranks.forEach(function (r) {
      if (cnt.get(r) >= 3 && r <= 15) pairRanks.forEach(function (k) {
        if (k !== r) moves.push(Move('trio_pair', r, 1, CG.sortedNums([r, r, r, k, k])));
      });
    });
    function windows(minCount, minLen, maxLen) {
      var ok = [], okset = {}, out = [];
      for (var r = 3; r <= CHAIN_MAX; r++) if (cnt.get(r) >= minCount) { ok.push(r); okset[r] = 1; }
      ok.forEach(function (st) {
        var ln = 0;
        while (okset[st + ln]) {
          ln += 1;
          if (ln >= minLen && ln <= maxLen) { var w = []; for (var x = st; x < st + ln; x++) w.push(x); out.push(w); }
        }
      });
      return out;
    }
    function rep(a, n) { var o = []; for (var i = 0; i < n; i++) o = o.concat(a); return o; }
    windows(1, 5, 12).forEach(function (w) { moves.push(Move('straight', w[0], w.length, w.slice())); });
    windows(2, 3, 10).forEach(function (w) { moves.push(Move('pair_chain', w[0], w.length, CG.sortedNums(rep(w, 2)))); });
    windows(3, 2, 6).forEach(function (w) {
      var t = w.length, body = CG.sortedNums(rep(w, 3));
      moves.push(Move('plane', w[0], t, body));
      var avail = pairRanks.filter(function (k) { return w.indexOf(k) < 0; }), count = 0;
      CG.combinations(avail, t, function (kick) {
        moves.push(Move('plane_pair', w[0], t, CG.sortedNums(body.concat(kick, kick))));
        count++;
        return count < MAX_COMBOS;
      });
    });
    return moves;
  };
  DDZ4.prototype.beats = function (m, last) {
    if (m.kind === 'rocket') return true;
    if (last.kind === 'rocket') return false;
    if (m.kind === 'bomb') {
      if (last.kind !== 'bomb') return true;
      return CG.cmpTuple([m.length, m.main], [last.length, last.main]) > 0;
    }
    if (last.kind === 'bomb') return false;
    return m.kind === last.kind && m.length === last.length && m.main > last.main;
  };
  DDZ4.prototype.step = function (move) {
    if (!move.isPass) {
      this.playCounts[this.turn] += 1;
      if (move.kind === 'bomb' || move.kind === 'rocket') this.bombsPlayed += 1;
    }
    return CG.ShedGame.prototype.step.call(this, move);
  };
  DDZ4.prototype.isOver = function () { return this.finished.length >= 1; };
  DDZ4.prototype.settle = function () {
    var L = this.landlord, winL = this.finished[0] === L, peasantPlays = 0;
    for (var s = 0; s < 4; s++) if (s !== L) peasantPlays += this.playCounts[s];
    var spring = (winL && peasantPlays === 0) || (!winL && this.playCounts[L] === 1);
    var mult = Math.pow(2, this.bombsPlayed) * (spring ? 2 : 1), stake = this.base * mult;
    this.spring = spring; this.multiplier = mult;
    for (s = 0; s < 4; s++) this.returns_[s] = s === L ? (winL ? 3 : -3) * stake : (winL ? -1 : 1) * stake;
  };

  // ------------------------------------------------ RL 编码（与 encode_state / encode_action 逐位一致）
  var FEATURE_GROUPS = [
    {key: 'my_hand', name: '我的手牌', dim: 108, kind: 'cards'},
    {key: 'unseen', name: '没见过的牌（其余三家手牌之和）', dim: 108, kind: 'cards'},
    {key: 'to_beat', name: '当前要压的牌', dim: 108, kind: 'cards'},
    {key: 'bottom', name: '底牌', dim: 108, kind: 'cards'},
    {key: 'last_1', name: '我的下家最近一手', dim: 108, kind: 'cards'},
    {key: 'last_2', name: '我的对家最近一手', dim: 108, kind: 'cards'},
    {key: 'last_3', name: '我的上家最近一手', dim: 108, kind: 'cards'},
    {key: 'played_landlord', name: '地主已出的牌', dim: 108, kind: 'cards'},
    {key: 'played_p1', name: '农民一（地主下家）已出的牌', dim: 108, kind: 'cards'},
    {key: 'played_p2', name: '农民二（地主对家）已出的牌', dim: 108, kind: 'cards'},
    {key: 'played_p3', name: '农民三（地主上家）已出的牌', dim: 108, kind: 'cards'},
    {key: 'left_1', name: '我的下家剩余张数', dim: 33, kind: 'onehot', base: 1},
    {key: 'left_2', name: '我的对家剩余张数', dim: 33, kind: 'onehot', base: 1},
    {key: 'left_3', name: '我的上家剩余张数', dim: 33, kind: 'onehot', base: 1},
    {key: 'bombs', name: '已出炸弹数', dim: 8, kind: 'onehot', base: 0},
    {key: 'action', name: '候选动作（这一手要出的牌）', dim: 108, kind: 'cards'}
  ];
  (function () { var off = 0; FEATURE_GROUPS.forEach(function (g) { g.offset = off; off += g.dim; }); })();
  /** 108 维牌组里第 i 维：13 个点数（3..2）× 8 个张数档位，然后小王 2 档、大王 2 档。 */
  function cardDim(i) {
    if (i < 104) return {rank: 3 + Math.floor(i / 8), copy: (i % 8) + 1};
    if (i < 106) return {rank: SJ, copy: i - 104 + 1};
    return {rank: BJ, copy: i - 106 + 1};
  }
  function featureName(d) {
    for (var gi = 0; gi < FEATURE_GROUPS.length; gi++) {
      var g = FEATURE_GROUPS[gi];
      if (d >= g.offset && d < g.offset + g.dim) {
        var i = d - g.offset;
        if (g.kind === 'cards') { var cd = cardDim(i); return g.name + '·' + CG.RANK_NAMES[cd.rank] + '·第' + cd.copy + '张'; }
        var v = i + g.base;
        return g.name + '=' + (g.key === 'bombs' && i === g.dim - 1 ? v + '及以上' : String(v));
      }
    }
    return '?';
  }
  DDZ4.prototype.encodeState = function (seat) {
    var E = ENC, f = [], self = this;
    f = f.concat(E.encode(this.hands[seat]));
    var unseen = CG.rankCounter(CG.deck(2));
    unseen.subtract(CG.rankCounter(this.hands[seat]));
    this.played.forEach(function (p) { unseen.subtract(CG.rankCounter(p)); });
    f = f.concat(E.encode(unseen.positive().elements()));
    f = f.concat(E.encode(this.toBeat ? this.toBeat.ranks : []));
    f = f.concat(E.encode(this.bottom));
    for (var d = 1; d < 4; d++) { var a = this.lastAction[(seat + d) % 4]; f = f.concat(E.encode(a.isPass ? [] : a.ranks)); }
    for (d = 0; d < 4; d++) f = f.concat(E.encode(this.played[(this.landlord + d) % 4]));
    for (d = 1; d < 4; d++) f = f.concat(CG.onehot(self.hands[(seat + d) % 4].length - 1, 33));
    f = f.concat(CG.onehot(Math.min(this.bombsPlayed, 7), 8));
    return f;
  };
  DDZ4.encodeAction = function (move) { return move.isPass ? new Array(ENC.dim).fill(0) : ENC.encode(move.ranks); };
  DDZ4.prototype.encodeAction = DDZ4.encodeAction;

  DDZ4.FEATURE_GROUPS = FEATURE_GROUPS;
  DDZ4.featureName = featureName;
  DDZ4.cardDim = cardDim;
  DDZ4.heuristicBid = heuristicBid;
  DDZ4.POSITIONS = POSITIONS;
  CG.GAMES.ddz4 = DDZ4;
  root.DDZ4 = DDZ4;
})(typeof window !== 'undefined' ? window : globalThis);
