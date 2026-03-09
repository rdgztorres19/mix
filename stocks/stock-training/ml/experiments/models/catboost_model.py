"""
CatBoost wrapper.
"""

from catboost import CatBoostClassifier


def make_model(is_multiclass: bool, **overrides) -> CatBoostClassifier:
    params = dict(
        iterations=300,
        depth=6,
        learning_rate=0.05,
        l2_leaf_reg=3,
        random_seed=42,
        verbose=0,
        auto_class_weights="Balanced",
        eval_metric="TotalF1" if is_multiclass else "F1",
    )
    if is_multiclass:
        params["loss_function"] = "MultiClass"
    else:
        params["loss_function"] = "Logloss"
    params.update(overrides)
    return CatBoostClassifier(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    fit_params = {}
    if sample_weight is not None:
        fit_params["sample_weight"] = sample_weight
    if X_val is not None and y_val is not None:
        fit_params["eval_set"] = (X_val, y_val)
    model.fit(X_train, y_train, **fit_params)
    return model


NAME = "CatBoost"
