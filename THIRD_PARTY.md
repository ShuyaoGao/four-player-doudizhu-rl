# 第三方组件与来源说明 / Third-party notices

## 网页 play/（下载后双击即玩的部分）

| 内容 | 说明 |
|---|---|
| 第三方 JavaScript 库 | **没有**。页面只用浏览器自带的 Canvas / DOM，全部代码在 `play/js/` |
| 字体 | **不内嵌任何字体**。只按名字引用操作系统自带的字体（Windows：Microsoft YaHei，macOS：PingFang SC），字体文件不随本仓库分发 |
| 扑克牌面 | 由 CSS 绘制；花色 ♠♥♣♦ 是 Unicode 字符，表情符号（👑 💡 等）由操作系统的表情字体显示。没有使用任何第三方牌面图片 |
| 图片、音效 | 没有。牌桌、网络图都由代码实时绘制；页面没有声音 |
| 模型权重 `play/js/model_dmc4.js` | 由本仓库的 `checkpoints/dmc_ddz4.pt` 转成 float16 导出（`tools/export_model.py`），作者自己训练，许可证同代码（MIT） |
| `play/js/nn.js`、`play/js/brain.js`、`play/css/base.css` | 改写自作者的 doudizhu-dmc-lab 项目（同一作者、同为 MIT）：网络前向与大脑面板改为任意身份数通用 |
| `play/js/mobile.js`、`play/css/mobile.css` | 改写自作者的 doudizhu-dmc-lab 项目（同一作者、同为 MIT）：手机竖屏的设备判断、☰ 菜单、全屏面板、横屏提示、防误触；座位布局改成多人牌桌 |
| `play/js/pyrandom.js` | 作者自己的实现（与 snake-dqn-brain、doudizhu-endgame-solver 同一份）：按公开的 MT19937 算法和 CPython `random` 模块的行为重新实现，用于在浏览器里复现与 Python 完全相同的随机序列；没有复制 CPython 源代码 |
| `play/js/core.js` 里的 `pySetOrder` | 按 CPython 3 集合（set）的公开哈希表算法重新实现小整数集合的遍历顺序，用来复现 Python 引擎的合法动作顺序；没有复制 CPython 源代码 |
| 网络请求 | 没有。不用 CDN，不用 fetch / XHR，不用 service worker，`file://` 下即可运行 |

## Python（只在想自己跑评估或测试时需要，不随仓库分发）

| 包 | 用途 | 许可证（来自 PyPI 元数据） |
|---|---|---|
| PyTorch (`torch`) | DMC 训练与评估 | BSD-3-Clause 风格（PyTorch 的 LICENSE）；wheel 元数据还列出了所含组件的 Apache-2.0、BSD-2-Clause、BSL-1.0、MIT 等许可证 |
| NumPy (`numpy`) | 评估脚本 | BSD-3-Clause（另含 0BSD、MIT、Zlib、CC0-1.0 组件） |
| pytest | 测试 | MIT |

## 测试工具（不随仓库分发）

| 工具 | 用途 |
|---|---|
| Node.js | `tests/js/*.js`：在 Node 里运行 `play/js/*.js`，与 Python 引擎逐步比对 |
| 本机已安装的 Microsoft Edge | `tools/edge.py`：无头打开页面跑自检、截电脑尺寸的图；不下载任何浏览器 |
| Playwright（Python 包，Apache-2.0） | `tools/edge.py`、`tools/mobile_check.py`、`tests/test_mobile.py`：通过 DevTools 协议驱动本机 Edge（`channel="msedge"`），模拟手机尺寸和触屏做验收；只驱动已装的 Edge，不下载 Playwright 自带的浏览器 |

## 文本

- `LICENSE-docs` 中的 CC BY 4.0 法律文本来自 Creative Commons（creativecommons.org），按其规定原样附上。

## 代码来源

- 全部代码由作者编写（Claude Code 辅助，经作者审阅），没有从外部项目复制代码，也没有使用任何第三方模型或权重。
- `play/js/` 下的引擎是本仓库 Python 引擎（`core/`、`games/`、`agents.py`）的 JavaScript 移植。
- 算法思想参考（只用了思想，没有复制代码或权重）：D. Zha et al., "DouZero: Mastering DouDizhu with Self-Play Deep Reinforcement Learning", ICML 2021 —— 深度蒙特卡洛、把动作编码进网络输入。

## 名称与商标

- “四人斗地主”是民间通行的传统纸牌游戏名。本项目不使用任何商业棋牌产品的名称、标志、角色或外观。
- 学校名称只以文字形式出现在署名中，没有使用学校校标（logo）图片。
