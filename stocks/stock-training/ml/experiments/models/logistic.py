"""
Logistic Regression wrapper — baseline model.
"""

from sklearn.linear_model import LogisticRegression


def make_model(is_multiclass: bool, **overrides) -> LogisticRegression:
    params = dict(
        max_iter=1000,
        C=1.0,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    if is_multiclass:
        params["multi_class"] = "multinomial"
        params["solver"] = "lbfgs"
    else:
        params["solver"] = "lbfgs"
    params.update(overrides)
    return LogisticRegression(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    model.fit(X_train, y_train, sample_weight=sample_weight)
    return model


NAME = "LogisticRegression"
