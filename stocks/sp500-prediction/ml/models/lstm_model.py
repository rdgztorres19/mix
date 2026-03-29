"""
LSTM model wrapper for sequential prediction.
Requires reshaping data into sliding windows.
"""

import numpy as np
import os

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

NAME = "LSTM"
SEQUENCE_LENGTH = 20


def prepare_sequences(X: np.ndarray, y: np.ndarray, seq_len: int = SEQUENCE_LENGTH):
    """
    Create sliding window sequences from flat feature matrix.
    Input: X (n_samples, n_features), y (n_samples,)
    Output: X_seq (n_samples - seq_len, seq_len, n_features), y_seq (n_samples - seq_len,)
    """
    n = len(X)
    if n <= seq_len:
        return np.array([]), np.array([])

    X_seq = []
    y_seq = []
    for i in range(seq_len, n):
        X_seq.append(X[i - seq_len:i])
        y_seq.append(y[i])

    return np.array(X_seq), np.array(y_seq)


def make_model(is_multiclass: bool, is_regression: bool = False, **overrides):
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM as LSTMLayer, Dense, Dropout

    seq_len = overrides.pop("sequence_length", SEQUENCE_LENGTH)
    n_features = overrides.pop("n_features", 12)

    model = Sequential([
        LSTMLayer(64, return_sequences=True, input_shape=(seq_len, n_features)),
        Dropout(0.3),
        LSTMLayer(32, return_sequences=False),
        Dropout(0.3),
    ])

    if is_regression:
        model.add(Dense(1, activation="linear"))
        model.compile(optimizer="adam", loss="mse", metrics=["mae"])
    elif is_multiclass:
        n_classes = overrides.get("n_classes", 3)
        model.add(Dense(n_classes, activation="softmax"))
        model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    else:
        model.add(Dense(1, activation="sigmoid"))
        model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])

    return model


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    fit_params = dict(
        epochs=50,
        batch_size=32,
        verbose=0,
    )
    if X_val is not None and y_val is not None:
        fit_params["validation_data"] = (X_val, y_val)
    if sample_weight is not None:
        fit_params["sample_weight"] = sample_weight

    model.fit(X_train, y_train, **fit_params)
    return model
