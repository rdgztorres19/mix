#!/usr/bin/env python3
"""
Evalúa el modelo sobre el conjunto de test (split temporal, multiclase).
Carga scaler, aplica z-score a X, métricas por clase y matriz 3×3.
Uso: python -m xgb.evaluate [--json]
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)

import config



def load_and_prepare():
    """Carga CSV y prepara X, y. Orden temporal para split consistente."""
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
            "  - Columna 'target' debe existir y tener valores -1/0/1"
        )
    df[config.TARGET_COLUMN] = df[config.TARGET_COLUMN].astype(int)

    sort_cols = ["date", "symbol", "candle_idx"]
    if all(c in df.columns for c in sort_cols):
        df = df.sort_values(by=sort_cols).reset_index(drop=True)

    X = pd.DataFrame()
    for c in config.FEATURE_COLUMNS:
        X[c] = df[c] if c in df.columns else 0
    for col in X.columns:
        if X[col].dtype in ("float64", "int64"):
            X[col] = X[col].fillna(X[col].median())
    X = X.fillna(0)

    y = df[config.TARGET_COLUMN].values
    return X, y


def temporal_split(X, y, train_frac=0.8):
    """Mismo split que train: test = últimos 20%."""
    n = len(X)
    test_start = int(n * train_frac)
    return X.iloc[test_start:], y[test_start:]


def main():
    parser = argparse.ArgumentParser(description="Evalúa el modelo (multiclase)")
    parser.add_argument("--json", action="store_true", help="Salida JSON para API")
    args = parser.parse_args()

    models_dir = Path(__file__).resolve().parent / "models"
    model_path = models_dir / "xgb_model.joblib"
    scaler_path = models_dir / "xgb_scaler.joblib"

    if not model_path.exists():
        print(f"Modelo no encontrado: {model_path}")
        print("Ejecuta primero: python -m xgb.train")
        sys.exit(1)

    print("Cargando modelo, scaler y datos...")
    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None
    X, y = load_and_prepare()

    feature_cols = config.FEATURE_COLUMNS
    meta_path = models_dir / "xgb_meta.json"
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            feature_cols = meta.get("feature_columns", feature_cols)
        except Exception:
            pass

    for c in feature_cols:
        if c not in X.columns:
            X[c] = 0
    X = X[feature_cols]

    X_test, y_test = temporal_split(X, y, train_frac=0.8)
    if scaler is not None:
        X_test = scaler.transform(X_test)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)
    class_labels = tuple(model.classes_)
    proba_threshold = 0.7
    if meta_path.exists():
        try:
            with open(meta_path) as f:
                m = json.load(f)
            proba_threshold = m.get("proba_threshold", 0.7)
        except Exception:
            pass
    idx_bullish = list(class_labels).index(1) if 1 in class_labels else -1
    proba_bullish = y_proba[:, idx_bullish] if idx_bullish >= 0 else np.zeros(len(y_test))
    tradeable_mask = proba_bullish > proba_threshold
    prec_at_threshold = (tradeable_mask & (y_test == 1)).sum() / max(1, tradeable_mask.sum()) if tradeable_mask.any() else 0

    if args.json:
        prec = precision_score(y_test, y_pred, labels=class_labels, average=None, zero_division=0)
        rec = recall_score(y_test, y_pred, labels=class_labels, average=None, zero_division=0)
        f1 = f1_score(y_test, y_pred, labels=class_labels, average=None, zero_division=0)
        cm = confusion_matrix(y_test, y_pred, labels=class_labels)
        out = {
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "precision_macro": round(float(precision_score(y_test, y_pred, average="macro", zero_division=0)), 4),
            "recall_macro": round(float(recall_score(y_test, y_pred, average="macro", zero_division=0)), 4),
            "f1_macro": round(float(f1_score(y_test, y_pred, average="macro", zero_division=0)), 4),
            "precision_at_proba_0.7": round(float(prec_at_threshold), 4),
            "per_class": {
                str(c): {"precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4)}
                for c, p, r, f in zip(class_labels, prec, rec, f1)
            },
            "confusion_matrix": cm.tolist(),
        }
        print(json.dumps(out))
        return

    print(f"\n--- Precision con P(bullish) > {proba_threshold} ---")
    print(f"  {prec_at_threshold:.4f}")
    print("\n--- Métricas ---")
    print(f"Accuracy: {accuracy_score(y_test, y_pred):.4f}")
    print(f"Precision (macro): {precision_score(y_test, y_pred, average='macro', zero_division=0):.4f}")
    print(f"Recall (macro):    {recall_score(y_test, y_pred, average='macro', zero_division=0):.4f}")
    print(f"F1 (macro):        {f1_score(y_test, y_pred, average='macro', zero_division=0):.4f}")
    print("\n--- Classification Report ---")
    target_names = [str(c) for c in model.classes_]
    print(classification_report(y_test, y_pred, target_names=target_names, zero_division=0))
    print("--- Matriz de confusión ---")
    cm = confusion_matrix(y_test, y_pred, labels=class_labels)
    print(cm)


if __name__ == "__main__":
    main()
