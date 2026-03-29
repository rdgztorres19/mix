"""Random Forest model wrapper — supports classification and regression."""

from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor


def make_model(is_multiclass: bool, is_regression: bool = False, **overrides):
    params = dict(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=10,
        min_samples_split=20,
        max_features="sqrt",
        random_state=42,
        n_jobs=-1,
    )

    if is_regression:
        params.update(overrides)
        return RandomForestRegressor(**params)

    params["class_weight"] = "balanced"
    params.update(overrides)
    return RandomForestClassifier(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    model.fit(X_train, y_train, sample_weight=sample_weight)
    return model


NAME = "RandomForest"
