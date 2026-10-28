/* 牌桌页面（五个游戏共用）：模式（观战 / 我来玩 / 规则练习）、发牌出牌流程、人类操作、
 * 右栏“规则依据 + 记牌器”（四人斗地主另有 DMC 大脑面板）、新手引导、退出。
 * 每个游戏的差异都在 window.GAME_UI（<游戏>_ui.js）里：怎么开局、角色与队伍、牌型名称、任务清单……
 * 依赖：CG（core.js）、游戏引擎、GAME_UI；可选 Brain（brain.js）+ DDZNN（nn.js）。
 */
(function (root) {
  'use strict';
  var CG = root.CG, UI = root.GAME_UI, Brain = root.Brain || null, NN = root.DDZNN || null;
  var MU = root.MobileUI || null;     // 手机竖屏工具（js/mobile.js），没有也能跑
  var sheets = null;                  // 手机上的全屏面板控制器（看大脑 / 看规则依据 / 选项）
  var G = CG.GAMES[UI.key], N = G.prototype.N;
  var KIND_ZH = UI.kindZh;
  var A = {
    mode: 'watch', preset: {watch: UI.defaultPreset.watch, play: UI.defaultPreset.play, practice: 'novice'},
    kinds: null, speed: 900, paused: false, open: {watch: true, play: false, practice: false},
    human: null, match: null, game: null, dealNo: 0, matchNo: 0, seed: 1, totals: null, timers: [], sel: {},
    decisions: [], decId: 0, tasks: {}, typesSeen: {}, explain: '', stopped: false, log: [], lastCards: null,
    pane: 'rules', ruleSel: null, nets: null
  };
  var agents = {};

  // ================================================================ 工具
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function store(k, v) { try { if (v === undefined) return root.localStorage.getItem(k); root.localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function later(fn, ms) { var t = setTimeout(function () { A.timers = A.timers.filter(function (x) { return x !== t; }); if (!A.stopped) fn(); }, ms); A.timers.push(t); return t; }
  function clearTimers() { A.timers.forEach(clearTimeout); A.timers = []; }
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = ''; }, 2400);
  }
  function rankName(r) { return CG.RANK_NAMES[r]; }
  function cardHTML(c, cls, idx) {
    var attr = idx === undefined ? '' : ' data-i="' + idx + '"';
    if (c.r >= 16) return '<span class="card joker' + (c.r === 17 ? ' big' : '') + ' ' + (cls || '') + '"' + attr + '>' + rankName(c.r) + '</span>';
    var red = (c.s === '♥' || c.s === '♦') ? ' red' : '';
    var wild = UI.isWild && A.game && UI.isWild(A.game, c) ? ' wild' : '';
    return '<span class="card' + red + wild + ' ' + (cls || '') + '"' + attr + '><span class="rk">' + rankName(c.r) + '</span><span class="st">' + c.s + '</span></span>';
  }
  function cardsHTML(cs, cls) { return cs.map(function (c) { return cardHTML(c, cls); }).join(''); }
  /** 按点数汇总的紧凑手牌（明牌时展示别人的手牌用）。 */
  function chipsHTML(cs) {
    var order = [], cnt = {};
    UI.sortForDisplay(cs).forEach(function (c) { var k = c.r; if (!(k in cnt)) { cnt[k] = 0; order.push(k); } cnt[k]++; });
    return order.map(function (r) { return '<span class="chip-r">' + rankName(r) + (cnt[r] > 1 ? '<sub>×' + cnt[r] + '</sub>' : '') + '</span>'; }).join('');
  }
  function moveText(m, game) { return UI.moveText(m, game || A.game); }
  function seatName(seat) {
    if (seat === A.human) return '你';
    return UI.seatPos(seat) + ' · ' + {random: '随机', greedy: '贪心', dmc: 'DMC'}[A.kinds[seat]];
  }

  // ================================================================ 智能体
  function agentFor(kind, seat) {
    if (kind === 'random') return agents['r' + seat] || (agents['r' + seat] = new CG.RandomAgent(1000 + seat));
    if (kind === 'greedy') return agents.greedy || (agents.greedy = new CG.GreedyAgent());
    if (kind === 'dmc') return agents.dmc;
    return null;
  }
  /** 一次决策的记录：规则依据（贪心怎么想的）+ DMC 网络的打分（四人斗地主）。 */
  function record(seat, legal, chosenIdx, kind, ruleInfo) {
    var g = A.game, d = {id: ++A.decId, seat: seat, role: g.position ? g.position(seat) : null, legal: legal, chosen: chosenIdx,
      kind: kind, actorName: seatName(seat), ply: g.history ? g.history.length : 0, rule: ruleInfo, pending: false};
    if (kind === 'human') d.actorName = '你';
    if (UI.hasBrain && A.nets) {
      d.state = g.encodeState(seat);
      d.q0 = NN.scoreAll(A.nets[d.role], d.state, legal.map(function (m) { return g.encodeAction(m); }));
    }
    A.decisions.push(d);
    return d;
  }

  // ================================================================ 开局
  function newDeal(keepSeed) {
    clearTimers();
    if (!keepSeed) A.seed += 1;
    if (G.Match) {
      if (!A.match || A.match.over) { A.match = new G.Match(new root.PyRandom(A.seed)); A.matchNo += 1; }
      A.game = A.match.newDeal();
      if (UI.key === 'shengji') A.game.reset();
    } else {
      A.game = new G(new root.PyRandom(A.seed)).reset();
    }
    A.dealNo += 1;
    A.decisions = []; A.sel = {}; A.ruleSel = null;
    A.lastCards = new Array(N).fill(null);
    A.trickView = null;
    var g = A.game;
    A.log.push({t: '—— 第 ' + A.dealNo + ' 局 ——', sys: true});
    UI.startLog(g, A.match).forEach(function (l) { A.log.push({t: l, sys: true}); });
    A.explain = UI.startExplain(g, A.match, A.human);
    if (UI.onDealStart) UI.onDealStart(g, A.match, task);
    if (Brain) Brain.onNewDeal();
    renderAll();
    schedule(A.speed);
  }

  // ================================================================ 主循环
  function schedule(ms) {
    clearTimers();
    if (A.paused || A.stopped) return;
    later(function () { if (advance()) schedule(A.speed); }, ms);
  }
  function advance() {
    var g = A.game;
    if (!g || A.stopped || g.done) return false;
    if (g.turn === A.human) { humanTurnStart(); renderAll(); return false; }
    aiMove();
    renderAll();
    if (g.done) { afterOver(); return false; }
    return true;
  }
  function aiMove() {
    var g = A.game, seat = g.turn, kind = A.kinds[seat], legal = g.legalMoves(), m, info = null;
    if (kind === 'greedy') { info = agentFor('greedy').explain(g); m = info.move; }
    else if (kind === 'dmc') {
      var mk = Brain ? Brain.masksFor(g.position(seat)) : null;
      m = agents.dmc.act(g, mk);
    } else m = agentFor('random', seat).act(g);
    var idx = legal.findIndex(function (x) { return CG.moveEq(x, m); });
    if (!info) info = kind === 'random' ? {rule: 'random', text: '随机：在 ' + legal.length + ' 个合法动作里随便挑一个。', pool: legal, legal: legal}
      : {rule: 'dmc', text: 'DMC 网络给 ' + legal.length + ' 个合法动作各打一个分，挑分最高的。', pool: legal, legal: legal};
    if (kind !== 'greedy') info.greedy = agentFor('greedy').explain(g);
    var d = record(seat, legal, idx, kind, info);
    apply(seat, m);
    if (Brain) Brain.onDecision(d);
    explainMove(d);
  }
  function apply(seat, m) {
    var g = A.game, before = g.played[seat].length;
    g.step(m);
    var newCards = g.played[seat].slice(before);
    A.lastCards[seat] = m.isPass ? null : newCards;
    A.log.push({t: UI.seatPos(seat) + (seat === A.human ? '（你）' : '') + '［' + UI.roleShort(g, seat) + '］：' + (m.isPass ? '过' : moveText(m) + (UI.showSuits ? '' : '')), you: seat === A.human});
    if (UI.afterStep) UI.afterStep(g, seat, m, A.log, {human: A.human, task: task});
    if (g.done) onOver();
  }
  function onOver() {
    var g = A.game, r = g.returns();
    A.totals.games += 1;
    for (var s = 0; s < N; s++) { A.totals.scores[s] += r[s]; if (r[s] > 0) A.totals.wins[s] += 1; }
    A.log.push({t: '★ ' + UI.resultText(g), sys: true});
    if (A.match) {
      A.match.applyResult(g);
      A.log.push({t: '   ' + A.match.status(), sys: true});
      if (A.match.over) A.log.push({t: '🏆 ' + (A.match.champion === 0 ? '蓝队（0、2 号位）' : '红队（1、3 号位）') + '打过 A，整场获胜！下一局开新的一场。', sys: true});
    }
    if (A.human !== null && r[A.human] > 0) task('win');
    if (A.human !== null && A.mode === 'practice' && r[A.human] > 0) task('win_practice');
  }
  function afterOver() {
    renderAll();
    if (Brain) Brain.render();
    if (A.mode === 'watch' && !A.paused) later(function () { newDeal(); }, Math.max(2600, A.speed * 3));
  }

  // ================================================================ 人类操作
  function humanTurnStart() {
    var g = A.game, last = A.decisions[A.decisions.length - 1];
    if (last && last.pending) return last;
    var legal = g.legalMoves(), d = record(g.turn, legal, null, 'human', agentFor('greedy').explain(g));
    d.pending = true;
    A.explain = '<b>轮到你</b>（' + UI.roleShort(g, g.turn) + '）。' + touchWording(UI.humanHint(g, legal));
    if (Brain) Brain.onDecision(d);
    if (legal.length === 1 && legal[0].isPass) A.explain += '<br><b>你没有能压住的牌，只能过</b>（按空格或点「过」）。';
    return d;
  }
  /** 触屏设备上把提示文字里的键盘说法换成触屏说法（humanHint 由各游戏的 _ui.js 给出，按键盘写）。 */
  function touchWording(t) {
    if (!document.body.classList.contains('touch')) return t;
    return t.replace(/（双击一张 = 选中同点数的全部）/g, '').replace(/，回车出牌，空格过，T 提示/g, '，再点「出牌」「过」或「提示」').replace(/T 提示/g, '点「提示」');
  }
  function selectedCards() {
    var hand = handView();
    return Object.keys(A.sel).filter(function (k) { return A.sel[k]; }).map(function (k) { return hand[+k]; });
  }
  function handView() { return UI.sortForDisplay(A.game.hands[A.human]); }
  /** 选中的牌 → 合法动作：先找实体牌完全一致的；找不到就找点数一致的（花色不影响牌型时）。 */
  function matchMove(cards, legal) {
    var key = CG.sortCards(cards).map(CG.cardKey).join(',');
    var exact = legal.filter(function (m) { return !m.isPass && m.cards.length && CG.sortCards(m.cards).map(CG.cardKey).join(',') === key; });
    if (exact.length) return exact[0];
    var rk = CG.sortedNums(cards.map(function (c) { return c.r; })).join(',');
    var byRank = legal.filter(function (m) {
      if (m.isPass) return false;
      var mr = m.cards.length ? m.cards.map(function (c) { return c.r; }) : m.ranks;
      return CG.sortedNums(mr).join(',') === rk;
    });
    return byRank[0] || null;
  }
  function humanPlay(pass) {
    var g = A.game;
    if (!g || g.done || g.turn !== A.human) return;
    var legal = g.legalMoves(), m;
    if (pass) {
      m = legal.filter(function (x) { return x.isPass; })[0];
      if (!m) { toast(UI.key === 'shengji' ? '升级不能过，必须出一张牌' : '现在是自由出牌，不能过', true); return; }
    } else {
      var cs = selectedCards();
      if (!cs.length) { toast('先点牌选中', true); return; }
      m = matchMove(cs, legal);
      if (!m) { toast(UI.whyIllegal(g, cs, legal), true); return; }
    }
    var d = humanTurnStart(), idx = legal.findIndex(function (x) { return CG.moveEq(x, m); });
    d.chosen = idx; d.pending = false;
    A.sel = {};
    if (!m.isPass) task('kind:' + m.kind);
    if (UI.onHumanMove) UI.onHumanMove(g, m, task);
    apply(A.human, m);
    var gr = d.rule && d.rule.move;
    A.explain = '你出了 <b>' + esc(m.isPass ? '过' : moveText(m)) + '</b>。' + (gr ? '贪心规则会出 <b>' + esc(gr.isPass ? '过' : moveText(gr)) + '</b>（' + esc(d.rule.text) + '）' : '');
    if (Brain) Brain.onDecision(d);
    renderAll();
    if (g.done) { afterOver(); return; }
    schedule(A.speed);
  }
  function hint() {
    var g = A.game;
    if (!g || g.done || g.turn !== A.human) return;
    var info = agentFor('greedy').explain(g), m = info.move;
    task('hint');
    A.sel = {};
    if (m.isPass) { toast('贪心规则建议：过'); renderAll(); return; }
    var hand = handView(), need = (m.cards.length ? m.cards : null), ranks = m.ranks.slice();
    hand.forEach(function (c, i) {
      if (need) { for (var k = 0; k < need.length; k++) if (CG.cardEq(need[k], c)) { A.sel[i] = true; need = need.slice(0, k).concat(need.slice(k + 1)); return; } }
      else { var j = ranks.indexOf(c.r); if (j >= 0) { A.sel[i] = true; ranks.splice(j, 1); } }
    });
    toast('贪心规则建议：' + moveText(m));
    renderAll();
  }
  function explainMove(d) {
    var who = UI.seatPos(d.seat) + '（' + UI.roleShort(A.game, d.seat) + '）', m = d.legal[d.chosen];
    A.explain = who + '有 <b>' + d.legal.length + '</b> 个合法动作，出了 <b>' + esc(m.isPass ? '过' : moveText(m)) + '</b>。' + esc(d.rule.text);
    if (d.kind !== 'greedy' && d.rule.greedy) {
      var gm = d.rule.greedy.move;
      A.explain += '（换成贪心规则会出 ' + esc(gm.isPass ? '过' : moveText(gm)) + '）';
    }
  }

  // ================================================================ 渲染
  function renderAll() {
    if (A.stopped || !A.game) return;
    renderTable(); renderMe(); renderInfo(); renderLog(); renderScores(); renderBanner(); renderTasks(); renderRight();
  }
  function isOpen() { return A.open[A.mode]; }
  function seatHTML(seat) {
    var g = A.game, turn = !g.done && g.turn === seat, role = UI.roleOf(g, seat);
    var rank = (g.finished && g.finished.indexOf(seat) >= 0 && !g.done) ? '<span class="tag best">' + UI.finishName(g.finished.indexOf(seat), N) + '</span>' : '';
    if (g.done && g.finished) rank = '<span class="tag best">' + UI.finishName(g.finished.indexOf(seat), N) + '</span>';
    var hand = g.hands[seat], showHand = seat !== A.human && (isOpen() || g.done);
    var last = UI.lastShown(g, seat, A.lastCards);
    return '<div class="seatbox' + (turn ? ' turn' : '') + '" style="border-color:' + (turn ? '' : role.color) + '">' +
      '<div class="sh"><b>' + esc(seatName(seat)) + '</b> <span style="color:' + role.color + '">' + esc(role.text) + '</span> ' + rank + '</div>' +
      '<div class="sc">剩 <b>' + hand.length + '</b> 张' + (hand.length > 0 && hand.length <= UI.alarmAt ? ' <span class="danger">⚠</span>' : '') + '</div>' +
      (showHand ? '<div class="chips-hand">' + chipsHTML(hand) + '</div>' : '') +
      '<div class="lastplay">' + last + '</div></div>';
  }
  /** 座位相对于“自己”（观战时是 0 号位）的方位：下一家在右、上一家在左、其余在上方一排；手机布局按这个分行。 */
  function seatSide(k) { return k === 0 ? 'bottom' : k === 1 ? 'right' : k === N - 1 ? 'left' : 'top'; }
  function renderTable() {
    var g = A.game, ref = A.human === null ? 0 : A.human, rows = {top: [], left: [], right: [], bottom: []};
    for (var s = 0; s < N; s++) {
      if (s === A.human) continue;
      var k = ((s - ref) % N + N) % N, side = seatSide(k), p = UI.seatXY(s, N, A.human === null ? -1 : A.human);
      rows[side].push({k: k, html: '<div class="seatwrap" data-side="' + side + '" style="left:' + p[0] + '%;top:' + p[1] + '%">' + seatHTML(s) + '</div>'});
    }
    rows.top.sort(function (a, b) { return b.k - a.k; });   // 上方一排从左到右：上家那边 → 下家那边
    function join(list) { return list.map(function (x) { return x.html; }).join(''); }
    $('felt').innerHTML = '<div class="frow top">' + join(rows.top) + '</div>' +
      '<div class="frow mid"><div class="fside left">' + join(rows.left) + '</div><div class="centerbox">' + UI.centerInfo(g, A.match) + '</div><div class="fside right">' + join(rows.right) + '</div></div>' +
      (rows.bottom.length ? '<div class="frow bottom">' + join(rows.bottom) + '</div>' : '');
  }
  function renderMe() {
    var g = A.game, me = $('me-zone');
    if (A.human === null) { me.hidden = true; return; }
    me.hidden = false;
    var my = g.turn === A.human && !g.done, hand = handView();
    me.className = my ? 'turn' : '';
    var role = UI.roleOf(g, A.human);
    $('me-title').innerHTML = '你（' + UI.seatPos(A.human) + '）<span style="color:' + role.color + '">' + esc(role.text) + '</span> · 剩 <b>' + hand.length + '</b> 张' +
      (g.finished && g.finished.indexOf(A.human) >= 0 ? ' · <span class="tag best">' + UI.finishName(g.finished.indexOf(A.human), N) + '</span>' : '') +
      ' · 上一手：' + (UI.lastShown(g, A.human, A.lastCards) || '—');
    var legalCards = null;
    if (my && UI.key === 'shengji') {
      legalCards = {};
      g.legalMoves().forEach(function (m) { legalCards[CG.cardKey(m.cards[0])] = true; });
    }
    $('me-hand').className = 'hand-wrap' + (my ? ' clickable' : '') + (hand.length > 30 ? ' dense' : '');
    $('me-hand').innerHTML = hand.map(function (c, i) {
      var cls = (A.sel[i] ? 'sel' : '') + (legalCards && !legalCards[CG.cardKey(c)] ? ' dim' : '');
      return cardHTML(c, cls, i);
    }).join('');
    var acts = '';
    if (!g.done) {
      if (UI.key === 'shengji') acts = '<span class="muted small">' + (my ? '点一张亮着的牌直接出' : '等待其他人出牌…') + '</span><button class="btn" id="hint-btn" data-act="hint" data-tip="hint"' + (my ? '' : ' disabled') + '>💡 提示</button>';
      else acts = '<button class="btn" id="hint-btn" data-act="hint" data-tip="hint"' + (my ? '' : ' disabled') + '>💡 提示</button>' +
        '<button class="btn" data-act="clear">清空</button>' +
        '<button class="btn" data-act="pass" data-tip="pass"' + (my && g.toBeat !== null ? '' : ' disabled') + '>过</button>' +
        '<button class="btn go" data-act="play" data-tip="play"' + (my ? '' : ' disabled') + '>出 牌</button>';
    } else acts = '<button class="btn primary" data-act="new">再来一局</button>';
    $('me-actions').innerHTML = acts;
  }
  function renderInfo() { $('explain').innerHTML = A.explain || ''; $('mob-explain').innerHTML = A.explain || ''; }
  function renderLog() {
    var el = $('log');
    el.innerHTML = A.log.slice(-80).map(function (l) { return '<div class="' + (l.sys ? 'sys' : '') + (l.you ? ' you' : '') + '">' + esc(l.t) + '</div>'; }).join('');
    el.scrollTop = 1e9;
  }
  function renderScores() {
    var t = A.totals;
    $('scores').innerHTML = (A.match ? '<div class="small" style="margin-bottom:4px">' + esc(A.match.status()) + '</div>' : '') + t.scores.map(function (v, i) {
      return esc(seatName(i)) + '：<b style="color:' + (v > 0 ? '#7fe39b' : v < 0 ? '#ff8f8f' : '#ddd') + '">' + (v > 0 ? '+' : '') + v + '</b>，胜 ' + t.wins[i];
    }).join('<br>') + '<br><span class="muted small">已打完 ' + t.games + ' 局</span>';
  }
  function renderBanner() {
    var g = A.game, b = $('result-banner');
    if (!g.done) { b.hidden = true; return; }
    var r = g.returns(), you = A.human !== null ? (r[A.human] > 0 ? '🎉 你这一方赢了！' : '你这一方输了') : '本局结束';
    b.innerHTML = '<h3>' + you + '</h3><div>' + esc(UI.resultText(g)) + '</div>' +
      (A.match ? '<div class="small">' + esc(A.match.status()) + '</div>' : '') +
      (A.mode === 'watch' ? '<div class="muted small">' + (A.paused ? '已暂停：点「新一局」继续' : '几秒后自动开下一局') + '</div>' :
        '<div class="row" style="justify-content:center"><button class="btn primary" data-act="new">再来一局</button></div>');
    b.hidden = false;
  }

  // ================================================================ 右栏：规则依据 / 记牌器 / 大脑
  function renderRight() {
    document.querySelectorAll('.rtab').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-pane') === A.pane); });
    $('rules-pane').hidden = A.pane !== 'rules';
    if ($('brain-pane')) $('brain-pane').hidden = A.pane !== 'brain';
    if (A.pane === 'rules') renderRules();
  }
  function currentRuleDecision() {
    var ds = A.decisions.filter(function (d) { return !d.pending || A.mode !== 'watch'; });
    if (A.ruleSel !== null) { var hit = ds.filter(function (d) { return d.id === A.ruleSel; })[0]; if (hit) return hit; }
    return ds[ds.length - 1] || null;
  }
  var GREEDY_STEPS = [
    {id: 'lead', text: '① 没人要压（自由出牌）→ 在非炸弹牌型里挑「张数最多」的一手，张数相同挑「点数最小」'},
    {id: 'follow', text: '② 要跟牌 → 在能压住的普通牌型里挑「点数最小」，点数相同挑「张数最少」'},
    {id: 'bomb', text: '③ 普通牌压不住，而且手牌只剩 ≤ 8 张 → 用「最小的炸弹」抢回出牌权'},
    {id: 'pass', text: '④ 否则 → 过（炸弹留着）'}
  ];
  var ALGO_ZH = {random: '随机', greedy: '贪心规则', dmc: 'DMC 神经网络', human: '人'};
  /** 右栏顶部：这一桌每个座位用的是什么算法；当前这一步的算法怎么走（贪心 = 逐条规则；网络 = 看大脑面板）。 */
  function algoCard(d) {
    var counts = {}, order = [];
    (A.kinds || []).forEach(function (k, s) { var kk = s === A.human ? 'human' : k; if (!(kk in counts)) { counts[kk] = 0; order.push(kk); } counts[kk]++; });
    var summary = order.map(function (k) { return ALGO_ZH[k] + ' × ' + counts[k]; }).join('、');
    var html = '<div class="algo"><div class="algo-h">这一桌的 AI：' + esc(summary) + '</div>' +
      '<div class="algo-sub">' + (UI.hasBrain ? 'DMC = 训练过的神经网络（看「大脑面板」）；贪心 = 几条写死的规则；随机 = 均匀抽一个合法动作。'
        : '这个游戏<b>没有训练好的神经网络</b>：AI 全是规则（贪心）或随机。贪心规则就是下面这几条，按顺序试，命中哪条就按哪条出。') + '</div>';
    var kind = d ? d.kind : null, rule = d && d.rule ? d.rule : null;
    if (kind === 'greedy' || kind === 'human' || !d) {
      var steps = UI.greedySteps || GREEDY_STEPS, hit = rule && (kind === 'greedy' ? rule.rule : rule.greedy ? rule.greedy.rule : rule.rule);
      html += '<ol class="algo-steps">' + steps.map(function (st) {
        return '<li class="' + (hit === st.id ? 'hit' : '') + '">' + esc(st.text) + (hit === st.id ? ' <span class="tag best">这一步命中</span>' : '') + '</li>';
      }).join('') + '</ol>';
      if (kind === 'human') html += '<div class="algo-sub">这一步是你出的；下面显示如果按贪心规则会怎么挑，方便对照。</div>';
    } else if (kind === 'random') {
      html += '<div class="algo-sub">这一步由<b>随机</b>算法出：在全部合法动作里均匀抽一个（用和 Python random.Random 相同的随机数序列，所以可复现）。下面另列出贪心规则会怎么挑，做对照。</div>';
    } else if (kind === 'dmc') {
      html += '<div class="algo-sub">这一步由 <b>DMC 神经网络</b>出：把局面编码成输入向量 → 三层隐藏层 → 给每个合法动作各算一个 Q 值 → 选最高的。真实激活在' +
        ($('brain-pane') ? '「<a href="#" class="go-brain">大脑面板</a>」' : '大脑面板') + '里；下面另列出贪心规则会怎么挑，做对照。</div>';
    }
    return html + '</div>';
  }
  function renderRules() {
    var el = $('rules-pane'), d = currentRuleDecision(), g = A.game, html = '';
    var ds = A.decisions, k = d ? ds.indexOf(d) : -1;
    html += algoCard(d);
    html += '<div class="row" style="justify-content:space-between"><b class="panel-h" style="margin:0">这一步依据的规则</b><span>' +
      '<button class="icon-btn" id="rule-prev"' + (k > 0 ? '' : ' disabled') + '>◀</button> <span class="small">' + (d ? '第 ' + (k + 1) + ' / ' + ds.length + ' 个决策' : '还没有决策') + '</span> ' +
      '<button class="icon-btn" id="rule-next"' + (d && k < ds.length - 1 ? '' : ' disabled') + '>▶</button></span></div>';
    if (!d) html += '<div class="empty">开局后，这里逐步显示每一家为什么这样出：贪心规则命中了哪一条、在哪些候选里挑、挑了哪一手。</div>';
    else {
      var lock = lockedSeat(d.seat);
      if (lock) html += '<div class="banner gray">🔒 ' + esc(lock) + '</div>';
      else {
        var info = d.rule || {}, chosen = d.chosen !== null && d.chosen >= 0 ? d.legal[d.chosen] : null;
        html += '<div class="sp-head">' + esc(d.actorName) + '（' + esc(UI.roleShort(g, d.seat)) + '）· 合法动作 <b>' + d.legal.length + '</b> 个 · ' +
          (chosen ? '实际出：<b>' + esc(chosen.isPass ? '过' : moveText(chosen)) + '</b>' : '<b>还没出</b>') + '</div>';
        if (d.kind === 'greedy' || d.kind === 'human') {
          html += '<div class="banner green"><b>' + (d.kind === 'human' ? '如果按贪心规则：' : '命中的规则：') + '</b>' + esc(info.text) + '</div>';
        } else html += '<div class="banner gray">' + esc(info.text) + (info.greedy ? '<br>换成贪心规则：' + esc(info.greedy.text) + ' → <b>' + esc(info.greedy.move.isPass ? '过' : moveText(info.greedy.move)) + '</b>' : '') + '</div>';
        var gi = d.kind === 'greedy' || d.kind === 'human' ? info : (info.greedy || {});
        var pool = gi.pool || [], best = gi.move, keyOf = gi.keyOf || null, keyText = gi.keyText || null;
        // 候选表：先列规则“考虑范围”里的动作，按规则的排序依据排好名次；再列不在范围里的（灰）
        var inPool = d.legal.filter(function (m) { return pool.some(function (p) { return CG.moveEq(p, m); }); });
        var outPool = d.legal.filter(function (m) { return !pool.some(function (p) { return CG.moveEq(p, m); }); });
        if (keyOf) inPool = inPool.slice().sort(function (a, b) { return CG.cmpTuple(keyOf(a), keyOf(b)); });
        var rows = inPool.map(function (m, i) { return {m: m, rank: i + 1}; }).concat(outPool.map(function (m) { return {m: m, rank: 0}; })).slice(0, 60);
        if (gi.keyName) html += '<div class="algo-sub">排序依据：' + esc(gi.keyName) + '，排第 1 的就是规则挑的。</div>';
        html += '<div class="mvwrap"><table class="mv"><tr><th>名次</th><th>合法动作</th><th>牌型</th><th>' + (keyText ? '排序依据' : '规则会考虑') + '</th></tr>' + rows.map(function (r) {
          var m = r.m, isBest = best && CG.moveEq(best, m), isReal = chosen && CG.moveEq(chosen, m);
          return '<tr class="' + (isBest ? 'win' : '') + (isReal ? ' real' : '') + (r.rank ? '' : ' dim') + '"><td>' + (r.rank ? '第 ' + r.rank : '—') + '</td><td>' + esc(m.isPass ? '过' : moveText(m)) + (isReal ? ' <span class="tag real">实际出的</span>' : '') +
            (isBest ? ' <span class="tag best">规则挑的</span>' : '') + '</td><td>' + esc(KIND_ZH[m.kind] || m.kind) + '</td><td class="res">' + (r.rank ? (keyText ? esc(keyText(m)) : '✔') : '不在考虑范围') + '</td></tr>';
        }).join('') + (d.legal.length > 60 ? '<tr><td colspan="4" class="muted">…… 还有 ' + (d.legal.length - 60) + ' 个</td></tr>' : '') + '</table></div>';
      }
    }
    html += '<div class="panel-h" style="margin-top:10px">' + (A.human === null ? '记牌器（还没出的牌，' + {4: '四', 5: '五', 6: '六'}[N] + '家合计）' : '记牌器（除你手牌和已出的牌）') + '</div><div id="counter">' + counterHTML() + '</div>';
    html += '<div class="sp-note">' + UI.rulesNote + '</div>';
    el.innerHTML = html;
    var p = $('rule-prev'), n = $('rule-next');
    var gb = el.querySelector('.go-brain');
    if (gb) gb.onclick = function (ev) { ev.preventDefault(); A.pane = 'brain'; renderRight(); };
    if (p) p.onclick = function () { var dd = A.decisions[k - 1]; if (dd) { A.ruleSel = dd.id; renderRules(); } };
    if (n) n.onclick = function () { var dd = A.decisions[k + 1]; if (dd) { A.ruleSel = k + 1 === A.decisions.length - 1 ? null : dd.id; renderRules(); } };
  }
  function lockedSeat(seat) {
    var g = A.game;
    if (A.human === null || g.done || A.open[A.mode] || seat === A.human) return false;
    return '对手的决策过程在本局结束前看不到：候选动作会暴露它手里有什么牌。打完这局自动解锁，或打开左边的「明牌（作弊）」。';
  }
  function counterHTML() {
    var g = A.game, all = new CG.Counter(UI.fullDeck().map(function (c) { return c.r; }));
    if (A.human !== null) all.subtract(CG.rankCounter(g.hands[A.human]));
    g.played.forEach(function (p) { all.subtract(CG.rankCounter(p)); });
    if (UI.counterExtra) UI.counterExtra(g, A.human, all);
    return UI.counterRanks.map(function (r) {
      var n = Math.max(0, all.get(r));
      return '<div class="cnt-cell' + (n ? '' : ' zero') + '">' + rankName(r) + '<b>' + n + '</b></div>';
    }).join('');
  }

  // ================================================================ 选项
  function renderPresets() {
    var key = A.preset[A.mode], P = UI.presets;
    $('preset-scope').textContent = A.mode === 'watch' ? '（全部座位）' : '（' + (N - 1) + ' 个对手）';
    $('presets').innerHTML = Object.keys(P).map(function (k) {
      return '<button class="preset' + (k === key ? ' active' : '') + '" data-preset="' + k + '">' + P[k].name + '</button>';
    }).join('') + (key === 'custom' ? '<button class="preset active">自定义</button>' : '');
    $('preset-desc').textContent = key === 'custom' ? '自定义：按下面的“细调”逐个座位设置。' : P[key].desc;
    var kinds = Object.keys(UI.kindNames);
    $('seat-kinds').innerHTML = A.kinds.map(function (k0, s) {
      if (s === A.human) return '<span>' + UI.seatPos(s) + '：你</span>';
      return '<label>' + UI.seatPos(s) + ' <select data-seat="' + s + '">' + kinds.map(function (k) {
        return '<option value="' + k + '"' + (A.kinds[s] === k ? ' selected' : '') + '>' + UI.kindNames[k] + '</option>';
      }).join('') + '</select></label>';
    }).join('');
  }
  function kindsOf(presetKey) { return UI.presets[presetKey].kinds(N); }
  function setPreset(k) {
    A.preset[A.mode] = k; A.kinds = kindsOf(k);
    if (A.human !== null) A.kinds[A.human] = 'human';
    renderPresets(); renderAll();
    toast('对手：' + UI.presets[k].name + '（从下一手起生效）');
  }
  function renderPlayback() {
    $('pause-btn').textContent = $('mob-pause').textContent = A.paused ? '▶ 继续' : '⏸ 暂停';
    $('step-btn').disabled = $('mob-step').disabled = !A.paused;
    $('menu-open').textContent = (isOpen() ? '✔ ' : '') + (A.mode === 'watch' ? '明牌（看全部手牌）' : '明牌（作弊）');
    $('speed').value = A.speed;
    $('speed-val').textContent = (A.speed / 1000).toFixed(2) + ' 秒';
    $('speed-presets').innerHTML = [['慢', 1600], ['中', 900], ['快', 300]].map(function (s) {
      return '<button class="btn small' + (Math.abs(A.speed - s[1]) < 1 ? ' on' : '') + '" data-speed="' + s[1] + '">' + s[0] + '</button>';
    }).join('');
    $('open-toggle').checked = isOpen();
    $('open-label').textContent = A.mode === 'watch' ? '明牌（看全部手牌）' : '明牌（作弊）';
  }

  // ================================================================ 练习
  function task(id) {
    var t = UI.tasks.filter(function (x) { return x.id === id || (x.when && x.when(id)); });
    var changed = false;
    t.forEach(function (x) {
      if (A.tasks[x.id] || (A.mode !== 'practice' && x.practiceOnly !== false)) return;
      A.tasks[x.id] = true; changed = true;
      toast('✔ 完成：' + x.text);
    });
    if (changed) { store('cg-tasks-' + UI.key, JSON.stringify(A.tasks)); renderTasks(); }
  }
  function renderTasks() {
    $('practice-panel').hidden = A.mode !== 'practice';
    $('ctrl-toggle').textContent = '选项';
    if (A.mode !== 'practice') return;
    var next = null;
    $('tasks').innerHTML = UI.tasks.map(function (t) {
      var done = !!A.tasks[t.id], isNext = !done && !next;
      if (isNext) next = t;
      return '<li class="' + (done ? 'done' : '') + (isNext ? ' next' : '') + '">' + esc(t.text) + '</li>';
    }).join('');
    var n = UI.tasks.filter(function (t) { return A.tasks[t.id]; }).length;
    $('task-progress').textContent = n + ' / ' + UI.tasks.length + (n === UI.tasks.length ? ' 全部完成！' : '');
    $('ctrl-toggle').textContent = '任务 ' + n + '/' + UI.tasks.length;
  }
  function renderTypes() {
    $('types').innerHTML = UI.gallery.map(function (t, i) { return '<button class="btn" data-type="' + i + '">' + esc(t[0]) + '</button>'; }).join('');
  }
  function showType(i) {
    var t = UI.gallery[i];
    A.typesSeen[i] = true;
    $('type-demo').innerHTML = '<div class="cards">' + t[1].map(function (c, k) {
      return cardHTML(CG.card(c[0], c[1]), 'sm').replace('class="card', 'style="animation-delay:' + (k * 0.06) + 's" class="card');
    }).join('') + '</div>' + esc(t[2]);
    if (Object.keys(A.typesSeen).length >= 3) task('types');
  }

  // ================================================================ 模式
  function setMode(mode) {
    clearTimers();
    A.mode = mode;
    A.human = mode === 'watch' ? null : 0;
    A.kinds = kindsOf(A.preset[mode] === 'custom' ? UI.defaultPreset[mode === 'watch' ? 'watch' : 'play'] : A.preset[mode]);
    if (A.human !== null) A.kinds[A.human] = 'human';
    A.totals = {scores: new Array(N).fill(0), wins: new Array(N).fill(0), games: 0};
    A.paused = false; A.dealNo = 0; A.match = null; A.log = [];
    A.seed = mode === 'watch' ? UI.demoSeed : UI.demoSeed + (mode === 'play' ? 1000 : 2000);
    document.querySelectorAll('.mode').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    ['watch', 'play', 'practice'].forEach(function (m) { document.body.classList.toggle('m-' + m, m === mode); });
    if (sheets) sheets.close();
    renderPresets(); renderPlayback(); renderTypes();
    newDeal(true);
  }

  // ================================================================ 提示、说明、退出
  var TIPS = {
    'mode-watch': {t: '所有座位都是 AI，自动对打；右栏显示每一步依据的规则。打开页面默认就是这个模式。'},
    'mode-play': {t: '你坐下方的 0 号位，和 AI 一起打。对手的决策过程在本局结束前锁住（防止偷看手牌）。'},
    'mode-practice': {t: '带任务清单的「我来玩」，对手默认是新手（随机出牌），附牌型图鉴。'},
    select: {demo: 'select', t: '点一张牌把它抬起来（选中），再点一次放下；双击一张牌 = 选中同点数的所有牌。选好后按回车或点「出牌」。'},
    play: {demo: 'play', t: '把选中的牌打出去（快捷键：回车）。牌型不对或压不过时会提示原因。'},
    pass: {t: '这一轮不出（快捷键：空格）。轮到你自由出牌时不能过。'},
    hint: {demo: 'select', t: '按贪心规则替你选好牌（快捷键：T）。贪心规则只看你自己的手牌和桌面上的牌，所以是公平的。'},
    step: {demo: 'step', t: '暂停后每点一次只走一步（快捷键：N）。'},
    pause: {t: '暂停 / 继续（快捷键：P）。'},
    open: {t: '明牌：显示所有人的手牌。观战时默认打开；我来玩时打开就等于作弊。'},
    knock: {demo: 'knock', t: '在大脑面板的网络图上点圆点或方阵格子 = 把这个神经元置零（敲掉），看网络的打分怎么变。这个按钮一键全部恢复。'},
    follow: {t: '打开时，大脑面板自动切到刚出牌的那一家。'},
    bigscreen: {t: '投影用：左右比例从约 45:55 调到 35:65，右栏更大。'},
    cand: {demo: 'cand', t: '每一行是一个候选动作和网络给它的 Q。点一行，网络图就换成“给这一手打分时”的激活。'},
    'pane-rules': {t: '每一步依据的规则：贪心规则命中了哪一条、在哪些候选里挑；以及记牌器。'},
    'pane-brain': {demo: 'cand', t: 'DMC 网络给每个候选动作的打分和当时的真实激活。'}
  };
  var tipTimer = null;
  function demoHTML(kind) {
    if (kind === 'select') return '<div class="demo demo-select"><div class="dc">7</div><div class="dc">8</div><div class="dc">9</div><div class="ptr"></div></div>';
    if (kind === 'play') return '<div class="demo demo-play"><div class="dc">Q</div><div class="dc">Q</div><span class="key">回车</span></div>';
    if (kind === 'knock') return '<div class="demo demo-knock"><div class="nd"></div><div class="nd"></div><div class="nd"></div><div class="ptr"></div></div>';
    if (kind === 'cand') return '<div class="demo demo-cand"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="ptr"></div></div>';
    if (kind === 'step') return '<div class="demo demo-step"><div class="dc">3</div><div class="dc">4</div><div class="dc">5</div></div>';
    return '';
  }
  function onTipOver(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (!t) return;
    var info = TIPS[t.getAttribute('data-tip')];
    if (!info) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () {
      if (A.stopped) return;
      var r = t.getBoundingClientRect(), tip = $('tip');
      tip.innerHTML = demoHTML(info.demo) + esc(info.t); tip.dataset.src = 'tip'; tip.hidden = false;
      var x = Math.min(Math.max(8, r.left), root.innerWidth - 300), y = r.bottom + 8;
      if (y + 150 > root.innerHeight) y = Math.max(8, r.top - 160);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }, 280);
  }
  function onTipOut(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (!t) return;
    clearTimeout(tipTimer);
    if ($('tip').dataset.src === 'tip') $('tip').hidden = true;
  }
  function showHelp(show) { $('help').hidden = !show; if (!show) store('cg-help-' + UI.key, '1'); }
  function exitApp() {
    A.stopped = true;
    clearTimers(); clearTimeout(tipTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mouseover', onTipOver);
    document.removeEventListener('mouseout', onTipOut);
    document.removeEventListener('click', onClick);
    document.removeEventListener('dblclick', onDbl);
    if (MU) MU.destroy();
    if (Brain) Brain.destroy();
    A.game = null; A.match = null; A.decisions = []; A.nets = null; agents = {};
    root.DDZ_MODEL = null;
    try { root.close(); } catch (e) { /* 浏览器不允许关闭时显示结束页 */ }
    setTimeout(function () { $('app').hidden = true; $('app').style.display = 'none'; $('tip').hidden = true; $('help').hidden = true; $('ended').hidden = false; }, 150);
  }

  // ================================================================ 事件
  function onClick(ev) {
    var t = ev.target;
    var card = t.closest('#me-hand .card');
    if (card && A.human !== null && A.game && !A.game.done && A.game.turn === A.human) {
      var i = +card.getAttribute('data-i');
      if (UI.key === 'shengji') {
        var c = handView()[i], legal = A.game.legalMoves(), m = legal.filter(function (x) { return CG.cardEq(x.cards[0], c); })[0];
        if (!m) { toast('有' + (A.game.suitClass(A.game.trick[0][1]) === 'T' ? '主牌' : A.game.trick[0][1].s + '花色') + '就必须跟同一门', true); return; }
        A.sel = {}; A.sel[i] = true; humanPlay(false); return;
      }
      A.sel[i] = !A.sel[i]; renderMe(); return;
    }
    var a = t.closest('[data-act]');
    if (a && !a.disabled) {
      var act = a.getAttribute('data-act');
      if (act === 'hint') hint();
      else if (act === 'clear') { A.sel = {}; renderMe(); }
      else if (act === 'pass') humanPlay(true);
      else if (act === 'play') humanPlay(false);
      else if (act === 'new') newDeal();
      return;
    }
    var p = t.closest('[data-preset]'); if (p) { setPreset(p.getAttribute('data-preset')); return; }
    var sp = t.closest('[data-speed]'); if (sp) { A.speed = +sp.getAttribute('data-speed'); renderPlayback(); return; }
    var ty = t.closest('[data-type]'); if (ty) { showType(+ty.getAttribute('data-type')); return; }
    var m2 = t.closest('.mode'); if (m2) { setMode(m2.getAttribute('data-mode')); return; }
    var rt = t.closest('.rtab'); if (rt) { setPane(rt.getAttribute('data-pane')); }
  }
  function onDbl(ev) {
    var card = ev.target.closest('#me-hand .card');
    if (!card || UI.key === 'shengji' || A.human === null) return;
    var hand = handView(), r = hand[+card.getAttribute('data-i')].r;
    A.sel = {};
    hand.forEach(function (c, i) { if (c.r === r) A.sel[i] = true; });
    renderMe();
  }
  function setPane(p) {
    A.pane = p;
    if (p === 'brain') task('brain');
    renderRight();
    if (p === 'brain' && Brain) setTimeout(function () { Brain.render(); }, 0);
  }
  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.code !== 'Escape') return; }
    if (!$('help').hidden) { if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'KeyH') { e.preventDefault(); showHelp(false); } return; }
    if (e.code === 'KeyH') { showHelp(true); return; }
    if (e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyN') { stepOnce(); return; }
    if (A.human === null) return;
    if (e.code === 'Enter') { e.preventDefault(); humanPlay(false); }
    else if (e.code === 'Space') { e.preventDefault(); humanPlay(true); }
    else if (e.code === 'KeyT') hint();
    else if (e.code === 'Escape') { A.sel = {}; renderMe(); }
  }
  function togglePause() {
    A.paused = !A.paused;
    renderPlayback();
    if (A.paused) clearTimers();
    else if (A.game && A.game.done && A.mode === 'watch') newDeal();
    else schedule(150);
    renderBanner();
  }
  function stepOnce() {
    if (!A.paused) { A.paused = true; clearTimers(); renderPlayback(); }
    if (A.game.done) { newDeal(); clearTimers(); return; }
    advance();
  }
  function bind() {
    document.addEventListener('click', onClick);
    document.addEventListener('dblclick', onDbl);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseover', onTipOver);
    document.addEventListener('mouseout', onTipOut);
    $('help-btn').onclick = function () { showHelp(true); };
    $('help-close').onclick = $('help-ok').onclick = function () { showHelp(false); };
    $('exit-btn').onclick = exitApp;
    $('pause-btn').onclick = togglePause;
    $('step-btn').onclick = stepOnce;
    $('new-btn').onclick = function () { newDeal(); };
    $('speed').oninput = function () { A.speed = +this.value; renderPlayback(); };
    $('open-toggle').onchange = function () {
      A.open[A.mode] = this.checked;
      if (this.checked && A.mode !== 'watch') toast('明牌（作弊）已打开：对手手牌和决策过程都能看了', true);
      renderAll(); if (Brain) Brain.render(); renderPlayback();
    };
    $('seat-kinds').onchange = function (ev) {
      var s = ev.target.getAttribute('data-seat'); if (s === null) return;
      A.kinds[+s] = ev.target.value; A.preset[A.mode] = 'custom'; renderPresets(); renderAll();
    };
    $('big-toggle').onchange = function () {
      document.body.classList.toggle('big', this.checked); store('cg-big', this.checked ? '1' : '0');
      setTimeout(function () { if (Brain) Brain.render(); }, 60);
    };
    // ---- 手机：☰ 菜单、看大脑（看规则依据）/ 选项全屏面板、主画面下方的一行按钮、横屏提示、防误触 ----
    $('menu-help').onclick = function () { showHelp(true); };
    $('menu-ctrl').onclick = function () { if (sheets) sheets.open('ctrl'); };
    $('menu-open').onclick = function () { var o = $('open-toggle'); o.checked = !o.checked; o.onchange(); };
    $('menu-new').onclick = function () { newDeal(); };
    $('menu-exit').onclick = exitApp;
    $('mob-pause').onclick = togglePause;
    $('mob-step').onclick = stepOnce;
    $('brain-toggle').onclick = function () { if (sheets) sheets.open('brain'); };
    $('ctrl-toggle').onclick = function () { if (sheets) sheets.open('ctrl'); };
    if (MU) {
      MU.detect({onChange: function () { renderAll(); if (Brain) setTimeout(function () { Brain.render(); }, 60); }});
      MU.menu($('menu-btn'), $('menu'));
      sheets = MU.sheets($('brain-close'), function (name) { if (name === 'brain') { renderRight(); if (Brain) setTimeout(function () { Brain.render(); }, 30); } });
      MU.rotateHint($('rotate-hint'), $('rot-ok'));
      MU.pressFeedback($('me-hand'), '.card');
      MU.pressFeedback(document.body, '.btn, .mode, .mbtn, .preset, .btab, .rtab, #menu button');
      MU.guard(document.body, {});
    }
  }
  function footer() {
    var c = root.DDZ_CREDITS || {};
    $('footer').textContent = '作者 ' + (c.AUTHOR || '') + (c.AUTHOR_EMAIL ? '（' + c.AUTHOR_EMAIL + '）' : '') + ' · ' + (c.UNIVERSITY_EN || '') + ' · ' + (c.UNIVERSITY_KO || '') +
      ' · 属于 ' + (c.SERIES_NAME || '') + '系列 · 代码 MIT，文档 CC BY 4.0';
  }
  /** 说明浮层：触屏设备多一张“手机上怎么玩”的图解卡（SVG），含 <kbd> 的键盘说明卡只给电脑看。 */
  var TOUCH_SVG = '<svg viewBox="0 0 360 120" role="img" aria-label="触屏操作图解：点一张牌把它抬起来，再点下方的「出牌」">' +
    '<rect x="18" y="38" width="40" height="58" rx="5" fill="#fff" stroke="#8d8d8d"/><text x="25" y="60" font-size="16" font-weight="bold" fill="#1c1c1c">7</text>' +
    '<rect x="52" y="24" width="40" height="58" rx="5" fill="#fff" stroke="#ffc94d" stroke-width="3"/><text x="59" y="46" font-size="16" font-weight="bold" fill="#d32626">8</text>' +
    '<rect x="86" y="38" width="40" height="58" rx="5" fill="#fff" stroke="#8d8d8d"/><text x="93" y="60" font-size="16" font-weight="bold" fill="#1c1c1c">9</text>' +
    '<rect x="120" y="38" width="40" height="58" rx="5" fill="#fff" stroke="#8d8d8d"/><text x="127" y="60" font-size="16" font-weight="bold" fill="#d32626">10</text>' +
    '<circle cx="72" cy="70" r="9" fill="#ffc94d" opacity=".9"/><circle cx="72" cy="70" r="15" fill="none" stroke="#ffc94d" opacity=".5"/>' +
    '<text x="18" y="112" font-size="11" fill="#9db3a5">① 点牌：抬起 = 选中，再点放下</text>' +
    '<text x="172" y="30" font-size="11" fill="#9db3a5">② 牌多时左右滑动</text>' +
    '<defs><marker id="mArr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#9db3a5"/></marker></defs>' +
    '<path d="M178 40 h60" stroke="#9db3a5" stroke-width="2" marker-end="url(#mArr)"/>' +
    '<rect x="190" y="60" width="50" height="34" rx="8" fill="#2a4034"/><text x="200" y="82" font-size="12" fill="#e8efe9">提示</text>' +
    '<rect x="246" y="60" width="50" height="34" rx="8" fill="#2a4034"/><text x="262" y="82" font-size="12" fill="#e8efe9">过</text>' +
    '<rect x="302" y="60" width="50" height="34" rx="8" fill="#2fae5a"/><text x="312" y="82" font-size="12" font-weight="bold" fill="#fff">出牌</text>' +
    '<circle cx="327" cy="88" r="8" fill="#ffc94d" opacity=".9"/>' +
    '<text x="190" y="112" font-size="11" fill="#9db3a5">③ 点「出牌」打出去；压不过就「过」</text></svg>';
  function helpCardsHTML() {
    var label = $('brain-toggle').textContent || '看大脑';
    var text = UI.touchHelp || ('顶部切换「观战 / 我来玩 / 规则练习」。我来玩时上方是牌桌，下方是你的手牌：<b>点牌选中</b>（再点取消），牌多时<b>左右滑动</b>；然后点 <b>出牌</b>、<b>过</b> 或 <b>提示</b>。');
    var cards = [['手机上怎么玩', TOUCH_SVG + '<p>' + text + '</p><p>「' + label + '」全屏打开右栏面板，「返回」关闭；右上角 ☰ 里有 AI 强度、明牌、新一局、操作说明和退出。观战时往下滑就能看到右栏面板。</p>', 'touch-only']];
    UI.helpCards.forEach(function (c) { cards.push(/<kbd>/.test(c[1]) ? [c[0], c[1], 'kbd-only'] : c); });
    return root.UIC.helpCards(cards);
  }
  function brainCtx() {
    return {
      nets: A.nets,
      decisions: function () { return A.decisions; },
      locked: function (role) {
        var g = A.game;
        if (!g || A.human === null || g.done || A.open[A.mode]) return false;
        if (g.position(A.human) === role) return false;
        return '它的输入里有这一家自己的手牌，候选列表也会暴露它手里有什么牌，看了就等于偷看。打完这局自动解锁；也可以打开左边的「明牌（作弊）」。';
      },
      roleSeatName: function (role) {
        var g = A.game;
        if (!g) return '';
        for (var s = 0; s < N; s++) if (g.position(s) === role) return s === A.human ? '你' : UI.seatPos(s);
        return '';
      },
      emptyText: function (role) { return '这一家还没出过牌。'; },
      task: function (id) { if (id === 'cand' || id === 'knock' || id === 'all') task('brain'); },
      onReveal: function () {}, onMasks: function () {}
    };
  }

  function start() {
    document.title = UI.title;
    $('help-grid').innerHTML = helpCardsHTML();
    $('rules-text').innerHTML = UI.rulesHTML;
    footer();
    bind();
    if (UI.hasBrain && NN && root.DDZ_MODEL) {
      A.nets = NN.loadModel(root.DDZ_MODEL);
      agents.dmc = new NN.DMCAgent(A.nets, root.CG_noise || (function () { var r = new root.PyRandom(7); return function () { return r.random(); }; })());
      Brain.init(brainCtx());
    }
    if (store('cg-big') === '1') { $('big-toggle').checked = true; document.body.classList.add('big'); }
    try { A.tasks = JSON.parse(store('cg-tasks-' + UI.key) || '{}') || {}; } catch (e) { A.tasks = {}; }
    A.pane = UI.hasBrain ? 'brain' : 'rules';
    setMode('watch');
    renderRight();
    var q = root.location ? root.location.search : '';
    if (!store('cg-help-' + UI.key) && q.indexOf('nohelp') < 0 && q.indexOf('selftest') < 0 && q.indexOf('demo=') < 0) showHelp(true);
  }

  root.CGApp = {A: A, setMode: setMode, advance: advance, newDeal: newDeal, humanPlay: humanPlay, hint: hint, togglePause: togglePause,
    stepOnce: stepOnce, showType: showType, exit: exitApp, setPreset: setPreset, showHelp: showHelp, setPane: setPane, task: task,
    handView: handView, matchMove: matchMove, sheets: function () { return sheets; }};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
