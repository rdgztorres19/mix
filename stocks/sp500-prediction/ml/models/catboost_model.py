"""CatBoost model wrapper — supports classification and regression."""

from catboost import CatBoostClassifier, CatBoostRegressor


def make_model(is_multiclass: bool, is_regression: bool = False, **overrides):
    params = dict(
        iterations=300,
        depth=6,
        learning_rate=0.05,
        l2_leaf_reg=3,
        random_seed=42,
        verbose=0,
    )

    if is_regression:
        params["loss_function"] = "RMSE"
        params.update(overrides)
        return CatBoostRegressor(**params)

    params["auto_class_weights"] = "Balanced"
    params["eval_metric"] = "TotalF1" if is_multiclass else "F1"
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
