/* 四人斗地主的界面配置（GAME_UI）与大脑面板配置（BRAIN_CFG）。依赖：CG、DDZ4、UIC。 */
(function (root) {
  'use strict';
  var CG = root.CG, G = root.DDZ4, U = root.UIC;
  var KIND_ZH = {single: '单张', pair: '对子', trio: '三张', trio_pair: '三带二', straight: '顺子', pair_chain: '连对',
    plane: '飞机', plane_pair: '飞机带对', bomb: '炸弹', rocket: '天王炸', pass: '过'};
  var ROLE_ZH = {landlord: '地主', p1: '农民一（下家）', p2: '农民二（对家）', p3: '农民三（上家）'};
  var ROLE_COLOR = {landlord: '#ff7a3d', p1: '#4aa3ff', p2: '#46c36f', p3: '#c77dff'};
  var ord = function (r) { return r; };
  var sortDesc = U.sortDesc(ord);
  function moveText(m) {
    if (m.isPass) return '过';
    var t = KIND_ZH[m.kind] || m.kind;
    if (m.kind === 'bomb') t = m.length + ' 张炸弹';
    return t + ' ' + U.ranksText(m.ranks, ord);
  }
  var seatPos = U.seatPos(4);

  root.GAME_UI = {
    key: 'ddz4', title: '四人斗地主', sub: '两副牌 · 1 地主 vs 3 农民 · 看 DMC 网络怎么打分',
    repo: 'four-player-doudizhu-rl', demoSeed: 20261013, hasBrain: true,
    kindZh: KIND_ZH, moveText: moveText, sortForDisplay: sortDesc, seatPos: seatPos, seatXY: U.seatXY, finishName: U.finishName,
    alarmAt: 3, fullDeck: function () { return CG.deck(2); }, counterRanks: [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
    kindNames: {random: '随机', greedy: '贪心', dmc: 'DMC'},
    presets: {
      novice: {name: '新手', desc: '随机：在所有合法出牌里随便挑一个。', kinds: function (n) { return new Array(n).fill('random'); }},
      normal: {name: '普通', desc: '贪心规则：自由出牌出张数最多的一手，跟牌出最小能压的普通牌，手牌 ≤8 张才用炸弹。', kinds: function (n) { return new Array(n).fill('greedy'); }},
      dmc: {name: 'DMC 网络', desc: 'DMC 网络：四张 Q 网络给每个合法出牌打分、出最高的。注意：这个模型实测比随机还弱（见 README），只适合拿来“看大脑”。', kinds: function (n) { return new Array(n).fill('dmc'); }},
      mixed: {name: '混搭', desc: '混搭：1、3 号位贪心，2 号位 DMC 网络（观战时 0 号位也是 DMC）——同一桌上对比规则和网络。', kinds: function () { return ['dmc', 'greedy', 'dmc', 'greedy']; }}
    },
    defaultPreset: {watch: 'normal', play: 'normal'},
    roleOf: function (g, s) { return s === g.landlord ? {text: '👑 地主', color: ROLE_COLOR.landlord} : {text: '农民', color: ROLE_COLOR[g.position(s)]}; },
    roleShort: function (g, s) { return s === g.landlord ? '地主' : '农民'; },
    lastShown: function (g, seat, lastCards) { return U.lastShown(g, seat, lastCards, KIND_ZH, sortDesc); },
    startLog: function (g) {
      return [seatPos(g.landlord) + ' 叫 ' + g.base + ' 分成为地主，底牌 ' + sortDesc(g.bottom).map(CG.cardStr).join(' ')];
    },
    startExplain: function (g, m, human) {
      return '两副牌 108 张，每人 25 张，8 张底牌归地主。<b>' + seatPos(g.landlord) + '</b> 叫了 ' + g.base + ' 分当地主（33 张），三个农民一伙。' +
        '任意一家出完就结束。右栏「大脑面板」显示每一手出牌时 DMC 网络给全部合法出牌打的分（不管实际是谁在出牌）。';
    },
    centerInfo: function (g) {
      var t = '底牌 ' + sortDesc(g.bottom).map(function (c) { return CG.RANK_NAMES[c.r]; }).join(' ') + '<br>底分 <b>' + g.base + '</b> · 炸弹 <b>' +
        g.bombsPlayed + '</b> · 倍数 <b>×' + Math.pow(2, g.bombsPlayed) + '</b><br>';
      if (g.done) return t + '本局结束';
      return t + (g.toBeat ? '要压：<b>' + moveText(g.toBeat) + '</b>' : '<b>自由出牌</b>');
    },
    humanHint: function (g, legal) {
      return '点牌选中，回车出牌，空格过，T 提示。' + (g.toBeat ? '要压的是 <b>' + moveText(g.toBeat) + '</b>，压不过可以过。' : '现在自由出牌。') + '（共 ' + legal.length + ' 个合法动作）';
    },
    whyIllegal: function (g, cs) {
      var ranks = CG.sortedNums(cs.map(function (c) { return c.r; })).join(',');
      var any = g.genMoves(g.turn).some(function (m) { return CG.sortedNums(m.ranks).join(',') === ranks; });
      if (!any) return '这不是合法牌型（四人斗地主没有三带一、四带二；4 张同点就是炸弹）';
      return g.toBeat ? '这一手压不过 ' + moveText(g.toBeat) : '这一手现在不能出';
    },
    /** 牌型图鉴的例子是否真是这个牌型（自检用）。 */
    galleryCheck: function (cards, name) {
      var g = new G(new root.PyRandom(1)).reset(), rk = CG.sortedNums(cards.map(function (c) { return c.r; })).join(',');
      g.hands[0] = cards;
      return g.genMoves(0).some(function (m) { return (KIND_ZH[m.kind] === name || (m.kind === 'bomb' && name === '炸弹')) && CG.sortedNums(m.ranks).join(',') === rk; });
    },
    resultText: function (g) {
      var side = g.finished[0] === g.landlord ? '地主' : '农民';
      return side + '胜（' + seatPos(g.finished[0]) + ' 先出完），倍数 ×' + g.multiplier + (g.spring ? '（春天）' : '') + '，得分 ' +
        g.returns().map(function (v, s) { return s + '号' + (v > 0 ? '+' : '') + v; }).join(' / ');
    },
    rulesHTML: '两副牌 108 张，每人 25 张，<b>8 张底牌</b>归地主；叫分 1/2/3 定地主（启发式自动叫）。<br>' +
      '牌型：单张、对子（含对王）、三张、<b>三带二</b>、顺子（≥5 张，3~A）、连对（≥3 对）、飞机（可带对）、<b>炸弹（同点 4~8 张，张数多的大）</b>、<b>天王炸（4 个王）</b>。<br>' +
      '没有三带一、四带二（4 张同点就是炸弹）。任意一家出完即结束；底分 × 2^炸弹数 × 春天 ×2，地主输赢是每个农民的三倍。',
    rulesNote: '贪心规则（agents.GreedyAgent）：自由出牌时出张数最多的一手、张数相同出最小的；跟牌时出能压住的普通牌型里最小的；普通牌压不住且手牌 ≤8 张时，才用最小的炸弹。',
    tasks: [
      {id: 'types', text: '在「牌型图鉴」里点开 3 种牌型看看例子'},
      {id: 'trio_pair', text: '出一手三带二', when: function (e) { return e === 'kind:trio_pair'; }},
      {id: 'chain', text: '出一手顺子、连对或飞机', when: function (e) { return /^kind:(straight|pair_chain|plane|plane_pair)$/.test(e); }},
      {id: 'bomb', text: '出一手炸弹或天王炸', when: function (e) { return e === 'kind:bomb' || e === 'kind:rocket'; }},
      {id: 'hint', text: '用一次 💡 提示，看贪心规则会怎么出'},
      {id: 'brain', text: '切到「大脑面板」，看 DMC 网络给候选出牌的打分'},
      {id: 'win_practice', text: '赢一局（对手：新手）'}
    ],
    gallery: [
      ['单张', [[9, '♠']], '任意一张牌。'],
      ['对子', [[12, '♥'], [12, '♣']], '两张同点；两张小王或两张大王也是对子。'],
      ['三张', [[7, '♠'], [7, '♥'], [7, '♦']], '三张同点（不带牌也可以出）。'],
      ['三带二', [[10, '♠'], [10, '♥'], [10, '♣'], [4, '♠'], [4, '♦']], '三张 + 一对。四人斗地主没有三带一。'],
      ['顺子', [[5, '♠'], [6, '♥'], [7, '♣'], [8, '♦'], [9, '♠']], '至少 5 张连续单牌，3 到 A（不含 2 和王）。'],
      ['连对', [[6, '♠'], [6, '♥'], [7, '♣'], [7, '♦'], [8, '♠'], [8, '♥']], '至少 3 对连续的对子。'],
      ['飞机', [[8, '♠'], [8, '♥'], [8, '♣'], [9, '♠'], [9, '♥'], [9, '♣']], '至少 2 组连续的三张，可以不带，也可以每组带一对。'],
      ['飞机带对', [[11, '♠'], [11, '♥'], [11, '♣'], [12, '♠'], [12, '♥'], [12, '♣'], [3, '♠'], [3, '♥'], [5, '♣'], [5, '♦']], '每组三张各带一对。'],
      ['炸弹', [[13, '♠'], [13, '♥'], [13, '♣'], [13, '♦'], [13, '♠']], '同点 4~8 张。张数多的炸弹大；张数相同比点数（5 张 3 > 4 张 A）。'],
      ['天王炸', [[16, ''], [16, ''], [17, ''], [17, '']], '4 个王，最大。']
    ],
    helpCards: [
      ['① 这是什么', '<p>两副牌的<b>四人斗地主</b>：1 个地主对 3 个农民。所有规则在浏览器里运行，与 Python 版引擎逐步一致。</p><p>右栏「大脑面板」是一张用强化学习（深度蒙特卡洛，DMC）训练过的 Q 网络：每一手都把全部合法出牌送进去打分。</p>'],
      ['② 怎么看右边', '<p><b>大脑面板</b>：输入方阵、三层隐藏层、每个候选出牌的 Q。点神经元可以“敲掉”。</p><p><b>规则依据</b>：贪心规则这一步命中了哪一条，在哪些候选里挑、挑了哪一手；下面是记牌器。</p><p class="muted small">这个 DMC 模型实测比随机出牌还弱，网络给不同出牌的分数几乎一样——正好看看“没学会”的网络长什么样。</p>'],
      ['③ 怎么玩', '<p>顶部切换「观战 / 我来玩 / 规则练习」。我来玩：点牌选中，<kbd>回车</kbd> 出牌，<kbd>空格</kbd> 过，<kbd>T</kbd> 提示（按贪心规则），双击一张牌选中同点数的全部。</p><p><kbd>P</kbd> 暂停 / 继续，<kbd>N</kbd> 单步，<kbd>H</kbd> 打开本说明。</p>']
    ]
  };

  root.BRAIN_CFG = {
    roles: G.POSITIONS.slice(), roleZh: ROLE_ZH, roleColor: ROLE_COLOR, groups: G.FEATURE_GROUPS,
    short: {my_hand: '我的手牌', unseen: '没见过的牌', to_beat: '要压的牌', bottom: '底牌', last_1: '下家最近一手', last_2: '对家最近一手',
      last_3: '上家最近一手', played_landlord: '地主已出', played_p1: '农民一已出', played_p2: '农民二已出', played_p3: '农民三已出',
      left_1: '下家剩余张数', left_2: '对家剩余张数', left_3: '上家剩余张数', bombs: '已出炸弹数', action: '候选动作'},
    featureName: G.featureName, encodeAction: G.encodeAction, moveText: moveText,
    cardCell: function (k) { return k < 104 ? [Math.floor(k / 8), k % 8] : k < 106 ? [13, k - 104] : [14, k - 106]; },
    gridCols: 15, gridRows: 8, labelW: 100, extraHeight: 60, miniHeight: 170
  };
})(typeof window !== 'undefined' ? window : globalThis);
