// 浏览器版规则引擎 vs Python 引擎的差分测试：node tests/js/test_engine.js <游戏>
// 同一种子发出的牌、每一步的合法动作列表（含顺序）、贪心智能体的每一步选择、终局名次与回报都必须相同。
'use strict';
const {loadPlay, fixture, check, done} = require('./load');
const name = process.argv[2];
const ctx = loadPlay(['pyrandom.js', 'core.js', name + '.js']);
const CG = ctx.CG, G = CG.GAMES[name];
const fx = fixture(name + '.json');

const cj = c => [c.r, c.s];
const mj = m => [m.kind, m.main, m.length, m.ranks, m.cards.map(cj)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function make(seed, kw) {
  const rng = new ctx.PyRandom(seed);
  let g;
  if (name === 'guandan') g = new G(rng, kw.level);
  else if (name === 'shengji') g = new G(rng, kw.level, kw.banker);
  else g = new G(rng);
  return g.reset();
}
function snapshot(g) {
  const d = {hands: g.hands.map(h => h.map(cj)), turn: g.turn};
  const map = {landlord: 'landlord', base: 'base', emperor: 'emperor', guard: 'guard', trump_suit: 'trumpSuit', level: 'level', banker: 'banker'};
  for (const [k, jk] of Object.entries(map)) if (g[jk] !== undefined) d[k] = g[jk];
  for (const [k, jk] of Object.entries({bottom: 'bottom', buried: 'buried', bottom_buried: 'bottomBuried'})) if (g[jk] !== undefined) d[k] = g[jk].map(cj);
  return d;
}
function ending(g) {
  const d = {returns: g.returns().slice(), finished: (g.finished || []).slice()};
  const map = {upgrade: 'upgrade', winner_team: 'winnerTeam', multiplier: 'multiplier', spring: 'spring', emp_win: 'empWin',
    defender_points: 'defenderPoints', level_change: 'levelChange', next_banker: 'nextBanker', banker_win: 'bankerWin'};
  for (const [k, jk] of Object.entries(map)) if (g[jk] !== undefined) d[k] = g[jk];
  return d;
}
function cmpSnap(js, py, tag) {
  for (const k of Object.keys(py)) check(same(js[k], py[k]), `${tag} 开局字段 ${k} 不一致：JS ${JSON.stringify(js[k]).slice(0, 120)} / Python ${JSON.stringify(py[k]).slice(0, 120)}`);
}
function cmpEnd(js, py, tag) {
  for (const k of Object.keys(py)) check(same(js[k], py[k]), `${tag} 终局字段 ${k} 不一致：JS ${JSON.stringify(js[k])} / Python ${JSON.stringify(py[k])}`);
}

let steps = 0, maxLegal = 0;
fx.random_games.forEach(c => {
  const g = make(c.seed, c.kw || {}), tag = `随机局 种子 ${c.seed}`;
  cmpSnap(snapshot(g), c.start, tag);
  for (let i = 0; i < c.steps.length; i++) {
    const s = c.steps[i], legal = g.legalMoves();
    maxLegal = Math.max(maxLegal, legal.length);
    if (!check(g.turn === s.turn && same(legal.map(mj), s.legal), `${tag} 第 ${i} 步合法动作不一致（JS ${legal.length} 个 / Python ${s.legal.length} 个）`)) break;
    g.step(legal[s.pick]);
    steps++;
  }
  check(g.done, `${tag} 没有结束`);
  cmpEnd(ending(g), c.end, tag);
});
const greedy = new CG.GreedyAgent();
fx.greedy_games.forEach(c => {
  const g = make(c.seed, c.kw || {}), tag = `贪心局 种子 ${c.seed}`;
  cmpSnap(snapshot(g), c.start, tag);
  for (let i = 0; i < c.picks.length; i++) {
    const legal = g.legalMoves(), m = greedy.act(g), idx = legal.findIndex(x => CG.moveEq(x, m));
    if (!check(idx === c.picks[i], `${tag} 第 ${i} 步贪心选择不一致：JS ${idx} / Python ${c.picks[i]}`)) break;
    g.step(m);
    steps++;
  }
  cmpEnd(ending(g), c.end, tag);
});
let deals = 0;
(fx.matches || []).forEach(c => {
  const M = new G.Match(new ctx.PyRandom(c.seed)), pick = c.seed;
  c.deals.forEach((d, di) => {
    const g = M.newDeal();
    if (name === 'shengji') g.reset();
    const tag = `整场 种子 ${c.seed} 第 ${di + 1} 局`;
    cmpSnap(snapshot(g), d.start, tag);
    check(same(M.tributeLog || [], d.tribute_log), `${tag} 进贡记录不一致：JS ${JSON.stringify(M.tributeLog)} / Python ${JSON.stringify(d.tribute_log)}`);
    d.picks.forEach(i => { g.step(g.legalMoves()[i]); });
    cmpEnd(ending(g), d.end, tag);
    M.applyResult(g);
    const after = {levels: M.levels, over: M.over, champion: M.champion};
    if (name === 'guandan') after.trump_team = M.trumpTeam; else after.banker = M.banker;
    check(same(after, d.after), `${tag} 整场状态不一致：JS ${JSON.stringify(after)} / Python ${JSON.stringify(d.after)}`);
    deals++;
  });
});
if (name === 'guandan') {
  const ps = fixture('pyset.json');
  ps.forEach((c, i) => check(same(CG.pySetOrder(c.in), c.out), `Python set 顺序不一致 #${i}：${JSON.stringify(c.in)}`));
}
console.log(`  随机局 ${fx.random_games.length} 局 + 贪心局 ${fx.greedy_games.length} 局，共 ${steps} 步（最多 ${maxLegal} 个合法动作）` +
  (deals ? `；整场 ${deals} 局` : ''));
done(`${G.prototype.TITLE} 引擎差分测试`);
