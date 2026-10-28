/* 浏览器端 Q 网络前向（由 doudizhu-dmc-lab 的 nn.js 改写：动作编码改为由调用方传入，适用于任意游戏）。
 * 结构从 window.DDZ_MODEL（tools/export_model.py 生成）读出：Linear → ReLU → … → Linear(→1)。
 * 与 PyTorch 的一致性由 tests/js/test_parity.js 锁住（同一批局面逐个候选比 Q 值）。
 */
(function (root) {
  'use strict';

  function halfToFloat(h) {
    var s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  function b64ToBytes(b64) {
    var bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** 把 DDZ_MODEL 解码成 {landlord: net, down: net, up: net}；net.layers[i] = {W, b, in, out}。 */
  function loadModel(model) {
    var bytes = b64ToBytes(model.b64), n = bytes.length / 2;
    var lut = new Float32Array(65536);
    for (var h = 0; h < 65536; h++) lut[h] = halfToFloat(h);
    var vals = new Float32Array(n);
    for (var i = 0; i < n; i++) vals[i] = lut[bytes[2 * i] | (bytes[2 * i + 1] << 8)];
    var nets = {};
    model.positions.forEach(function (pos) {
      var spec = model.nets[pos];
      nets[pos] = {
        position: pos, params: spec.params,
        layers: spec.layers.map(function (L) {
          return {name: L.name, in: L.in, out: L.out,
            W: vals.subarray(L.w, L.w + L.in * L.out), b: vals.subarray(L.b, L.b + L.out)};
        })
      };
    });
    return nets;
  }

  /** 结构描述：['输入 588', '隐藏 512', ...]，从网络实际形状读出。 */
  function describe(net) {
    var L = net.layers;
    return {input: L[0].in, hidden: L.slice(0, -1).map(function (l) { return l.out; }),
      output: L[L.length - 1].out, params: net.params};
  }

  /**
   * 对全部候选动作打分。state: 状态向量；actions: 每个候选动作的编码向量（数组的数组）。
   * 共享计算：第一层里“状态部分”对所有候选相同，先算一次，候选只需再加上它那几张牌的列。
   * masks（可选）：{1: Float32Array(512), 2: ..., 3: ...}，0 表示该神经元被“敲掉”。
   * 返回 Float64Array(q)。
   */
  function scoreAll(net, state, moves, masks) {
    var L = net.layers, L1 = L[0], inDim = L1.in, H1 = L1.out, sDim = state.length;
    var base = new Float64Array(H1), i, j, k;
    var active = [];
    for (j = 0; j < sDim; j++) if (state[j] !== 0) active.push(j);
    for (i = 0; i < H1; i++) {
      var s = L1.b[i], row = i * inDim;
      for (k = 0; k < active.length; k++) s += L1.W[row + active[k]] * state[active[k]];
      base[i] = s;
    }
    var q = new Float64Array(moves.length);
    for (var m = 0; m < moves.length; m++) {
      var a = moves[m], h = new Float64Array(H1);
      var aAct = [];
      for (j = 0; j < a.length; j++) if (a[j] !== 0) aAct.push(j);
      for (i = 0; i < H1; i++) {
        var v = base[i], r = i * inDim + sDim;
        for (k = 0; k < aAct.length; k++) v += L1.W[r + aAct[k]];
        v = v > 0 ? v : 0;
        if (masks && masks[1]) v *= masks[1][i];
        h[i] = v;
      }
      for (var li = 1; li < L.length; li++) {
        var Ln = L[li], o = new Float64Array(Ln.out), last = li === L.length - 1;
        for (i = 0; i < Ln.out; i++) {
          var acc = Ln.b[i], rr = i * Ln.in;
          for (j = 0; j < Ln.in; j++) acc += Ln.W[rr + j] * h[j];
          if (!last) { acc = acc > 0 ? acc : 0; if (masks && masks[li + 1]) acc *= masks[li + 1][i]; }
          o[i] = acc;
        }
        h = o;
      }
      q[m] = h[0];
    }
    return q;
  }

  /**
   * 单个候选的完整前向 + 反向（大脑面板用）：返回每层激活、每个神经元对 Q 的贡献（激活 × 梯度），
   * 以及每一维输入的“梯度 × 输入”归因。只是模型内部的相关性解释，不代表因果。
   */
  function explain(net, state, action, masks) {
    var L = net.layers, x = state.concat(action), acts = [], pre = [], h = x, i, j;
    for (var li = 0; li < L.length; li++) {
      var Ln = L[li], o = new Float64Array(Ln.out), p = new Float64Array(Ln.out), last = li === L.length - 1;
      for (i = 0; i < Ln.out; i++) {
        var acc = Ln.b[i], rr = i * Ln.in;
        for (j = 0; j < Ln.in; j++) if (h[j] !== 0) acc += Ln.W[rr + j] * h[j];
        p[i] = acc;
        if (!last) { acc = acc > 0 ? acc : 0; if (masks && masks[li + 1]) acc *= masks[li + 1][i]; }
        o[i] = acc;
      }
      pre.push(p); acts.push(o); h = o;
    }
    var q = h[0];
    // 反向：dq/d(激活)
    var grads = new Array(L.length);   // grads[li] = dq/d acts[li]
    grads[L.length - 1] = new Float64Array([1]);
    for (li = L.length - 1; li >= 1; li--) {
      var Lc = L[li], gOut = grads[li], gIn = new Float64Array(Lc.in);
      for (i = 0; i < Lc.out; i++) {
        var gi = gOut[i];
        if (li !== L.length - 1) {          // 经过 ReLU（与掩码）
          if (pre[li][i] <= 0) gi = 0;
          if (masks && masks[li + 1]) gi *= masks[li + 1][i];
        }
        if (gi === 0) continue;
        var rr2 = i * Lc.in;
        for (j = 0; j < Lc.in; j++) gIn[j] += Lc.W[rr2 + j] * gi;
      }
      grads[li - 1] = gIn;
    }
    // 输入梯度
    var L0 = L[0], g0 = grads[0], gx = new Float64Array(L0.in);
    for (i = 0; i < L0.out; i++) {
      var g = g0[i];
      if (pre[0][i] <= 0) g = 0;
      if (masks && masks[1]) g *= masks[1][i];
      if (g === 0) continue;
      var r0 = i * L0.in;
      for (j = 0; j < L0.in; j++) gx[j] += L0.W[r0 + j] * g;
    }
    var attr = new Float64Array(x.length);
    for (j = 0; j < x.length; j++) attr[j] = x[j] * gx[j];
    var hidden = [];
    for (li = 0; li < L.length - 1; li++) {
      var c = new Float64Array(acts[li].length);
      for (i = 0; i < c.length; i++) c[i] = acts[li][i] * grads[li][i];
      hidden.push({act: acts[li], pre: pre[li], contrib: c, size: acts[li].length});
    }
    return {x: x, q: q, hidden: hidden, attr: attr};
  }

  /** DMC 智能体（rl_dmc.DMCAgent）：对每个合法动作算 Q，取最大；加 1e-3 微噪声打破并列。 */
  function DMCAgent(nets, rnd) { this.nets = nets; this.rnd = rnd; this.kind = 'dmc'; }
  DMCAgent.prototype.scores = function (game, legal, masks) {
    var seat = game.turn, state = game.encodeState(seat);
    return scoreAll(this.nets[game.position(seat)], state, legal.map(function (m) { return game.encodeAction(m); }), masks);
  };
  DMCAgent.prototype.pick = function (q) {
    var best = 0, bv = -Infinity;
    for (var i = 0; i < q.length; i++) { var v = q[i] + 1e-3 * this.rnd(); if (v > bv) { bv = v; best = i; } }
    return best;
  };
  DMCAgent.prototype.act = function (game, masks) {
    var legal = game.legalMoves();
    if (legal.length === 1) return legal[0];
    return legal[this.pick(this.scores(game, legal, masks))];
  };

  root.DDZNN = {halfToFloat: halfToFloat, loadModel: loadModel, describe: describe,
    scoreAll: scoreAll, explain: explain, DMCAgent: DMCAgent};
})(typeof window !== 'undefined' ? window : globalThis);
