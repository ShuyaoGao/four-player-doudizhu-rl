// 在 Node 里用 vm 加载 play/js/ 下的普通脚本（与浏览器里 <script> 加载的是同一份文件）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadPlay(files) {
  const ctx = {console, Buffer, atob: globalThis.atob, Map, Set};
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of files) {
    const p = path.join(ROOT, 'play', 'js', f);
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, {filename: f});
  }
  return ctx;
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', name), 'utf8'));
}

let failures = 0, passed = 0;
function check(cond, msg) {
  if (cond) { passed++; return true; }
  failures++;
  if (failures <= 25) console.log('  x ' + msg);
  return false;
}
function done(title) {
  console.log(`${title}: ${passed} 项通过，${failures} 项失败`);
  process.exit(failures ? 1 : 0);
}
module.exports = {ROOT, loadPlay, fixture, check, done};
