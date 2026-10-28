/* 自检与截图入口（只在地址带 ?selftest=1 或 ?demo=... 时生效，正常打开时什么都不做）。
 * tests/test_browser.py 用本机 Edge 无头打开 index.html?selftest=1，读回 <pre id="selftest-result">。
 */
(function (root) {
  'use strict';
  var q = (root.location && root.location.search) || '';
  if (q.indexOf('selftest=1') < 0 && q.indexOf('demo=') < 0) return;
  var errors = [];
  root.addEventListener('error', function (e) { errors.push(String(e.message) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
  root.addEventListener('unhandledrejection', function (e) { errors.push('unhandledrejection ' + e.reason); });
  var origErr = console.error;
  console.error = function () { errors.push('console.error ' + Array.prototype.join.call(arguments, ' ')); origErr.apply(console, arguments); };
  function param(name, d) { var m = new RegExp('[?&]' + name + '=([^&]*)').exec(q); return m ? decodeURIComponent(m[1]) : d; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }

  /** 我来玩：轮到人类就用提示（贪心）出牌，其余单步，直到本局结束或走满 maxSteps 步。 */
  function autoPlay(App, maxSteps, stopAtHuman) {
    var A = App.A, seenLock = null;
    for (var i = 0; i < maxSteps; i++) {
      var g = A.game;
      if (g.done) break;
      if (g.turn === A.human) {
        if (stopAtHuman && i >= stopAtHuman) { App.advance(); return seenLock; }
        if (seenLock === null && root.Brain && A.pane === 'brain') {
          var opp = g.position((A.human + 1) % g.N);
          if (opp !== g.position(A.human)) { root.Brain.setView(opp); seenLock = !!document.querySelector('#brain-body .lock'); }
        }
        App.hint();
        var sel = Object.keys(A.sel).filter(function (k) { return A.sel[k]; });
        App.humanPlay(sel.length === 0);
        if (g.turn === A.human && !g.done) App.humanPlay(true);
        continue;
      }
      App.stepOnce();
    }
    return seenLock;
  }

  async function selftest() {
    var App = root.CGApp, A = App.A, UI = root.GAME_UI, checks = [];
    function check(name, ok, info) { checks.push({name: name, ok: !!ok, info: info === undefined ? '' : String(info)}); }
    App.showHelp(false);
    check('页面加载，默认进入观战', A.mode === 'watch' && A.human === null);
    App.togglePause();
    for (var i = 0; i < 60; i++) App.stepOnce();
    await sleep(30);
    check('观战单步 60 次后有决策', A.decisions.length > 0 || A.dealNo > 1, A.decisions.length);
    App.setPane('rules'); await sleep(20);
    check('规则依据面板有内容', /这一步依据的规则/.test($('rules-pane').textContent) && document.querySelectorAll('#counter .cnt-cell').length >= 13);
    if (root.Brain) {
      App.setPane('brain'); await sleep(20);
      ['all'].concat(root.BRAIN_CFG.roles).forEach(function (v) { root.Brain.setView(v); });
      root.Brain.setView('all'); await sleep(20);
      check('大脑面板「全部」画出 ' + root.BRAIN_CFG.roles.length + ' 个紧凑大脑', document.querySelectorAll('.mini-brain').length === root.BRAIN_CFG.roles.length + 1);
      var last = A.decisions[A.decisions.length - 1];
      root.Brain.setView(last ? last.role : root.BRAIN_CFG.roles[0]); await sleep(20);
      check('大脑面板：网络图与结构式', !!$('net-canvas') && /输入 1403/.test($('brain-struct').textContent), $('brain-struct').textContent.slice(0, 60));
      var rows = document.querySelectorAll('.orow');
      if (rows.length > 1) { rows[1].click(); await sleep(10); }
      check('点候选后高亮', rows.length === 0 || document.querySelector('.orow.selc'));
      root.Brain.toggleNeuron(last ? last.role : 'landlord', 1, 3);
      check('敲掉神经元后可恢复', !$('restore-btn').disabled);
      root.Brain.restoreAll();
    }
    // 悬停提示
    var tgt = document.querySelector('[data-tip="mode-play"]');
    tgt.dispatchEvent(new MouseEvent('mouseover', {bubbles: true})); await sleep(400);
    check('悬停提示出现', !$('tip').hidden && $('tip').textContent.length > 5);
    tgt.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
    // 大屏
    $('big-toggle').click(); await sleep(80);
    var wBig = $('right').getBoundingClientRect().width;
    $('big-toggle').click(); await sleep(80);
    check('大屏模式加宽右栏', wBig > $('right').getBoundingClientRect().width + 40);
    check('没有横向滚动条', document.documentElement.scrollWidth <= root.innerWidth + 1, document.documentElement.scrollWidth + ' / ' + root.innerWidth);
    // 我来玩：打完一整局
    App.setMode('play');
    App.togglePause();
    var lockSeen = autoPlay(App, 3000);
    check('我来玩：一局能打完', A.game.done, A.game.done);
    check('结算横幅显示', !$('result-banner').hidden);
    if (root.Brain && lockSeen !== null) check('我来玩：对手大脑本局结束前锁住', lockSeen === true);
    App.setPane('rules'); await sleep(10);
    check('我来玩：打完后规则依据可以翻看', !!document.querySelector('#rules-pane table.mv') || /还没有决策/.test($('rules-pane').textContent));
    // 练习：图鉴
    App.setMode('practice');
    App.togglePause();
    App.showType(0); App.showType(1); App.showType(2);
    check('练习：看 3 种牌型后任务打勾', !!A.tasks.types && document.querySelector('#tasks li.done'));
    var bad = UI.gallery.filter(function (t) {
      var cs = t[1].map(function (c) { return root.CG.card(c[0], c[1]); });
      return !UI.galleryCheck(cs, t[0]);
    }).map(function (t) { return t[0]; });
    check('牌型图鉴的例子都能被规则引擎识别', bad.length === 0, bad.join(','));
    App.showHelp(true); check('说明弹窗可打开', !$('help').hidden); App.showHelp(false);
    App.exit();
    await sleep(400);
    check('退出后显示结束页', !$('ended').hidden);
    var ok = errors.length === 0 && checks.every(function (c) { return c.ok; });
    var pre = document.createElement('pre');
    pre.id = 'selftest-result';
    pre.textContent = JSON.stringify({ok: ok, size: [root.innerWidth, root.innerHeight], checks: checks, errors: errors});
    document.body.appendChild(pre);
    document.title = 'SELFTEST:' + (ok ? 'PASS' : 'FAIL');
  }

  async function demo() {
    var App = root.CGApp, mode = param('demo', 'watch'), steps = +param('steps', '30');
    if (param('big', '0') === '1') { $('big-toggle').checked = true; document.body.classList.add('big'); }
    if (mode === 'help') { App.showHelp(true); return; }
    App.showHelp(false);
    if (mode === 'watch') {
      App.togglePause(); for (var i = 0; i < steps; i++) App.stepOnce();
      for (var j = 0; j < 12 && App.A.decisions.length < 4; j++) App.stepOnce();   // 刚好打完一局时再走几步，截图里才有决策
    }
    else {
      App.setMode(mode); App.togglePause();
      if (param('cheat', '0') === '1') { $('open-toggle').checked = true; $('open-toggle').onchange(); }
      autoPlay(App, 3000, steps);
      if (mode === 'practice') { App.showType(2); App.showType(4); }
    }
    var pane = param('pane', '');
    if (pane) App.setPane(pane);
    var v = param('view', '');
    if (v && root.Brain) root.Brain.setView(v);
    await sleep(60);
    document.title = 'DEMO:READY';
  }
  function go() { setTimeout(q.indexOf('selftest=1') >= 0 ? selftest : demo, 60); }
  if (document.readyState === 'complete') go(); else root.addEventListener('load', go);
})(window);
