"""LightGBM model wrapper — supports classification and regression."""

from lightgbm import LGBMClassifier, LGBMRegressor


def make_model(is_multiclass: bool, is_regression: bool = False, **overrides):
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
        verbose=-1,
        n_jobs=-1,
    )

    if is_regression:
        params.pop("verbose", None)
        params["verbosity"] = -1
        params.update(overrides)
        return LGBMRegressor(**params)

    if is_multiclass:
        params["objective"] = "multiclass"
    else:
        params["class_weight"] = "balanced"

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
