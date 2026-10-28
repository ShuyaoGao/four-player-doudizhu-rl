// 四人斗地主：浏览器端状态编码与 DMC 网络前向（ddz4.js + nn.js + model_dmc4.js）vs Python / PyTorch。
'use strict';
const {loadPlay, fixture, check, done} = require('./load');
const ctx = loadPlay(['pyrandom.js', 'core.js', 'ddz4.js', 'model_dmc4.js', 'nn.js']);
const CG = ctx.CG, G = ctx.DDZ4, NN = ctx.DDZNN;
const nets = NN.loadModel(ctx.DDZ_MODEL);
const TOL_FP16W = 1e-5, TOL_FP32 = 5e-4, GAP = 1e-3;
const fx = fixture('ddz4.json').dmc;
let nq = 0, maxW = 0, max32 = 0, argOk = 0, argN = 0, states = 0, maxCand = 0;
const argmax = a => a.reduce((b, v, k) => (v > a[b] ? k : b), 0);
fx.forEach(c => {
  const g = new G(new ctx.PyRandom(c.seed)).reset();
  c.steps.forEach((s, i) => {
    const legal = g.legalMoves();
    check(legal.length === s.n_legal && g.position(g.turn) === s.position, `种子 ${c.seed} 第 ${i} 步局面不一致`);
    if (s.q_fp32) {
      const st = g.encodeState(g.turn), on = [];
      st.forEach((v, k) => { if (v) on.push(k); });
      check(st.length === 1295 && JSON.stringify(on) === JSON.stringify(s.state_on), `种子 ${c.seed} 第 ${i} 步状态编码不一致`);
      states++;
      const q = NN.scoreAll(nets[s.position], st, legal.map(m => G.encodeAction(m)));
      maxCand = Math.max(maxCand, q.length);
      for (let k = 0; k < q.length; k++) {
        maxW = Math.max(maxW, Math.abs(q[k] - s.q_fp16w[k])); max32 = Math.max(max32, Math.abs(q[k] - s.q_fp32[k])); nq++;
      }
      const srt = [...s.q_fp32].sort((a, b) => b - a);
      if (srt.length > 1 && srt[0] - srt[1] > GAP) { argN++; if (argmax(Array.from(q)) === argmax(s.q_fp32)) argOk++; }
      if (i % 7 === 0) {
        const ex = NN.explain(nets[s.position], st, G.encodeAction(legal[0]));
        check(Math.abs(ex.q - q[0]) < 1e-9 && ex.attr.length === 1403, `explain 与 scoreAll 不一致 #${i}`);
      }
    }
    g.step(legal[s.pick]);
  });
});
check(maxW < TOL_FP16W, `与 PyTorch(fp16 权重) 最大误差 ${maxW.toExponential(2)} 超过 ${TOL_FP16W}`);
check(max32 < TOL_FP32, `与 PyTorch(fp32 原权重) 最大误差 ${max32.toExponential(2)} 超过 ${TOL_FP32}`);
check(argOk === argN, `argmax 不一致 ${argN - argOk} 个`);
const d = NN.describe(nets.landlord);
check(d.input === 1403 && d.hidden.join() === '512,256,128' && d.output === 1 && d.params === 883201, '结构式 1403→512→256→128→1，883,201 参数');
check(ctx.DDZ_MODEL.total_params === 3532804 && ctx.DDZ_MODEL.positions.join() === 'landlord,p1,p2,p3', '四张网络合计 3,532,804 参数');
const FG = G.FEATURE_GROUPS;
check(FG.reduce((s, g) => s + g.dim, 0) === 1403 && FG[FG.length - 1].offset === 1295, '特征分组合计 1403 维，候选动作从第 1295 维起');
console.log(`  ${states} 个局面（最多 ${maxCand} 个候选）/ ${nq} 个 Q 值：与 PyTorch(fp16 权重) 最大误差 ${maxW.toExponential(2)}，` +
  `与 fp32 原权重最大误差 ${max32.toExponential(2)}；argmax 一致 ${argOk}/${argN}（前两名差距 > ${GAP} 的局面）`);
done('四人斗地主 浏览器前向 vs PyTorch');
