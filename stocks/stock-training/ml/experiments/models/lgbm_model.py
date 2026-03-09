"""
LightGBM wrapper.
"""

import numpy as np
from lightgbm import LGBMClassifier


def make_model(is_multiclass: bool, **overrides) -> LGBMClassifier:
    params = dict(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_samples=20,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        n_jobs=-1,
        verbose=-1,
    )
    if is_multiclass:
        params["objective"] = "multiclass"
        params["metric"] = "multi_logloss"
    else:
        params["objective"] = "binary"
        params["metric"] = "binary_logloss"
    params.update(overrides)
    return LGBMClassifier(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    fit_params = {}
    if sample_weight is not None:
        fit_params["sample_weight"] = sample_weight
    if X_val is not None and y_val is not None:
        fit_params["eval_set"] = [(X_val, y_val)]
    model.fit(X_train, y_train, **fit_params)
    return model


NAME = "LightGBM"
