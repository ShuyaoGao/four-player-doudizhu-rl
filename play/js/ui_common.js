/* 五个游戏共用的界面小工具：座位摆位、名次名称、牌面排序、牌型文字。 */
(function (root) {
  'use strict';
  var CG = root.CG;
  var U = {};
  /** 座位在椭圆牌桌上的位置（百分比）。ref 座位在正下方，下一家在右边，逆时针排开。 */
  U.seatXY = function (seat, N, ref) {
    var k = ((seat - (ref < 0 ? 0 : ref)) % N + N) % N, th = (90 - k * 360 / N) * Math.PI / 180;
    var rx = N >= 5 ? 37 : 35, ry = N >= 5 ? 38 : 36;
    return [50 + rx * Math.cos(th), 50 + ry * Math.sin(th)];
  };
  U.finishName = function (i, N) {
    if (N === 6) return ['头科', '二科', '三科', '四科', '五科', '大落'][i] || '';
    if (N === 5) return ['头游', '二游', '三游', '四游', '末游'][i] || '';
    return ['头游', '二游', '三游', '末游'][i] || '';
  };
  U.seatPos = function (N) {
    var names = {4: ['下座', '右座', '上座', '左座'], 5: ['下座', '右下', '右上', '左上', '左下'], 6: ['下座', '右下', '右上', '上座', '左上', '左下']}[N];
    return function (s) { return s + ' 号 ' + names[s]; };
  };
  /** 大牌在前；同点按 ♠♥♣♦。order(r) 给出点数的大小（默认就是点数）。 */
  U.sortDesc = function (order) {
    return function (cs) {
      return cs.slice().sort(function (a, b) {
        return (order(b.r) - order(a.r)) || (CG.SUITS.indexOf(a.s) - CG.SUITS.indexOf(b.s));
      });
    };
  };
  U.ranksText = function (ranks, order) {
    return ranks.slice().sort(function (a, b) { return order(b) - order(a); }).map(function (r) { return CG.RANK_NAMES[r]; }).join(' ');
  };
  /** 上一手的展示：出过的牌（小牌面）+ 牌型；过牌显示“过”；还没轮到显示空。 */
  U.lastShown = function (g, seat, lastCards, kindZh, sortFn) {
    var acted = g.history && g.history.some(function (h) { return h[0] === seat; });
    if (!acted) return '';
    var m = g.lastAction[seat];
    if (m.isPass) return '<span class="passmark">过</span>';
    var cs = lastCards[seat] || [];
    return sortFn(cs).map(function (c) {
      if (c.r >= 16) return '<span class="card sm joker' + (c.r === 17 ? ' big' : '') + '">' + CG.RANK_NAMES[c.r] + '</span>';
      var red = (c.s === '♥' || c.s === '♦') ? ' red' : '';
      return '<span class="card sm' + red + '"><span class="rk">' + CG.RANK_NAMES[c.r] + '</span><span class="st">' + c.s + '</span></span>';
    }).join('') + '<span class="typetag">' + (kindZh[m.kind] || m.kind) + '</span>';
  };
  U.helpCards = function (cards) {
    return cards.map(function (c) { return '<div class="help-card' + (c[2] ? ' ' + c[2] : '') + '"><h3>' + c[0] + '</h3>' + c[1] + '</div>'; }).join('');
  };
  root.UIC = U;
})(typeof window !== 'undefined' ? window : globalThis);
