# -*- coding: utf-8 -*-
"""通用 Deep Monte Carlo：任意游戏（实现 encode_state/encode_action/position 即可）。"""

import os

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import random

import numpy as np
import torch
import torch.nn as nn


class QNet(nn.Module):
    def __init__(self, in_dim, hidden=(512, 256, 128)):
        super().__init__()
        layers, d = [], in_dim
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)


class DMCAgent:
    """每个"身份"一张 Q 网络；动作编码进输入，输出标量 Q(s,a)。"""

    def __init__(self, positions, epsilon=0.0, seed=None, device="cpu"):
        self.positions = list(positions)
        self.epsilon = epsilon
        self.rng = random.Random(seed)
        self.device = device
        self.nets = {}
        self.in_dim = None

    def net(self, pos, in_dim=None):
        if pos not in self.nets:
            self.in_dim = self.in_dim or in_dim
            self.nets[pos] = QNet(self.in_dim).to(self.device)
        return self.nets[pos]

    def encode_pair(self, game, state, move):
        return np.asarray(state + game.encode_action(move), dtype=np.float32)

    @torch.no_grad()
    def act(self, game):
        legal = game.legal_moves()
        if len(legal) == 1:
            return legal[0]
        if self.epsilon > 0 and self.rng.random() < self.epsilon:
            return self.rng.choice(legal)
        seat = game.turn
        state = game.encode_state(seat)
        x = np.stack([self.encode_pair(game, state, m) for m in legal])
        net = self.net(game.position(seat), x.shape[1])
        q = net(torch.from_numpy(x).to(self.device))
        q = q + 1e-3 * torch.rand_like(q)        # 破并列防塌缩
        return legal[int(torch.argmax(q).item())]

    def save(self, path):
        torch.save({"in_dim": self.in_dim,
                    "nets": {p: n.state_dict() for p, n in self.nets.items()}}, path)

    def load(self, path):
        ck = torch.load(path, map_location=self.device, weights_only=True)
        self.in_dim = ck["in_dim"]
        for p, sd in ck["nets"].items():
            self.net(p, self.in_dim).load_state_dict(sd)
        self.epsilon = 0.0
        return self
