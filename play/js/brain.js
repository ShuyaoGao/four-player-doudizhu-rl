/* 大脑面板（由 doudizhu-dmc-lab 的 brain.js 改写为 N 个智能体通用）：用真实权重在浏览器里前向，
 * 画出每个身份那张 Q 网络当前这一刻的激活。身份、输入分组、牌组方阵的布局都由 window.BRAIN_CFG 提供：
 *   roles / roleZh / roleColor / groups（= encode_state 的拼接顺序）/ short / featureName / encodeAction / moveText / cardCell
 * 结构式、每层个数全部从模型读出。依赖：DDZNN（nn.js）。由 app.js 调用 Brain.init(ctx)。
 */
(function (root) {
  'use strict';
  var NN = root.DDZNN, CFG = root.BRAIN_CFG;
  var ROLES = CFG.roles;
  var ROLE_ZH = CFG.roleZh;
  var ROLE_COLOR = CFG.roleColor;
  var FG0 = CFG.groups;
  var POS = '255,159,26', NEG = '77,171,247';
  var SHORT = CFG.short;
  var K_SHOW = [32, 16, 16];          // 每个隐藏层展开的神经元个数
  var HEAT_COLS = [32, 16, 16];       // 全层热力方阵的列数（512 → 32×16，256 → 16×16，128 → 16×8）
  var Q_RANGE = 1.3;

  var ctx = null, nets = null, el = {};
  var S = {view: 'landlord', follow: true, sel: {landlord: null, down: null, up: null},
    cand: {}, reveal: {}, expanded: false, masks: null, hits: [], hover: null};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function fmt(v, d) { return (v >= 0 ? '+' : '') + v.toFixed(d === undefined ? 3 : d); }
  function moveText(m) { return CFG.moveText(m); }
  function newMasks() {
    var m = {};
    ROLES.forEach(function (r) {
      var L = nets[r].layers;
      m[r] = {};
      for (var i = 0; i < L.length - 1; i++) {
        var a = new Float32Array(L[i].out); a.fill(1); m[r][i + 1] = a;
      }
    });
    return m;
  }
  function knockedCount(role) {
    var n = 0, m = S.masks[role];
    Object.keys(m).forEach(function (k) { for (var i = 0; i < m[k].length; i++) if (m[k][i] === 0) n++; });
    return n;
  }
  function masksFor(role) { return knockedCount(role) ? S.masks[role] : null; }

  // ------------------------------------------------------------------ 数据
  function roleDecisions(role) { return ctx.decisions().filter(function (d) { return d.role === role; }); }
  function currentDecision(role) {
    var ds = roleDecisions(role);
    if (!ds.length) return null;
    var id = S.sel[role];
    if (id === null) return ds[ds.length - 1];
    for (var i = 0; i < ds.length; i++) if (ds[i].id === id) return ds[i];
    return ds[ds.length - 1];
  }
  function argmax(q) { var b = 0; for (var i = 1; i < q.length; i++) if (q[i] > q[b]) b = i; return b; }
  /** 当前掩码下的 Q（没敲掉神经元时就是决策时记下的 q0）。 */
  function liveQ(d) {
    var mk = masksFor(d.role);
    if (!mk) return d.q0;
    if (!d._qm || d._qmVer !== S.maskVer) {
      d._qm = NN.scoreAll(nets[d.role], d.state, d.legal.map(CFG.encodeAction), mk);
      d._qmVer = S.maskVer;
    }
    return d._qm;
  }
  function candOf(d) {
    var c = S.cand[d.id];
    if (c !== undefined && c < d.legal.length) return c;
    if (d.chosen !== null && d.chosen >= 0) return d.chosen;
    return argmax(liveQ(d));
  }
  function explainOf(d) {
    var c = candOf(d), key = c + '|' + S.maskVer;
    if (d._exKey !== key) { d._ex = NN.explain(nets[d.role], d.state, CFG.encodeAction(d.legal[c]), masksFor(d.role)); d._exKey = key; }
    return d._ex;
  }

  // ------------------------------------------------------------------ 顶部：标签、结构式
  function renderTabs() {
    var html = ROLES.map(function (r) {
      var lk = ctx.locked(r) ? ' 🔒' : '';
      var who = ctx.roleSeatName(r);
      return '<button class="btab ' + r + (S.view === r ? ' active' : '') + '" data-view="' + r + '">' +
        ROLE_ZH[r] + (who ? '<span class="muted small">（' + esc(who) + '）</span>' : '') + lk + '</button>';
    }).join('') + '<button class="btab' + (S.view === 'all' ? ' active' : '') + '" data-view="all">全部</button>';
    el.tabs.innerHTML = html;
  }

  function renderStruct() {
    var d = NN.describe(nets[ROLES[0]]), FG = FG0, sDim = FG[FG.length - 1].offset;
    var total = ROLES.reduce(function (s, r) { return s + nets[r].params; }, 0);
    el.struct.innerHTML = '结构式：<b>输入 ' + d.input + '</b>（状态 ' + sDim + ' + 候选动作 ' + (d.input - sDim) + '）→ ' +
      d.hidden.map(function (h, i) { return '<b>隐藏 ' + h + '</b>'; }).join(' → ') +
      ' → <b>输出 ' + d.output + ' 个 Q 值</b>（每个候选出牌算一次）　参数 <b>' + d.params.toLocaleString('en-US') +
      '</b> × ' + ROLES.length + ' 张网络 = ' + total.toLocaleString('en-US');
  }

  function renderNav() {
    var single = S.view !== 'all';
    el.decNav.style.visibility = single ? 'visible' : 'hidden';
    var n = 0;
    ROLES.forEach(function (r) { n += knockedCount(r); });
    el.restore.textContent = '恢复神经元' + (n ? '（' + n + '）' : '');
    el.restore.disabled = n === 0;
    if (!single) return;
    var ds = roleDecisions(S.view), d = currentDecision(S.view);
    var k = d ? ds.indexOf(d) + 1 : 0;
    el.decLabel.textContent = ds.length ? '第 ' + k + ' / ' + ds.length + ' 次决策' : '还没有决策';
    el.prev.disabled = k <= 1;
    el.next.disabled = k >= ds.length;
  }

  // ------------------------------------------------------------------ 单个大脑
  function renderSingle(role) {
    var body = el.body, d = currentDecision(role);
    var lock = ctx.locked(role);
    if (lock) {
      body.innerHTML = '<div class="lock"><div class="inner"><div class="big">🔒</div><b>' + ROLE_ZH[role] +
        ' 的大脑在本局结束前锁住</b><br>' + esc(lock) + '</div></div>';
      return;
    }
    if (!d) { body.innerHTML = '<div class="empty">' + ctx.emptyText(role) + '</div>'; return; }
    if (d.pending && !S.reveal[d.id]) {
      body.innerHTML = headHTML(d) + '<div class="preview-cover">轮到你出牌。你这个身份（<b>' + ROLE_ZH[role] +
        '</b>）的网络已经给你的 <b>' + d.legal.length + '</b> 个合法出牌打好了分。<br>' +
        '<button class="btn primary" id="reveal-btn">看看网络怎么想（等同于 💡 提示）</button><br>' +
        '<span class="muted small">它只用你能看到的信息：自己的手牌、桌面上出过的牌、底牌和剩余张数；看不到对手的牌，所以是公平的。</span></div>';
      $('reveal-btn').onclick = function () { S.reveal[d.id] = true; ctx.task('hint'); ctx.onReveal(d); render(); };
      return;
    }
    var q = liveQ(d), best = argmax(q), c = candOf(d);
    var html = headHTML(d) +
      '<canvas class="brain-canvas" id="net-canvas"></canvas>' +
      '<div class="legend">输入方阵：亮格 = 这一维是 1；<i style="background:rgb(' + POS + ')"></i>让 Q 变高 <i style="background:rgb(' + NEG + ')"></i>让 Q 变低（梯度 × 输入，这是模型内部的相关性解释，不代表因果）。' +
      '神经元：<i style="background:rgb(' + POS + ')"></i>激活（加权和 &gt; 0）<i style="background:rgb(' + NEG + ')"></i>没激活（ReLU 后为 0），圆点越大对这一手的 Q 贡献越大；点圆点或方阵格子 = 敲掉。</div>' +
      '<div class="brain-lower"><div class="outlist">' + outListHTML(d, q, best, c) + '</div>' +
      '<div class="valuebox"><div class="small">自评局势：本次决策的最高 Q = <b>' + fmt(q[best]) + '</b></div>' +
      '<canvas id="value-canvas"></canvas><div class="legend">训练目标是“赢 = +1，输 = −1”，所以 Q 大致是网络对“这样出之后能不能赢”的估计；没有校准，不能直接当胜率读。</div></div></div>';
    body.innerHTML = html;
    bindOutList(d);
    drawNet($('net-canvas'), d);
    drawValue($('value-canvas'), [role], d);
  }

  function headHTML(d) {
    var role = d.role, real = d.chosen !== null && d.chosen >= 0 ? moveText(d.legal[d.chosen]) : '（还没出）';
    return '<div class="brain-head"><span class="who" style="color:' + ROLE_COLOR[role] + '">' + ROLE_ZH[role] + ' 的大脑</span>' +
      '<span>出牌方：' + esc(d.actorName) + '</span><span>候选 <b>' + d.legal.length + '</b> 个</span>' +
      '<span>实际出：<b>' + esc(real) + '</b></span>' +
      (knockedCount(role) ? '<span class="tag best">已敲掉 ' + knockedCount(role) + ' 个神经元</span>' : '') + '</div>';
  }

  function outListHTML(d, q, best, c) {
    var order = [];
    for (var i = 0; i < q.length; i++) order.push(i);
    order.sort(function (a, b) { return q[b] - q[a]; });
    var limit = S.expanded ? order.length : Math.min(order.length, 8);
    var origBest = argmax(d.q0);
    var note = '';
    if (masksFor(d.role) && origBest !== best)
      note = '<span class="tag real">敲掉前首选：' + esc(moveText(d.legal[origBest])) + '</span>';
    var rows = order.slice(0, limit).map(function (i, k) {
      var v = q[i], w = Math.min(1, Math.abs(v) / Q_RANGE) * 50;
      var bar = v >= 0 ? '<i style="left:50%;width:' + w + '%;background:rgb(' + POS + ')"></i>'
                       : '<i style="right:50%;width:' + w + '%;background:rgb(' + NEG + ')"></i>';
      var tags = (i === best ? '<span class="tag best">网络首选</span>' : '') +
                 (i === d.chosen ? '<span class="tag real">实际出的</span>' : '');
      return '<div class="orow' + (i === c ? ' selc' : '') + '" data-c="' + i + '"><span class="muted">' + (k + 1) + '</span>' +
        '<span class="mv" title="' + esc(moveText(d.legal[i])) + '">' + esc(moveText(d.legal[i])) + tags + '</span>' +
        '<span class="bar"><span class="zero"></span>' + bar + '</span><span class="val">' + fmt(v) + '</span></div>';
    }).join('');
    var more = order.length > 8 ? '<div class="more" id="more-btn">' + (S.expanded ? '收起' : '展开其余 ' + (order.length - 8) + ' 个') + '</div>' : '';
    return '<div class="oh" data-tip="cand">输出：<b>' + q.length + '</b> 个候选出牌各自的 Q（点一行，中间就显示给这一手打分时的激活）' + note + '</div>' + rows + more;
  }

  function bindOutList(d) {
    Array.prototype.forEach.call(el.body.querySelectorAll('.orow'), function (row) {
      row.onclick = function () { S.cand[d.id] = +row.getAttribute('data-c'); ctx.task('cand'); render(); };
    });
    var more = $('more-btn');
    if (more) more.onclick = function () { S.expanded = !S.expanded; render(); };
  }

  // ------------------------------------------------------------------ 画网络（单个模式）
  function setupCanvas(cv, h) {
    var w = cv.parentNode.clientWidth || 600, dpr = root.devicePixelRatio || 1;
    cv.style.height = h + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return {g: g, w: w, h: h};
  }
  function actColor(p, maxp, knocked) {
    if (knocked) return '#555';
    var a = Math.min(1, Math.abs(p) / (maxp || 1));
    return 'rgba(' + (p > 0 ? POS : NEG) + ',' + (0.15 + 0.85 * a).toFixed(3) + ')';
  }
  function maxAbs(arr) { var m = 1e-9; for (var i = 0; i < arr.length; i++) m = Math.max(m, Math.abs(arr[i])); return m; }
  function topK(arr, k) {
    var idx = []; for (var i = 0; i < arr.length; i++) idx.push(i);
    idx.sort(function (a, b) { return Math.abs(arr[b]) - Math.abs(arr[a]); });
    return idx.slice(0, k).sort(function (a, b) { return a - b; });
  }

  function drawNet(cv, d) {
    // 紧凑画法（手机竖屏、窄栏）：宽度 < 600px 时标签缩短、展开的神经元更少、方阵更窄、字更小
    var bw = cv.parentNode.clientWidth || el.body.clientWidth || 600, compact = bw < 600;
    var H = (compact ? 330 : bw > 820 ? 430 : 400) + (CFG.extraHeight || 0);
    var C = setupCanvas(cv, H), g = C.g, W = C.w;
    var ex = explainOf(d), net = nets[d.role], FG = FG0, mk = S.masks[d.role];
    var KS = compact ? [12, 8, 8] : K_SHOW, HC = compact ? [16, 16, 8] : HEAT_COLS;
    S.hits = [];
    g.clearRect(0, 0, W, H);
    g.font = (compact ? '10px' : '11px') + ' "Microsoft YaHei", "PingFang SC", sans-serif';
    g.textBaseline = 'middle';

    // ---- 输入列
    var top = 34, rh = (H - top - 6) / FG.length, cs = Math.max(1.6, Math.min(compact ? 3 : 5.5, (rh - 4) / CFG.gridRows - 1)), gap = cs < 3 ? 0.6 : 1;
    var labelW = compact ? 62 : (CFG.labelW || 104), gridW = Math.max(CFG.gridCols * (cs + gap), compact ? 40 : 60), inX = 4, gridX = inX + labelW, attrX = gridX + gridW + 6, attrW = compact ? 18 : 30;
    var inRight = attrX + attrW + 4;
    g.fillStyle = '#ffc94d';
    g.fillText('输入 ' + net.layers[0].in + ' 维（' + FG.length + ' 组）', inX, 10);
    g.fillStyle = '#9db3a5';
    g.fillText(compact ? '组名 · 方阵 · 归因' : '组名 维数 · 方阵 · 归因', inX, 24);
    var attrMax = maxAbs(ex.attr), groupAttr = [], groupAnchor = [];
    FG.forEach(function (gr, gi) {
      var y0 = top + gi * rh, s = 0;
      for (var k = 0; k < gr.dim; k++) s += ex.attr[gr.offset + k];
      groupAttr.push(s);
      g.fillStyle = gr.key === 'action' ? '#ffc94d' : '#cfdcd3';
      g.fillText(compact ? SHORT[gr.key].slice(0, 6) : SHORT[gr.key] + ' ' + gr.dim, inX, y0 + rh / 2);
      var cells = [];
      if (gr.kind === 'cards') {
        for (k = 0; k < gr.dim; k++) {
          var cr = CFG.cardCell(k), col = cr[0], row = cr[1];
          cells.push({k: k, x: gridX + col * (cs + gap), y: y0 + (rh - CFG.gridRows * (cs + gap)) / 2 + row * (cs + gap), w: cs, h: cs});
        }
      } else {
        var cw = Math.min(cs + gap, gridW / gr.dim), ch = Math.max(cs, 3);
        for (k = 0; k < gr.dim; k++) cells.push({k: k, x: gridX + k * cw, y: y0 + rh / 2 - ch / 2, w: Math.max(1.5, cw - gap), h: ch});
      }
      cells.forEach(function (c) {
        var dim = gr.offset + c.k, x = ex.x[dim], a = ex.attr[dim];
        if (!x) g.fillStyle = '#26382e';
        else if (Math.abs(a) < 1e-6) g.fillStyle = '#d9e4dc';
        else g.fillStyle = 'rgba(' + (a > 0 ? POS : NEG) + ',' + (0.35 + 0.65 * Math.min(1, Math.abs(a) / attrMax)).toFixed(3) + ')';
        g.fillRect(c.x, c.y, c.w, c.h);
        S.hits.push({type: 'input', dim: dim, x: c.x, y: c.y, w: c.w + gap, h: c.h + gap});
      });
      groupAnchor.push(y0 + rh / 2);
    });
    var gaMax = maxAbs(groupAttr);
    FG.forEach(function (gr, gi) {
      var y = groupAnchor[gi], v = groupAttr[gi], w = Math.min(1, Math.abs(v) / gaMax) * attrW / 2, cx = attrX + attrW / 2;
      g.fillStyle = '#33473c'; g.fillRect(attrX, y - 1, attrW, 2);
      g.fillStyle = 'rgb(' + (v >= 0 ? POS : NEG) + ')';
      if (v >= 0) g.fillRect(cx, y - 4, w, 8); else g.fillRect(cx - w, y - 4, w, 8);
      S.hits.push({type: 'group', gi: gi, v: v, x: attrX, y: y - 6, w: attrW, h: 12});
    });

    // ---- 隐藏层列 + 输出
    var outW = compact ? 44 : 64, colW = (W - inRight - outW) / 3, layers = ex.hidden, cols = [];
    layers.forEach(function (Lh, li) {
      var cx = inRight + colW * (li + 0.5), K = KS[li], hc = HC[li], hr = Math.ceil(Lh.size / hc);
      var cell = compact ? Math.max(1.5, Math.min(3, (colW - 6) / hc)) : Math.max(2, Math.min(5, (colW - 14) / hc)), heatH = hr * cell, heatY = H - heatH - 4;
      var dotTop = 40, dotBot = heatY - 16, sp = (dotBot - dotTop) / K;
      var show = topK(Lh.contrib, K), cmax = maxAbs(Lh.contrib), pmax = maxAbs(Lh.pre);
      g.fillStyle = '#ffc94d'; g.textAlign = 'center';
      g.fillText(compact ? '隐藏 ' + Lh.size : '隐藏层 ' + (li + 1) + '：' + Lh.size + ' 个', cx, 10);
      g.fillStyle = '#9db3a5';
      g.fillText(compact ? '前 ' + K + ' 个' : '展开贡献最大的 ' + K + ' 个', cx, 24);
      g.fillText(compact ? hc + '×' + hr : '全部 ' + Lh.size + ' 个（' + hc + '×' + hr + '）', cx, heatY - 8);
      var pts = show.map(function (n, k) { return {n: n, x: cx, y: dotTop + sp * (k + 0.5)}; });
      cols.push({pts: pts, li: li});
      // 全层热力方阵
      var hx = cx - hc * cell / 2;
      for (var n = 0; n < Lh.size; n++) {
        var x = hx + (n % hc) * cell, y = heatY + Math.floor(n / hc) * cell, kn = mk[li + 1][n] === 0;
        g.fillStyle = actColor(Lh.pre[n], pmax, kn);
        g.fillRect(x, y, cell - (cell > 3 ? 0.6 : 0), cell - (cell > 3 ? 0.6 : 0));
        S.hits.push({type: 'neuron', li: li, n: n, x: x, y: y, w: cell, h: cell});
      }
      cols[li].draw = function () {
        pts.forEach(function (p) {
          var kn = mk[li + 1][p.n] === 0, r = 2 + 3.2 * Math.sqrt(Math.abs(Lh.contrib[p.n]) / cmax);
          r = Math.min(r, sp / 2 + 0.5);
          g.beginPath(); g.arc(p.x, p.y, Math.max(r, 2), 0, 2 * Math.PI);
          g.fillStyle = actColor(Lh.pre[p.n], pmax, kn); g.fill();
          if (kn) { g.strokeStyle = '#ccc'; g.lineWidth = 1; g.beginPath(); g.moveTo(p.x - 3, p.y - 3); g.lineTo(p.x + 3, p.y + 3); g.moveTo(p.x + 3, p.y - 3); g.lineTo(p.x - 3, p.y + 3); g.stroke(); }
          S.hits.push({type: 'neuron', li: li, n: p.n, x: p.x - 5, y: p.y - Math.max(4, sp / 2), w: 10, h: Math.max(8, sp)});
        });
      };
    });
    g.textAlign = 'left';

    // ---- 连线：只画贡献最大的若干条
    function lines(list) {
      var mx = 1e-9; list.forEach(function (e) { mx = Math.max(mx, Math.abs(e.v)); });
      list.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
      list.slice(0, 18).forEach(function (e) {
        g.strokeStyle = 'rgba(' + (e.v > 0 ? POS : NEG) + ',' + (0.12 + 0.6 * Math.abs(e.v) / mx).toFixed(3) + ')';
        g.lineWidth = 0.6 + 1.8 * Math.abs(e.v) / mx;
        g.beginPath(); g.moveTo(e.x1, e.y1); g.lineTo(e.x2, e.y2); g.stroke();
      });
    }
    var L1 = net.layers[0], e = [];
    FG.forEach(function (gr, gi) {
      cols[0].pts.forEach(function (p) {
        var s = 0, row = p.n * L1.in;
        for (var k = 0; k < gr.dim; k++) if (ex.x[gr.offset + k]) s += L1.W[row + gr.offset + k];
        if (mk[1][p.n] === 0) s = 0;
        e.push({v: s, x1: attrX + attrW, y1: groupAnchor[gi], x2: p.x - 5, y2: p.y});
      });
    });
    lines(e);
    for (var li = 1; li < layers.length; li++) {
      var Ln = net.layers[li], prev = layers[li - 1];
      e = [];
      cols[li].pts.forEach(function (p) {
        cols[li - 1].pts.forEach(function (q0) {
          e.push({v: Ln.W[p.n * Ln.in + q0.n] * prev.act[q0.n], x1: q0.x + 5, y1: q0.y, x2: p.x - 5, y2: p.y});
        });
      });
      lines(e);
    }
    var Lo = net.layers[net.layers.length - 1], ox = W - outW / 2, oy = H / 2 - 20;
    e = cols[cols.length - 1].pts.map(function (p) {
      return {v: Lo.W[p.n] * layers[layers.length - 1].act[p.n], x1: p.x + 5, y1: p.y, x2: ox - 12, y2: oy};
    });
    lines(e);
    cols.forEach(function (c) { c.draw(); });
    // 输出结点
    g.beginPath(); g.arc(ox, oy, 12, 0, 2 * Math.PI);
    g.fillStyle = 'rgba(' + (ex.q >= 0 ? POS : NEG) + ',0.9)'; g.fill();
    g.fillStyle = '#ffc94d'; g.textAlign = 'center';
    g.fillText(compact ? '输出' : '输出 ' + Lo.out + ' 个', ox, 10);
    g.fillStyle = '#9db3a5'; g.fillText('Q 值', ox, 24);
    g.fillStyle = '#fff'; g.font = 'bold 12px sans-serif'; g.fillText(fmt(ex.q, 2), ox, oy + 26);
    g.font = (compact ? '10px' : '11px') + ' "Microsoft YaHei", sans-serif'; g.fillStyle = '#cfdcd3';
    var mvT = moveText(d.legal[candOf(d)]), mvMax = compact ? 5 : 9;
    g.fillText(mvT.length > mvMax ? mvT.slice(0, mvMax) + '…' : mvT, ox, oy + 44);
    g.textAlign = 'left';
    cv._decision = d;
  }

  // ------------------------------------------------------------------ 局势曲线
  function drawValue(cv, roles, selD) {
    var C = setupCanvas(cv, 92), g = C.g, W = C.w, H = 92, pad = 18;
    g.clearRect(0, 0, W, H);
    var all = ctx.decisions().filter(function (d) { return !d.pending || S.reveal[d.id]; });
    var n = Math.max(2, all.length);
    function X(i) { return pad + (W - pad - 6) * i / (n - 1); }
    function Y(v) { return 6 + (H - 20) * (1 - (Math.max(-Q_RANGE, Math.min(Q_RANGE, v)) + Q_RANGE) / (2 * Q_RANGE)); }
    g.strokeStyle = '#33473c'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, Y(0)); g.lineTo(W - 4, Y(0)); g.stroke();
    g.fillStyle = '#9db3a5'; g.font = '10px sans-serif';
    g.fillText('+1', 0, Y(1)); g.fillText('0', 4, Y(0)); g.fillText('−1', 0, Y(-1));
    g.fillText('第几手 →', W - 52, H - 4);
    roles.forEach(function (r) {
      if (ctx.locked(r)) return;
      var pts = [];
      all.forEach(function (d, i) { if (d.role === r) pts.push({x: X(i), y: Y(d.q0[argmax(d.q0)]), d: d}); });
      if (!pts.length) return;
      g.strokeStyle = ROLE_COLOR[r]; g.lineWidth = 1.6; g.beginPath();
      pts.forEach(function (p, k) { if (k) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
      g.stroke();
      pts.forEach(function (p) {
        g.fillStyle = ROLE_COLOR[r];
        g.beginPath(); g.arc(p.x, p.y, p.d === selD ? 4 : 2, 0, 2 * Math.PI); g.fill();
        if (p.d === selD) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.stroke(); }
      });
    });
  }

  // ------------------------------------------------------------------ 全部模式
  function renderAll() {
    var wide = el.body.clientWidth >= 860 && ROLES.length <= 4;
    var html = '<div class="all-grid' + (wide ? ' two' : '') + '">' + ROLES.map(function (r) {
      return '<div class="mini-brain ' + r + '" data-role="' + r + '" id="mini-' + r + '"></div>';
    }).join('') + '<div class="mini-brain" id="mini-curves" style="cursor:default"><div class="mh"><b>' + ROLES.length + ' 个大脑的自评局势（每次决策的最高 Q）</b></div><canvas id="curves-canvas"></canvas>' +
      '<div class="legend">' + ROLES.map(function (r) { return '<i style="background:' + ROLE_COLOR[r] + '"></i>' + ROLE_ZH[r]; }).join('') + '</div></div></div>';
    el.body.innerHTML = html;
    ROLES.forEach(function (r) { renderMini(r); });
    drawValue($('curves-canvas'), ROLES, null);
  }

  function renderMini(role) {
    var box = $('mini-' + role), d = currentDecision(role), lock = ctx.locked(role);
    var head = '<div class="mh"><b style="color:' + ROLE_COLOR[role] + '">' + ROLE_ZH[role] + '</b><span class="muted">' +
      esc(ctx.roleSeatName(role) || '') + '</span>';
    box.onclick = function () { S.view = role; render(); };
    if (lock) { box.innerHTML = head + '</div><div class="lock"><div class="inner">🔒 本局结束前锁住<br><span class="muted small">' + esc(lock) + '</span></div></div>'; return; }
    if (!d || (d.pending && !S.reveal[d.id])) { box.innerHTML = head + '</div><div class="empty small">' + (d ? '轮到你出牌，点开看网络建议' : ctx.emptyText(role)) + '</div>'; return; }
    var q = liveQ(d), order = [];
    for (var i = 0; i < q.length; i++) order.push(i);
    order.sort(function (a, b) { return q[b] - q[a]; });
    var real = d.chosen !== null && d.chosen >= 0 ? moveText(d.legal[d.chosen]) : '（还没出）';
    box.innerHTML = head + '<span>候选 ' + d.legal.length + ' 个 · 实际出 <b>' + esc(real) + '</b></span>' +
      (knockedCount(role) ? '<span class="tag best">敲掉 ' + knockedCount(role) + '</span>' : '') + '</div>' +
      '<canvas id="mc-' + role + '"></canvas><div class="top3">' + order.slice(0, 3).map(function (i, k) {
        return (k + 1) + '. ' + esc(moveText(d.legal[i])) + '　Q ' + fmt(q[i]) + (i === d.chosen ? ' <span class="tag real">实际出的</span>' : '');
      }).join('<br>') + '</div>';
    drawMini($('mc-' + role), d);
  }

  function drawMini(cv, d) {
    var C = setupCanvas(cv, CFG.miniHeight || 150), g = C.g, W = C.w, H = CFG.miniHeight || 150, ex = explainOf(d), FG = FG0, mk = S.masks[d.role];
    g.clearRect(0, 0, W, H);
    g.font = '9px "Microsoft YaHei", sans-serif'; g.textBaseline = 'middle';
    var inW = Math.min(170, W * 0.32), bh = (H - 16) / FG.length;
    g.fillStyle = '#ffc94d'; g.fillText('输入 ' + FG.length + ' 组', 0, 6);
    var gm = 1e-9, ga = FG.map(function (gr) {
      var s = 0; for (var k = 0; k < gr.dim; k++) s += ex.attr[gr.offset + k];
      gm = Math.max(gm, Math.abs(s)); return s;
    });
    FG.forEach(function (gr, gi) {
      var on = 0; for (var k = 0; k < gr.dim; k++) on += ex.x[gr.offset + k];
      var y = 14 + gi * bh, w = (inW - 60) * Math.min(1, on / Math.min(gr.dim, 20));
      g.fillStyle = '#26382e'; g.fillRect(60, y + 1, inW - 60, bh - 2);
      g.fillStyle = 'rgba(' + (ga[gi] >= 0 ? POS : NEG) + ',' + (0.3 + 0.7 * Math.abs(ga[gi]) / gm).toFixed(3) + ')';
      g.fillRect(60, y + 1, w, bh - 2);
      g.fillStyle = '#9db3a5'; g.fillText(SHORT[gr.key].slice(0, 6), 0, y + bh / 2);
    });
    var x0 = inW + 8, colW = (W - x0) / 3;
    ex.hidden.forEach(function (Lh, li) {
      var hc = HEAT_COLS[li], hr = Math.ceil(Lh.size / hc), cell = Math.max(1.5, Math.min((colW - 8) / hc, (H - 18) / hr));
      var hx = x0 + li * colW + (colW - hc * cell) / 2, pmax = maxAbs(Lh.pre);
      g.fillStyle = '#ffc94d'; g.textAlign = 'center'; g.fillText('隐藏 ' + Lh.size, x0 + li * colW + colW / 2, 6); g.textAlign = 'left';
      for (var n = 0; n < Lh.size; n++) {
        g.fillStyle = actColor(Lh.pre[n], pmax, mk[li + 1][n] === 0);
        g.fillRect(hx + (n % hc) * cell, 14 + Math.floor(n / hc) * cell, cell - 0.4, cell - 0.4);
      }
    });
  }

  // ------------------------------------------------------------------ 交互
  function onCanvasMove(ev) {
    var cv = ev.target;
    if (!cv || cv.id !== 'net-canvas') return;
    var r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, h = hitAt(x, y);
    var tip = $('tip');
    if (!h) { if (tip.dataset.src === 'canvas') { tip.hidden = true; tip.dataset.src = ''; } return; }
    var d = cv._decision, ex = explainOf(d), txt;
    if (h.type === 'input') {
      txt = '<b>' + esc(CFG.featureName(h.dim)) + '</b><br>第 ' + h.dim + ' 维，取值 ' + ex.x[h.dim] + '<br>梯度 × 输入 = ' + fmt(ex.attr[h.dim], 4);
    } else if (h.type === 'group') {
      var gr = FG0[h.gi];
      txt = '<b>' + esc(gr.name) + '</b>（' + gr.dim + ' 维，第 ' + gr.offset + '–' + (gr.offset + gr.dim - 1) + ' 维）<br>整组归因合计 ' + fmt(h.v, 4) + '<br><span class="muted">相关性解释，不代表因果</span>';
    } else {
      var Lh = ex.hidden[h.li], kn = S.masks[d.role][h.li + 1][h.n] === 0;
      txt = '<b>隐藏层 ' + (h.li + 1) + ' · 第 ' + h.n + ' 号神经元</b>' + (kn ? '（已敲掉）' : '') +
        '<br>加权和 ' + fmt(Lh.pre[h.n]) + '，激活 ' + Lh.act[h.n].toFixed(3) + '<br>对 Q 的贡献 ' + fmt(Lh.contrib[h.n], 4) +
        '<br><span class="muted">点击' + (kn ? '恢复' : '敲掉（置零）') + '</span>';
    }
    tip.innerHTML = txt; tip.hidden = false; tip.dataset.src = 'canvas';
    tip.style.left = Math.min(ev.clientX + 14, root.innerWidth - 290) + 'px';
    tip.style.top = Math.min(ev.clientY + 14, root.innerHeight - 120) + 'px';
  }
  function hitAt(x, y) {
    for (var i = S.hits.length - 1; i >= 0; i--) {
      var h = S.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h;
    }
    return null;
  }
  function onCanvasClick(ev) {
    var cv = ev.target;
    if (!cv || cv.id !== 'net-canvas') return;
    var r = cv.getBoundingClientRect(), h = hitAt(ev.clientX - r.left, ev.clientY - r.top);
    if (!h || h.type !== 'neuron') return;
    toggleNeuron(cv._decision.role, h.li + 1, h.n);
  }
  function toggleNeuron(role, layer, n) {
    var m = S.masks[role][layer];
    m[n] = m[n] === 0 ? 1 : 0;
    S.maskVer++;
    ctx.task('knock');
    ctx.onMasks(role);
    render();
  }
  function restoreAll() {
    S.masks = newMasks(); S.maskVer++;
    ROLES.forEach(function (r) { ctx.onMasks(r); });
    render();
  }

  // ------------------------------------------------------------------ 对外
  function render() {
    if (!ctx) return;
    renderTabs(); renderNav();
    if (S.view === 'all') renderAll(); else renderSingle(S.view);
  }

  function init(c) {
    ctx = c;
    nets = c.nets;
    el = {tabs: $('brain-tabs'), struct: $('brain-struct'), body: $('brain-body'), decNav: $('dec-nav'),
      decLabel: $('dec-label'), prev: $('dec-prev'), next: $('dec-next'), restore: $('restore-btn'), follow: $('follow-toggle')};
    S.masks = newMasks(); S.maskVer = 0;
    renderStruct();
    el.tabs.onclick = function (ev) {
      var b = ev.target.closest('.btab'); if (!b) return;
      S.view = b.getAttribute('data-view');
      if (S.view === 'all') ctx.task('all');
      render();
    };
    el.follow.onchange = function () {
      S.follow = el.follow.checked;
      if (S.follow) { ROLES.forEach(function (r) { S.sel[r] = null; }); render(); }
    };
    function nav(delta) {
      if (S.view === 'all') return;
      var ds = roleDecisions(S.view), d = currentDecision(S.view), k = ds.indexOf(d) + delta;
      if (k < 0 || k >= ds.length) return;
      S.sel[S.view] = ds[k].id;
      S.follow = false; el.follow.checked = false;
      render();
    }
    el.prev.onclick = function () { nav(-1); };
    el.next.onclick = function () { nav(1); };
    el.restore.onclick = restoreAll;
    el.body.addEventListener('mousemove', onCanvasMove);
    el.body.addEventListener('mouseleave', function () { var t = $('tip'); if (t.dataset.src === 'canvas') t.hidden = true; });
    el.body.addEventListener('click', onCanvasClick);
    var rt = null;
    root.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(render, 120); });
    render();
  }

  /** app.js 每产生一个决策就调用：跟随模式下切到行动方的大脑。 */
  function onDecision(d) {
    if (S.follow) {
      ROLES.forEach(function (r) { S.sel[r] = null; });
      if (S.view !== 'all') S.view = d.role;
    }
    render();
  }
  function onNewDeal() {
    ROLES.forEach(function (r) { S.sel[r] = null; });
    S.cand = {}; S.reveal = {}; S.expanded = false;
    render();
  }

  root.Brain = {
    init: init, render: render, onDecision: onDecision, onNewDeal: onNewDeal,
    masksFor: function (role) { return S && S.masks ? masksFor(role) : null; },
    reveal: function (id) { S.reveal[id] = true; render(); },
    setView: function (v) { S.view = v; render(); },
    toggleNeuron: toggleNeuron, restoreAll: restoreAll,
    state: function () { return S; },
    destroy: function () { ctx = null; nets = null; S.masks = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
