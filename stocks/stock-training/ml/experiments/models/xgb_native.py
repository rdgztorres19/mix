"""
XGBoost native wrapper.
Uses xgboost.XGBClassifier with GPU-optional, early stopping, scale_pos_weight.
"""

import numpy as np
from xgboost import XGBClassifier


def make_model(is_multiclass: bool, **overrides) -> XGBClassifier:
    params = dict(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=1,
        reg_alpha=0.1,
        reg_lambda=1.0,
        random_state=42,
        n_jobs=-1,
        eval_metric="mlogloss" if is_multiclass else "logloss",
        use_label_encoder=False,
        tree_method="hist",
    )
    if is_multiclass:
        params["objective"] = "multi:softprob"
    else:
        params["objective"] = "binary:logistic"
    params.update(overrides)
    return XGBClassifier(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    fit_params = {}
    if sample_weight is not None:
        fit_params["sample_weight"] = sample_weight
    if X_val is not None and y_val is not None:
        fit_params["eval_set"] = [(X_val, y_val)]
        fit_params["verbose"] = False
    model.fit(X_train, y_train, **fit_params)
    return model


NAME = "XGBoost"
