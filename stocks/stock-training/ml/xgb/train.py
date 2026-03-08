#!/usr/bin/env python3
"""
Entrena HistGradientBoostingClassifier (sklearn) sobre el CSV de 1 minuto.
- Split temporal: train 80% más antiguo, test 20% más reciente (orden date, symbol, candle_idx)
- Target multiclase: -1 (bajista), 0 (neutral), 1 (alcista)
- Normalización z-score: StandardScaler solo en train, guardado con el modelo
"""

import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import pandas as pd
import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    classification_report,
    confusion_matrix,
)

import config

CLASS_LABELS_MULTICLASS = (-1, 0, 1)
CLASS_NAMES = {"-1": "Bajista", "0": "Neutral", "1": "Alcista"}


def load_and_prepare():
    """Carga CSV, elimina filas sin target, rellena NaN. Soporta 31 o 57 cols."""
    with open(config.CSV_PATH, "r") as f:
        first = f.readline()
    has_header = "symbol" in first.lower()
    if has_header:
        df = pd.read_csv(config.CSV_PATH, header=0, low_memory=False)
    else:
        ncols = len(first.split(","))
        names = config.CSV_COLUMNS_FULL if ncols >= 40 else config.CSV_COLUMNS
        df = pd.read_csv(config.CSV_PATH, header=None, names=names, low_memory=False)
    df = df.dropna(subset=[config.TARGET_COLUMN])
    if len(df) == 0:
        raise ValueError(
            f"0 filas tras cargar. Verifica: {config.CSV_PATH}\n"
            "  - Columna 'target' debe existir y tener valores -1/0/1\n"
            "  - Si usas training.csv (31 cols), ejecuta: npm run add-features"
        )
    df[config.TARGET_COLUMN] = df[config.TARGET_COLUMN].astype(int)
    unique_labels = sorted(df[config.TARGET_COLUMN].unique())
    is_binary = set(unique_labels).issubset({0, 1})
    class_labels = (0, 1) if is_binary else CLASS_LABELS_MULTICLASS
    invalid = ~df[config.TARGET_COLUMN].isin(class_labels)
    if invalid.any():
        df = df[~invalid]
        if len(df) == 0:
            raise ValueError(f"No quedan filas con target en {class_labels}")

    # Ordenar por (date, symbol, candle_idx) para split temporal
    sort_cols = ["date", "symbol", "candle_idx"]
    if all(c in df.columns for c in sort_cols):
        df = df.sort_values(by=sort_cols).reset_index(drop=True)
    else:
        print("  (sin date/symbol/candle_idx, usando orden original)")

    # Features
    X = pd.DataFrame()
    for c in config.FEATURE_COLUMNS:
        X[c] = df[c] if c in df.columns else 0
    for col in X.columns:
        if X[col].dtype in ("float64", "int64"):
            X[col] = X[col].fillna(X[col].median())
    X = X.fillna(0)

    y = df[config.TARGET_COLUMN].values
    return X, y


def temporal_split(X, y, train_frac=0.8, embargo_rows=0):
    """
    Split temporal: train = primeros train_frac, test = últimos (1-train_frac).
    embargo_rows: filas a omitir entre train y test (evitar leakage).
    """
    n = len(X)
    train_end = int(n * train_frac)
    if embargo_rows > 0:
        test_start = min(train_end + embargo_rows, n - 1)
    else:
        test_start = train_end
    X_train = X.iloc[:train_end]
    y_train = y[:train_end]
    X_test = X.iloc[test_start:]
    y_test = y[test_start:]
    return X_train, X_test, y_train, y_test


def main():
    print("Cargando datos...")
    X, y = load_and_prepare()
    class_labels = tuple(sorted(np.unique(y)))
    is_binary = len(class_labels) == 2 and set(class_labels).issubset({0, 1})
    print(f"Filas: {len(X)}, Features: {len(config.FEATURE_COLUMNS)}, Target: {'binario' if is_binary else 'multiclase'}")
    for c in class_labels:
        cnt = (y == c).sum()
        print(f"  Clase {c}: {cnt} ({100*cnt/len(y):.1f}%)")

    X_train, X_test, y_train, y_test = temporal_split(X, y, train_frac=0.8)

    n_total = len(y_train)
    n_classes = len(class_labels)
    class_counts = {c: (y_train == c).sum() for c in class_labels}
    sample_weight = np.array([
        n_total / (n_classes * max(1, class_counts.get(yi, 1)))
        for yi in y_train
    ])

    # Z-score: fit solo en train
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    print("\nEntrenando HistGradientBoosting (multiclase)...")
    model = HistGradientBoostingClassifier(
        max_iter=100,
        max_depth=6,
        learning_rate=0.1,
        random_state=42,
    )
    model.fit(X_train_scaled, y_train, sample_weight=sample_weight)

    models_dir = Path(__file__).resolve().parent / "models"
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "xgb_model.joblib"
    scaler_path = models_dir / "xgb_scaler.joblib"
    joblib.dump(model, model_path)
    joblib.dump(scaler, scaler_path)
    print(f"\nModelo guardado en {model_path}")
    print(f"Scaler guardado en {scaler_path}")

    y_pred = model.predict(X_test_scaled)
    y_proba = model.predict_proba(X_test_scaled)

    print("\n--- Métricas ---")
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print(f"Precision (macro): {precision_score(y_test, y_pred, average='macro', zero_division=0):.4f}")
    print(f"Recall (macro):    {recall_score(y_test, y_pred, average='macro', zero_division=0):.4f}")
    print(f"F1 (macro):        {f1_score(y_test, y_pred, average='macro', zero_division=0):.4f}")

    proba_threshold = getattr(config, "BULLISH_PROBA_THRESHOLD", 0.7)
    idx_bullish = list(model.classes_).index(1) if 1 in model.classes_ else -1
    proba_bullish = y_proba[:, idx_bullish] if idx_bullish >= 0 else np.zeros(len(y_test))
    at_threshold = (proba_bullish > proba_threshold) & (y_test == 1)
    precision_at_7 = at_threshold.sum() / max(1, (proba_bullish > proba_threshold).sum())
    print(f"\n--- Precision con P(bullish) > {proba_threshold} ---")
    print(f"  Filas tradeables: {(proba_bullish > proba_threshold).sum()}")
    print(f"  Precision: {precision_at_7:.4f}")

    print("\n--- Classification Report ---")
    target_names = [str(c) for c in model.classes_]
    print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    print("--- Matriz de confusión ---")
    cm = confusion_matrix(y_test, y_pred, labels=class_labels)
    print(cm)

    meta_path = models_dir / "xgb_meta.json"
    meta = {
        "n_classes": len(class_labels),
        "class_labels": list(int(c) for c in class_labels),
        "feature_columns": config.FEATURE_COLUMNS,
        "proba_threshold": proba_threshold,
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"\nMeta guardado en {meta_path}")

    print("\n--- Feature Importances (top 10) ---")
    if hasattr(model, "feature_importances_"):
        imp = pd.Series(
            model.feature_importances_, index=config.FEATURE_COLUMNS
        ).sort_values(ascending=False)
        for name, val in imp.head(10).items():
            print(f"  {name}: {val:.4f}")
    else:
        print("  (no disponible para HistGradientBoosting)")


if __name__ == "__main__":
    main()
