"""XGBoost model wrapper — supports classification and regression."""

from xgboost import XGBClassifier, XGBRegressor


def make_model(is_multiclass: bool, is_regression: bool = False, **overrides):
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
        verbosity=0,
        n_jobs=-1,
    )

    if is_regression:
        params["objective"] = "reg:squarederror"
        params.update(overrides)
        return XGBRegressor(**params)

    if is_multiclass:
        params["objective"] = "multi:softprob"
    else:
        params["objective"] = "binary:logistic"
        params["scale_pos_weight"] = 1

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
