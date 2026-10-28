# -*- coding: utf-8 -*-
"""手机 / 电脑尺寸验收：用 Playwright 驱动本机 Edge，DevTools 协议模拟 390×844、414×896、360×780（DPR 3）、
768×1024（DPR 2）四个触屏尺寸和 1920×1080、1366×768 两个电脑尺寸（tools/mobile_check.py），每个尺寸做场景断言：

  通用：没有横向溢出、没有 JS 报错；
  手机：说明浮层显示触屏图解（不显示键盘说明），「开始」能关掉；头部压成一行（☰ 菜单，退出 / ? 收进菜单）；
        观战：牌桌在上、右栏面板（大脑 / 规则依据，紧凑画法）紧跟在牌桌下方；
        我来玩：整页不滚动，牌桌、手牌、按钮都在视口内；用 page.tap() 点一手可出的牌再点「出牌」，手牌数减少
        （升级是点一张亮着的牌直接出；压不过时点「过」，记录里出现“（你）…：过”）；
        「看大脑 / 看规则依据」全屏打开、「返回」关闭；
  横屏手机（额外一档 844×390）：显示“竖屏体验更佳”，点「仍然横屏继续」后消失；
  电脑：左右两栏，右栏在右，没有 ☰ 菜单。

没装 Playwright（pip install playwright）或本机 Edge 时跳过。截图写到环境变量 CG_CHECK_OUT 指定的目录
（默认系统临时目录下 cg_mobile_*），不进仓库。内部开发目录下对 play/<仓库名>/ 的五个页面各跑一遍（串行，EdgeLock 排队）。
"""
import os
import tempfile
from pathlib import Path

import pytest

from tools import edge, mobile_check

try:
    import playwright.sync_api  # noqa: F401
    HAVE_PW = True
except Exception:
    HAVE_PW = False

ROOT = Path(__file__).resolve().parents[1]
if (ROOT / "play" / "index.html").exists():
    PAGES = [ROOT / "play" / "index.html"]
else:   # 内部开发目录：play/<仓库名>/index.html
    PAGES = sorted((ROOT / "play").glob("*/index.html"))
LANDSCAPE = {"name": "l844x390", "kind": "mobile", "w": 844, "h": 390, "dpr": 3}

pytestmark = pytest.mark.skipif(not HAVE_PW or edge.find_browser() is None, reason="需要 Playwright 和本机 Edge")


def visible(page, sel):
    return page.evaluate("""s => { const e = document.querySelector(s); if (!e) return false;
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }""", sel)


def rect(page, sel):
    return page.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom}; }", sel)


def hidden(page, id_):
    return page.evaluate("id => document.getElementById(id).hidden", id_)


def no_page_scroll(page):
    return page.evaluate("() => document.documentElement.scrollHeight <= innerHeight + 1 && document.body.scrollHeight <= innerHeight + 1")


def no_h_overflow(page, w):
    return page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]")[0] <= w + 1


def close_help(page, tap, fails, mobile):
    if hidden(page, "help"):
        return
    if mobile:
        if not visible(page, ".help-card.touch-only"):
            fails.append("说明浮层没有显示触屏图解")
        if visible(page, ".help-card.kbd-only"):
            fails.append("说明浮层在触屏上还显示键盘说明")
        r = rect(page, "#help-ok")
        if r["b"] > page.evaluate("innerHeight") + 1:
            fails.append("说明浮层的「开始」按钮不在视口内")
    tap("#help-ok")
    page.wait_for_timeout(120)
    if not hidden(page, "help"):
        fails.append("点「开始」后说明浮层没关")


def play_one_move(page, tap, fails):
    """等到轮到自己：点一手可出的牌（张数最少的那一手）再点「出牌」，手牌数减少；只能过就点「过」。"""
    page.evaluate("() => { CGApp.A.speed = 120; }")
    page.wait_for_function("""() => { const A = CGApp.A, g = A.game;
      return !!g && !g.done && g.turn === A.human && !!document.querySelector('#me-actions [data-act="hint"]:not([disabled])'); }""", timeout=30000)
    is_shengji = page.evaluate("() => GAME_UI.key === 'shengji'")
    info = page.evaluate("""() => { const A = CGApp.A, g = A.game, hand = CGApp.handView();
      const legal = g.legalMoves(), moves = legal.filter(m => !m.isPass), canPass = legal.some(m => m.isPass);
      if (!moves.length) return {idx: [], n: hand.length, canPass};
      const len = m => (m.cards && m.cards.length) || (m.ranks && m.ranks.length) || 0;
      moves.sort((a, b) => len(a) - len(b));
      const m = moves[0], idx = [], used = {};
      if (m.cards && m.cards.length) {
        m.cards.forEach(c => { for (let i = 0; i < hand.length; i++) if (!used[i] && CG.cardEq(hand[i], c)) { used[i] = 1; idx.push(i); return; } });
      } else {
        m.ranks.forEach(r => { for (let i = 0; i < hand.length; i++) if (!used[i] && hand[i].r === r) { used[i] = 1; idx.push(i); return; } });
      }
      return {idx, n: hand.length, canPass, text: GAME_UI.moveText(m, g)}; }""")
    for sel in page.evaluate("() => Array.from(document.querySelectorAll('#me-actions .btn')).map(b => '#' + (b.id || ('me-actions [data-act=\"' + b.getAttribute('data-act') + '\"]')))"):
        r = rect(page, sel if sel.startswith("#me-actions") else sel)
        if r["h"] < 44 or r["w"] < 64:
            fails.append("按钮 %s 太小：%.0f×%.0f（要 ≥ 64×44）" % (sel, r["w"], r["h"]))
    if info["idx"]:
        first = '#me-hand .card[data-i="%d"]' % info["idx"][0]
        r = rect(page, first)
        if r["w"] < 40 or r["h"] < 56:
            fails.append("手牌太小：%.0f×%.0f" % (r["w"], r["h"]))
        for i in info["idx"]:
            card = '#me-hand .card[data-i="%d"]' % i
            page.evaluate("s => document.querySelector(s).scrollIntoView({inline: 'center', block: 'nearest'})", card)
            tap(card)
            page.wait_for_timeout(80)
            if is_shengji:
                break
            if not page.evaluate("s => document.querySelector(s).classList.contains('sel')", card):
                fails.append("点牌后没有选中：%s" % card)
                return
        if not is_shengji:
            tap('#me-actions [data-act="play"]')
        page.wait_for_timeout(150)
        n2 = page.evaluate("() => CGApp.A.game.hands[CGApp.A.human].length")
        if n2 != info["n"] - len(info["idx"]):
            fails.append("点「出牌」后手牌数不对：%d → %d（出 %s）" % (info["n"], n2, info.get("text")))
    elif info["canPass"]:
        tap('#me-actions [data-act="pass"]')
        page.wait_for_timeout(80)
        if not page.evaluate("() => CGApp.A.log.slice(-4).some(l => /（你）.*：过$/.test(l.t))"):
            fails.append("点「过」后没有记录到过牌")
    else:
        fails.append("轮到自己却既没有可出的牌也不能过（不应该出现）")


def scenario(page, size):
    fails = []
    mobile = size["kind"] == "mobile"
    tap = page.tap if mobile else page.click
    has_brain = page.evaluate("() => !!GAME_UI.hasBrain")
    close_help(page, tap, fails, mobile)
    touchp = page.evaluate("() => document.body.classList.contains('touchp')")
    if size["name"] == LANDSCAPE["name"]:
        if touchp or not page.evaluate("() => document.body.classList.contains('touchl')"):
            fails.append("横屏手机没有标成 touchl")
        tap('.mode[data-mode="play"]'); page.wait_for_timeout(300)
        if not visible(page, "#rotate-hint"):
            fails.append("横屏下没有“竖屏体验更佳”提示")
        tap("#rot-ok"); page.wait_for_timeout(100)
        if visible(page, "#rotate-hint"):
            fails.append("点「仍然横屏继续」后提示没消失")
        return fails
    if mobile != touchp:
        fails.append("body.touchp 判断错误：mobile=%s touchp=%s" % (mobile, touchp))
    if not mobile:
        left, right = rect(page, "#left"), rect(page, "#right")
        if not (visible(page, "#right") and right["x"] > left["x"] + left["w"] - 1):
            fails.append("电脑：右栏不在右边")
        if visible(page, "#menu-btn") or visible(page, "#mob-bar"):
            fails.append("电脑上露出了手机的菜单 / 按钮条")
        return fails
    # ---- 手机：头部一行、观战布局 ----
    if not visible(page, "#menu-btn"):
        fails.append("手机头部没有 ☰ 菜单")
    if visible(page, "#exit-btn") or visible(page, "#help-btn"):
        fails.append("手机头部没有压成一行（退出 / ? 还露在外面）")
    t, r = rect(page, "#table"), rect(page, "#right")
    if not visible(page, "#right") or r["y"] < t["b"] - 1:
        fails.append("观战：右栏面板不在牌桌下方（table.bottom=%.0f right.top=%.0f）" % (t["b"], r["y"]))
    if r["w"] > size["w"] + 1:
        fails.append("观战：右栏面板比屏幕宽")
    if has_brain:
        try:   # 第一次出牌后大脑面板才有网络图
            page.wait_for_function("() => !!document.querySelector('#brain-body canvas')", timeout=15000)
        except Exception:
            fails.append("观战：大脑面板没有画出网络")
        else:
            rc = rect(page, "#brain-body canvas")
            if rc["w"] > size["w"] + 1:
                fails.append("观战：网络图比屏幕宽（%.0f）" % rc["w"])
    else:
        if not page.evaluate("() => /这一步依据的规则/.test(document.getElementById('rules-pane').textContent) && document.querySelectorAll('#counter .cnt-cell').length >= 13"):
            fails.append("观战：规则依据面板没有内容")
    tap("#menu-btn"); page.wait_for_timeout(100)
    if hidden(page, "menu"):
        fails.append("☰ 菜单打不开")
    tap("#menu-help"); page.wait_for_timeout(100)
    if hidden(page, "help"):
        fails.append("菜单里的操作说明打不开")
    else:
        tap("#help-ok"); page.wait_for_timeout(100)
    # ---- 我来玩：一屏不滚动 + 触摸出一手牌 ----
    tap('.mode[data-mode="play"]'); page.wait_for_timeout(300)
    if not page.evaluate("() => document.body.classList.contains('m-play')"):
        fails.append("点「我来玩」后没有进入我来玩")
    if not no_page_scroll(page):
        fails.append("我来玩：整页还能滚动 %s" % page.evaluate("() => [document.documentElement.scrollHeight, innerHeight]"))
    if not no_h_overflow(page, size["w"]):
        fails.append("我来玩：横向溢出 %s" % page.evaluate("() => [document.documentElement.scrollWidth, innerWidth]"))
    for sel in ("#table", "#me-hand", "#me-actions", "#brain-toggle"):
        rr = rect(page, sel)
        if rr["y"] < -1 or rr["b"] > size["h"] + 1:
            fails.append("我来玩：%s 不在视口内（top=%.0f bottom=%.0f）" % (sel, rr["y"], rr["b"]))
    if visible(page, "#right"):
        fails.append("我来玩：右栏面板应该收起")
    play_one_move(page, tap, fails)
    if not no_page_scroll(page):
        fails.append("我来玩：出牌后整页又能滚动了")
    # ---- 看大脑 / 看规则依据 → 返回 ----
    tap("#brain-toggle"); page.wait_for_timeout(300)
    if not page.evaluate("() => document.body.classList.contains('sheet-brain')") or not visible(page, "#right"):
        fails.append("「%s」没有打开右栏面板" % page.evaluate("() => document.getElementById('brain-toggle').textContent"))
    else:
        rr = rect(page, "#right")
        if rr["w"] < size["w"] - 2:
            fails.append("右栏面板不是全屏（宽 %.0f）" % rr["w"])
        if not visible(page, "#brain-close"):
            fails.append("右栏面板没有「返回」按钮")
        if has_brain and not page.query_selector("#brain-body canvas, #brain-body .preview-cover, #brain-body .lock, #brain-body .empty"):
            fails.append("「看大脑」打开后大脑面板是空的")
        if not has_brain and not visible(page, "#rules-pane"):
            fails.append("「看规则依据」打开后规则面板不可见")
    tap("#brain-close"); page.wait_for_timeout(150)
    if page.evaluate("() => document.body.classList.contains('sheet-brain')") or visible(page, "#right"):
        fails.append("「返回」没有关掉右栏面板")
    if not no_page_scroll(page):
        fails.append("关掉右栏面板后整页又能滚动了")
    return fails


@pytest.mark.parametrize("index", PAGES, ids=[p.parent.name for p in PAGES])
def test_all_sizes(index):
    base = os.environ.get("CG_CHECK_OUT")
    out = Path(base) / index.parent.name if base else Path(tempfile.mkdtemp(prefix="cg_mobile_"))
    report = mobile_check.run(str(index), out, scenario=scenario, sizes=mobile_check.SIZES + [LANDSCAPE])
    lines = ["%-11s %4dx%-4d %s" % (s["name"], s["w"], s["h"], "通过" if not s["fails"] else "失败：" + " | ".join(s["fails"])) for s in report["sizes"]]
    print("\n".join(lines) + "\n截图：" + str(out))
    assert report["ok"], "\n".join(lines)
