"""
lstm_momentum.py — PyTorch LSTM/GRU/CNN-LSTM/Transformer for SPY sequence prediction.

Input:  (batch, seq_len, n_features)
Output: (batch, 1) — logit for binary classification
"""

import torch
import torch.nn as nn


class LSTMMomentum(nn.Module):
    def __init__(
        self,
        n_features: int,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
        bidirectional: bool = False,
    ):
        super().__init__()
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        self.bidirectional = bidirectional

        self.lstm = nn.LSTM(
            input_size=n_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
            bidirectional=bidirectional,
        )

        fc_input = hidden_size * (2 if bidirectional else 1)

        self.classifier = nn.Sequential(
            nn.Linear(fc_input, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        lstm_out, (h_n, c_n) = self.lstm(x)
        if self.bidirectional:
            last = torch.cat([lstm_out[:, -1, :self.hidden_size],
                              lstm_out[:, 0, self.hidden_size:]], dim=1)
        else:
            last = lstm_out[:, -1, :]
        return self.classifier(last).squeeze(-1)


class GRUMomentum(nn.Module):
    """GRU variant — often faster and comparable to LSTM."""
    def __init__(
        self,
        n_features: int,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.gru = nn.GRU(
            input_size=n_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
        )
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        gru_out, _ = self.gru(x)
        last = gru_out[:, -1, :]
        return self.classifier(last).squeeze(-1)


class LSTMWithAttention(nn.Module):
    """LSTM with soft self-attention over all timesteps instead of just the last."""
    def __init__(
        self,
        n_features: int,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=n_features,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
        )
        self.attention = nn.Linear(hidden_size, 1)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        lstm_out, _ = self.lstm(x)                        # (batch, seq_len, hidden)
        attn_scores = self.attention(lstm_out)             # (batch, seq_len, 1)
        attn_weights = torch.softmax(attn_scores, dim=1)  # (batch, seq_len, 1)
        context = (lstm_out * attn_weights).sum(dim=1)    # (batch, hidden)
        return self.classifier(context).squeeze(-1)


class CNNLSTMAttention(nn.Module):
    """CNN extracts local feature patterns → LSTM models temporal sequence → Attention weights timesteps.
    Research: ~40% RMSE improvement over plain LSTM (Zhang et al., 2023)."""
    def __init__(
        self,
        n_features: int,
        hidden_size: int = 64,
        num_layers: int = 2,
        dropout: float = 0.3,
        num_filters: int = 64,
        kernel_size: int = 3,
    ):
        super().__init__()
        self.conv1 = nn.Conv1d(n_features, num_filters, kernel_size, padding=kernel_size // 2)
        self.bn1   = nn.BatchNorm1d(num_filters)
        self.conv2 = nn.Conv1d(num_filters, num_filters * 2, kernel_size, padding=kernel_size // 2)
        self.bn2   = nn.BatchNorm1d(num_filters * 2)
        self.relu  = nn.ReLU()
        self.drop  = nn.Dropout(dropout)

        self.lstm = nn.LSTM(
            input_size=num_filters * 2,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0,
        )
        self.attention = nn.Linear(hidden_size, 1)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        # x: (batch, seq_len, n_features)
        x = x.permute(0, 2, 1)                              # (batch, n_features, seq_len)
        x = self.drop(self.relu(self.bn1(self.conv1(x))))
        x = self.drop(self.relu(self.bn2(self.conv2(x))))
        x = x.permute(0, 2, 1)                              # (batch, seq_len, num_filters*2)
        lstm_out, _ = self.lstm(x)
        attn_weights = torch.softmax(self.attention(lstm_out), dim=1)
        context = (lstm_out * attn_weights).sum(dim=1)       # (batch, hidden)
        return self.classifier(context).squeeze(-1)


class TransformerMomentum(nn.Module):
    """Simple Transformer encoder for sequence classification."""
    def __init__(
        self,
        n_features: int,
        d_model: int = 64,
        nhead: int = 4,
        num_layers: int = 2,
        dropout: float = 0.3,
        max_seq_len: int = 100,
    ):
        super().__init__()
        self.d_model = d_model

        self.input_proj = nn.Linear(n_features, d_model)

        pe = torch.zeros(max_seq_len, d_model)
        position = torch.arange(0, max_seq_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-torch.log(torch.tensor(10000.0)) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer('pe', pe.unsqueeze(0))  # (1, max_seq_len, d_model)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead,
            dim_feedforward=d_model * 4,
            dropout=dropout, batch_first=True,
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)

        self.classifier = nn.Sequential(
            nn.Linear(d_model, 32),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(32, 1),
        )

    def forward(self, x):
        seq_len = x.size(1)
        x = self.input_proj(x)
        x = x + self.pe[:, :seq_len, :]
        x = self.transformer(x)
        x = x[:, -1, :]
        return self.classifier(x).squeeze(-1)
