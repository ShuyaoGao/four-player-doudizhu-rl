/* 牌类游戏的公共基础，移植自 core/cards.py、core/shed.py。
 *
 * 牌 = {r, s}：r 点数（2..14，J=11 Q=12 K=13 A=14；斗地主系的 2 记作 15；小王 16，大王 17），
 *            s 花色 '♠' '♥' '♣' '♦'，王为 ''。
 * 排序、相等、Counter 的遍历顺序都按 Python 的语义实现（元组比较、dict 插入顺序），
 * 所以同一个种子发出的牌、生成的合法动作列表（含顺序）与 Python 版逐项相同（tests/js 核对）。
 * 依赖：PyRandom（pyrandom.js）。
 */
(function (root) {
  'use strict';
  var SUITS = ['♠', '♥', '♣', '♦'];
  var SMALL_JOKER = 16, BIG_JOKER = 17;
  var RANK_NAMES = {2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q',
    13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'};

  function card(r, s) { return {r: r, s: s}; }
  function cmpStr(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  /** Python 元组 (rank, suit) 的比较。 */
  function cmpCard(a, b) { return (a.r - b.r) || cmpStr(a.s, b.s); }
  function cardEq(a, b) { return a.r === b.r && a.s === b.s; }
  function cardKey(c) { return c.r + c.s; }
  function sortCards(cs) { return cs.slice().sort(cmpCard); }
  /** list.remove(x)：删掉第一个相等的元素。 */
  function removeCard(list, c) {
    for (var i = 0; i < list.length; i++) if (cardEq(list[i], c)) { list.splice(i, 1); return; }
    throw new Error('list.remove(x): x not in list');
  }
  function cardStr(c) { return c.r >= SMALL_JOKER ? RANK_NAMES[c.r] : c.s + RANK_NAMES[c.r]; }
  function cardsStr(cs) { return cs.map(cardStr).join(' '); }

  /** n 副牌。twoAs=15：2 记作 15（斗地主系）；=2：自然表示（升级、掼蛋）。顺序与 core.cards.deck 相同。 */
  function deck(nDecks, twoAs) {
    if (twoAs === undefined) twoAs = 15;
    var out = [];
    for (var d = 0; d < nDecks; d++) {
      SUITS.forEach(function (s) {
        for (var r = 3; r < 15; r++) out.push(card(r, s));
        out.push(card(twoAs, s));
      });
      out.push(card(SMALL_JOKER, ''));
      out.push(card(BIG_JOKER, ''));
    }
    return out;
  }

  /** collections.Counter 的最小实现：键按首次出现的顺序遍历（与 Python dict 一致）。 */
  function Counter(items) {
    this.m = new Map();
    if (items) for (var i = 0; i < items.length; i++) this.add(items[i], 1);
  }
  Counter.prototype.add = function (k, n) { this.m.set(k, (this.m.get(k) || 0) + (n === undefined ? 1 : n)); return this; };
  Counter.prototype.get = function (k) { return this.m.get(k) || 0; };
  Counter.prototype.has = function (k) { return this.m.has(k); };
  Counter.prototype.keys = function () { return Array.from(this.m.keys()); };
  Counter.prototype.copy = function () { var c = new Counter(); this.m.forEach(function (v, k) { c.m.set(k, v); }); return c; };
  Counter.prototype.subtract = function (other) { var self = this; other.m.forEach(function (v, k) { self.m.set(k, (self.m.get(k) || 0) - v); }); return this; };
  /** +counter：只保留正数，顺序不变。 */
  Counter.prototype.positive = function () { var c = new Counter(); this.m.forEach(function (v, k) { if (v > 0) c.m.set(k, v); }); return c; };
  Counter.prototype.elements = function () { var out = []; this.m.forEach(function (v, k) { for (var i = 0; i < v; i++) out.push(k); }); return out; };
  function rankCounter(cards) { return new Counter(cards.map(function (c) { return c.r; })); }
  function sortedNums(a) { return a.slice().sort(function (x, y) { return x - y; }); }

  /** (点数 × 张数档位) 的 0/1 编码，与 core.cards.MultiHot 相同。 */
  function MultiHot(ranks, maxCopies, jokerCopies) {
    this.ranks = ranks; this.maxCopies = maxCopies; this.jokerCopies = jokerCopies;
    this.dim = ranks.length * maxCopies + 2 * jokerCopies;
  }
  /** cards：牌对象数组，或点数数组。 */
  MultiHot.prototype.encode = function (cards) {
    var vec = new Array(this.dim).fill(0), cnt = {};
    cards.forEach(function (x) { var r = typeof x === 'number' ? x : x.r; cnt[r] = (cnt[r] || 0) + 1; });
    var self = this;
    this.ranks.forEach(function (r, i) {
      var c = Math.min(cnt[r] || 0, self.maxCopies), base = i * self.maxCopies;
      for (var k = 0; k < c; k++) vec[base + k] = 1;
    });
    var base = this.ranks.length * this.maxCopies;
    for (var k = 0; k < Math.min(cnt[SMALL_JOKER] || 0, this.jokerCopies); k++) vec[base + k] = 1;
    base += this.jokerCopies;
    for (k = 0; k < Math.min(cnt[BIG_JOKER] || 0, this.jokerCopies); k++) vec[base + k] = 1;
    return vec;
  };
  function onehot(i, n) { var v = new Array(n).fill(0); if (i >= 0 && i < n) v[i] = 1; return v; }

  /** itertools.combinations 的下标顺序，回调返回 false 时停止。 */
  function combinations(arr, k, cb) {
    var n = arr.length;
    if (k > n) return;
    var idx = [];
    for (var i = 0; i < k; i++) idx.push(i);
    while (true) {
      if (cb(idx.map(function (j) { return arr[j]; })) === false) return;
      var p = k - 1;
      while (p >= 0 && idx[p] === p + n - k) p--;
      if (p < 0) return;
      idx[p]++;
      for (var q = p + 1; q < k; q++) idx[q] = idx[q - 1] + 1;
    }
  }

  /**
   * CPython 3 的 set 遍历顺序（只针对小的非负整数，hash(x) = x）：开放寻址 + 线性探测 9 格 + 扰动，
   * 容量 8 起步，填充到 3/5 就扩成 used×4 以上的最小 2 的幂。掼蛋的牌型生成里有一处
   * `for r in set(...)`，要逐项复现 Python 的合法动作顺序，就得按同样的哈希表规则排出顺序。
   */
  function pySetOrder(items) {
    var LINEAR = 9, mask = 7, table = new Array(8).fill(null), fill = 0, used = 0;
    function insertClean(tbl, msk, key) {
      var perturb = key, i = key & msk;
      while (true) {
        if (tbl[i] === null) { tbl[i] = key; return; }
        if (i + LINEAR <= msk) {
          for (var j = 1; j <= LINEAR; j++) { if (tbl[i + j] === null) { tbl[i + j] = key; return; } }
        }
        perturb = Math.floor(perturb / 32);
        i = (i * 5 + 1 + perturb) & msk;
      }
    }
    function resize(minused) {
      var size = 8;
      while (size <= minused) size *= 2;
      var old = table;
      table = new Array(size).fill(null); mask = size - 1;
      old.forEach(function (k) { if (k !== null) insertClean(table, mask, k); });
      fill = used;
    }
    items.forEach(function (key) {
      var perturb = key, i = key & mask;
      while (true) {
        var probes = (i + LINEAR <= mask) ? LINEAR : 0, e = i;
        for (var p = 0; p <= probes; p++, e++) {
          if (table[e] === null) {
            table[e] = key; fill++; used++;
            if (fill * 5 >= mask * 3) resize(used > 50000 ? used * 2 : used * 4);
            return;
          }
          if (table[e] === key) return;
        }
        perturb = Math.floor(perturb / 32);
        i = (i * 5 + 1 + perturb) & mask;
      }
    });
    return table.filter(function (k) { return k !== null; });
  }

  // ================================================================ 甩牌骨架（core/shed.py）
  var PASS_KIND = 'pass';
  /** Move(kind, main, length, ranks, cards)：与 Python 的 frozen dataclass 一样按全部字段判等。 */
  function Move(kind, main, length, ranks, cards) {
    return {kind: kind, main: main === undefined ? 0 : main, length: length === undefined ? 1 : length,
      ranks: ranks || [], cards: cards || [], isPass: kind === PASS_KIND};
  }
  var PASS = Move(PASS_KIND);
  function moveSize(m) { return m.ranks.length || m.cards.length; }
  function moveKey(m) { return m.kind + '|' + m.main + '|' + m.length + '|' + m.ranks.join(',') + '|' + m.cards.map(cardKey).join(','); }
  function moveEq(a, b) { return moveKey(a) === moveKey(b); }

  /** 按点数从手牌取实体牌（优先 ♠♥♣♦ 顺序 = 手牌里先出现的那张）。 */
  function takeByRanks(hand, ranks) {
    var rest = hand.slice(), taken = [];
    ranks.forEach(function (r) {
      for (var i = 0; i < rest.length; i++) if (rest[i].r === r) { taken.push(rest.splice(i, 1)[0]); return; }
      throw new Error('手里没有点数 ' + r);
    });
    return [taken, rest];
  }

  /** 甩牌类（四人斗地主、掼蛋、保皇、够级）的公共流程。子类覆写 deal / genMoves / beats / isOver / settle 等。 */
  function ShedGame() {}
  ShedGame.prototype.firstSeat = function () { return 0; };
  ShedGame.prototype.canRespond = function () { return true; };
  ShedGame.prototype.onFinishSeat = function () {};
  ShedGame.prototype.jiefengSeat = function (lastMover) { return this._nextSeat(lastMover); };
  ShedGame.prototype._remove = function (seat, move) {
    if (move.cards.length) {
      var hand = this.hands[seat].slice();
      move.cards.forEach(function (c) { removeCard(hand, c); });
      return [move.cards.slice(), hand];
    }
    return takeByRanks(this.hands[seat], move.ranks);
  };
  ShedGame.prototype.reset = function () {
    this.deal();
    this.turn = this.firstSeat();
    this.toBeat = null;
    this.lastMover = null;
    this.passCount = 0;
    this.finished = [];
    this.lastAction = [];
    this.played = [];
    for (var s = 0; s < this.N; s++) { this.lastAction.push(PASS); this.played.push([]); }
    this.history = [];
    this.done = false;
    this.returns_ = new Array(this.N).fill(0);
    return this;
  };
  ShedGame.prototype.inPlay = function (seat) { return this.finished.indexOf(seat) < 0; };
  ShedGame.prototype.aliveCount = function () { return this.N - this.finished.length; };
  ShedGame.prototype.legalMoves = function () {
    var seat = this.turn, self = this;
    if (this.toBeat === null) return this.genMoves(seat, null);
    if (!this.canRespond(seat, this.toBeat)) return [PASS];
    return [PASS].concat(this.genMoves(seat, this.toBeat).filter(function (m) { return !m.isPass && self.beats(m, self.toBeat); }));
  };
  ShedGame.prototype._nextSeat = function (seat) {
    var s = (seat + 1) % this.N;
    while (this.finished.indexOf(s) >= 0) s = (s + 1) % this.N;
    return s;
  };
  ShedGame.prototype.step = function (move) {
    if (this.done) throw new Error('对局已结束');
    var seat = this.turn;
    this.history.push([seat, move]);
    this.lastAction[seat] = move;
    if (move.isPass) this.passCount += 1;
    else {
      var tr = this._remove(seat, move), taken = tr[0], rest = tr[1];
      this.hands[seat] = rest;
      Array.prototype.push.apply(this.played[seat], taken);
      this.toBeat = move;
      this.lastMover = seat;
      this.passCount = 0;
      if (!rest.length) {
        this.finished.push(seat);
        this.onFinishSeat(seat);
        if (this.isOver()) {
          for (var s = 0; s < this.N; s++) if (this.finished.indexOf(s) < 0) this.finished.push(s);
          this.done = true;
          this.settle();
          return this;
        }
      }
    }
    if (this.toBeat !== null) {
      if (this.finished.indexOf(this.lastMover) >= 0) {
        if (this.passCount >= this.aliveCount()) {
          this.toBeat = null; this.passCount = 0;
          this.turn = this.jiefengSeat(this.lastMover);
          return this;
        }
      } else {
        var nxt = this._nextSeat(seat);
        if (nxt === this.lastMover) {
          this.toBeat = null; this.passCount = 0;
          this.turn = this.lastMover;
          return this;
        }
      }
    }
    this.turn = this._nextSeat(seat);
    return this;
  };
  ShedGame.prototype.counts = function () { return this.hands.map(function (h) { return h.length; }); };
  ShedGame.prototype.returns = function () { return this.returns_; };
  function inherit(Child) { Child.prototype = Object.create(ShedGame.prototype); Child.prototype.constructor = Child; return Child; }

  // ================================================================ 通用智能体（agents.py）
  var BOMB_KINDS = {bomb: 1, rocket: 1, joker_bomb: 1, flush: 1};
  function minBy(arr, key) {
    var best = null, bk = null;
    arr.forEach(function (m) {
      var k = key(m);
      if (best === null || cmpTuple(k, bk) < 0) { best = m; bk = k; }
    });
    return best;
  }
  function maxBy(arr, key) {
    var best = null, bk = null;
    arr.forEach(function (m) {
      var k = key(m);
      if (best === null || cmpTuple(k, bk) > 0) { best = m; bk = k; }
    });
    return best;
  }
  function cmpTuple(a, b) {
    for (var i = 0; i < Math.min(a.length, b.length); i++) {
      var x = a[i], y = b[i];
      if (typeof x === 'boolean') x = x ? 1 : 0;
      if (typeof y === 'boolean') y = y ? 1 : 0;
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return a.length - b.length;
  }
  function RandomAgent(seed) { this.rng = new root.PyRandom(seed); this.kind = 'random'; }
  RandomAgent.prototype.act = function (game) { return this.rng.choice(game.legalMoves()); };
  /**
   * 贪心（agents.GreedyAgent）：领出打最长再最小；跟牌打最小能压的普通牌；炸弹仅在手牌 ≤8 张时用。
   * explain() 返回命中的是哪条规则（网页右栏“规则依据”用），act() 只返回着法。
   */
  function GreedyAgent() { this.kind = 'greedy'; }
  GreedyAgent.prototype.explain = function (game) {
    if (game.greedyExplain) return game.greedyExplain(game.turn);
    var legal = game.legalMoves(), nonPass = legal.filter(function (m) { return !m.isPass; });
    var leading = nonPass.length === legal.length;
    var normal = nonPass.filter(function (m) { return !BOMB_KINDS[m.kind]; });
    if (leading) {
      var pool = normal.length ? normal : nonPass;
      return {move: minBy(pool, function (m) { return [-moveSize(m), m.main]; }), rule: 'lead',
        text: '自由出牌：在' + (normal.length ? '非炸弹' : '全部') + '牌型里挑张数最多的一手，张数相同挑最小的。', pool: pool, legal: legal,
        keyOf: function (m) { return [-moveSize(m), m.main]; }, keyText: function (m) { return '张数 ' + moveSize(m) + ' · 点数 ' + RANK_NAMES[m.main]; },
        keyName: '先比张数（多的优先），再比点数（小的优先）'};
    }
    if (normal.length) return {move: minBy(normal, function (m) { return [m.main, moveSize(m)]; }), rule: 'follow',
      text: '跟牌：在能压住的普通牌型里挑最小的一手（不轻易动炸弹）。', pool: normal, legal: legal,
      keyOf: function (m) { return [m.main, moveSize(m)]; }, keyText: function (m) { return '点数 ' + RANK_NAMES[m.main] + ' · 张数 ' + moveSize(m); },
      keyName: '先比点数（小的优先），再比张数（少的优先）'};
    if (nonPass.length && game.hands[game.turn].length <= 8) return {move: minBy(nonPass, function (m) { return [moveSize(m), m.main]; }), rule: 'bomb',
      text: '普通牌压不住，但手里只剩 ' + game.hands[game.turn].length + ' 张（≤8 张）：用最小的炸弹抢出牌权。', pool: nonPass, legal: legal,
      keyOf: function (m) { return [moveSize(m), m.main]; }, keyText: function (m) { return '张数 ' + moveSize(m) + ' · 点数 ' + RANK_NAMES[m.main]; },
      keyName: '先比张数（少的优先），再比点数（小的优先）'};
    return {move: legal[0], rule: 'pass', text: nonPass.length ? '只有炸弹能压，手牌还多（>8 张）：留着炸弹，过。' : '没有能压住的牌：过。', pool: [], legal: legal};
  };
  GreedyAgent.prototype.act = function (game) { return this.explain(game).move; };

  root.CG = {
    SUITS: SUITS, SMALL_JOKER: SMALL_JOKER, BIG_JOKER: BIG_JOKER, RANK_NAMES: RANK_NAMES,
    card: card, cmpCard: cmpCard, cardEq: cardEq, cardKey: cardKey, sortCards: sortCards, removeCard: removeCard,
    cardStr: cardStr, cardsStr: cardsStr, deck: deck, Counter: Counter, rankCounter: rankCounter, sortedNums: sortedNums,
    MultiHot: MultiHot, onehot: onehot, combinations: combinations, pySetOrder: pySetOrder,
    PASS_KIND: PASS_KIND, Move: Move, PASS: PASS, moveSize: moveSize, moveKey: moveKey, moveEq: moveEq,
    takeByRanks: takeByRanks, ShedGame: ShedGame, inherit: inherit,
    BOMB_KINDS: BOMB_KINDS, minBy: minBy, maxBy: maxBy, cmpTuple: cmpTuple, RandomAgent: RandomAgent, GreedyAgent: GreedyAgent,
    GAMES: {}
  };
})(typeof window !== 'undefined' ? window : globalThis);
