"""
Extra Trees wrapper.
"""

from sklearn.ensemble import ExtraTreesClassifier


def make_model(is_multiclass: bool, **overrides) -> ExtraTreesClassifier:
    params = dict(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=10,
        min_samples_split=20,
        max_features="sqrt",
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    params.update(overrides)
    return ExtraTreesClassifier(**params)


def train(model, X_train, y_train, X_val=None, y_val=None, sample_weight=None):
    model.fit(X_train, y_train, sample_weight=sample_weight)
    return model


NAME = "ExtraTrees"
