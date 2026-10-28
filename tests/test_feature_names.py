# -*- coding: utf-8 -*-
"""四人斗地主：锁住大脑面板的输入特征名。JS 里的 FEATURE_GROUPS（名称、起点、维数）和逐维名称
必须与 games/ddz4.py 的 encode_state / encode_action 实际拼接顺序逐段、逐维对应。"""
import json
import random
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import pytest

from core.cards import MultiHot, deck, onehot, rank_counter
from games.ddz4 import DDZ4

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")
DUMP = r"""
const {loadPlay} = require('./tests/js/load');
const c = loadPlay(['pyrandom.js', 'core.js', 'ddz4.js']);
const G = c.DDZ4, names = [];
for (let d = 0; d < 1403; d++) names.push(G.featureName(d));
process.stdout.write(JSON.stringify({groups: G.FEATURE_GROUPS, names}));
"""


@pytest.fixture(scope="module")
def js():
    if not NODE:
        pytest.skip("没装 Node.js")
    out = subprocess.run([NODE, "-e", DUMP], cwd=ROOT, capture_output=True, check=True)
    return json.loads(out.stdout.decode("utf-8"))


def _game():
    g = DDZ4(random.Random(11)).reset()
    rng = random.Random(3)
    for _ in range(14):
        legal = g.legal_moves()
        g.step(legal[-1] if len(legal) > 1 else legal[0])
        if g.done:
            break
    return g


def test_groups_cover_1403_in_order(js):
    off = 0
    for gr in js["groups"]:
        assert gr["offset"] == off
        off += gr["dim"]
    assert off == 1403
    assert js["groups"][-1]["key"] == "action" and js["groups"][-1]["offset"] == 1295


def test_each_group_matches_encode_state(js):
    g = _game()
    seat = g.turn
    st = g.encode_state(seat)
    E = DDZ4.ENC
    unseen = Counter(r for r, _ in deck(2))
    unseen.subtract(rank_counter(g.hands[seat]))
    for p in g.played:
        unseen.subtract(rank_counter(p))
    expect = {
        "my_hand": E.encode(g.hands[seat]),
        "unseen": E.encode(list((+unseen).elements())),
        "to_beat": E.encode([(r, "") for r in (g.to_beat.ranks if g.to_beat else ())]),
        "bottom": E.encode(g.bottom),
        **{f"last_{d}": E.encode([(r, "") for r in (() if g.last_action[(seat + d) % 4].is_pass else g.last_action[(seat + d) % 4].ranks)])
           for d in (1, 2, 3)},
        **{f"played_{p}": E.encode(g.played[(g.landlord + i) % 4]) for i, p in enumerate(("landlord", "p1", "p2", "p3"))},
        **{f"left_{d}": onehot(len(g.hands[(seat + d) % 4]) - 1, 33) for d in (1, 2, 3)},
        "bombs": onehot(min(g.bombs_played, 7), 8),
    }
    for gr in js["groups"]:
        if gr["key"] == "action":
            continue
        assert list(st[gr["offset"]:gr["offset"] + gr["dim"]]) == expect[gr["key"]], gr["name"]
    from core.shed import Move
    m = Move("pair", 9, 1, (9, 9))
    assert DDZ4.encode_action(m) == E.encode([(9, ""), (9, "")])


def test_per_dim_names(js):
    names = js["names"]
    gr = next(g for g in js["groups"] if g["key"] == "my_hand")
    E = MultiHot(range(3, 16), 8, 2)
    for r in list(range(3, 16)) + [16, 17]:
        for c in (1, 2) if r >= 16 else (1, 4, 8):
            on = [i for i, v in enumerate(E.encode([(r, "")] * c)) if v]
            name = {15: "2", 16: "小王", 17: "大王", 11: "J", 12: "Q", 13: "K", 14: "A"}.get(r, str(r))
            assert [names[gr["offset"] + i] for i in on] == [f"{gr['name']}·{name}·第{k}张" for k in range(1, c + 1)]
    left = next(g for g in js["groups"] if g["key"] == "left_1")
    assert names[left["offset"] + 4] == f"{left['name']}=5"
    bombs = next(g for g in js["groups"] if g["key"] == "bombs")
    assert names[bombs["offset"] + 7] == f"{bombs['name']}=7及以上"
