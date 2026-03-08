#!/usr/bin/env python3
"""
Carga el modelo RF guardado y evalúa sobre el conjunto de test.
Soporta umbral configurable para ajustar recall vs precisión.
Uso: python -m random_forest.evaluate [--threshold 0.4] [--compare]
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    recall_score,
    precision_score,
    precision_recall_fscore_support,
)

import config


def load_and_prepare():
    """Carga CSV y prepara X, y."""
    df = pd.read_csv(config.CSV_PATH, header=None, names=config.CSV_COLUMNS)
    df = df.dropna(subset=[config.TARGET_COLUMN])
    df[config.TARGET_COLUMN] = df[config.TARGET_COLUMN].astype(int)

    X = df[config.FEATURE_COLUMNS].copy()
    for col in X.columns:
        if X[col].dtype in ("float64", "int64"):
            X[col] = X[col].fillna(X[col].median())
    X = X.fillna(0)

    y = df[config.TARGET_COLUMN]
    return X, y


def main():
    parser = argparse.ArgumentParser(description="Evalúa el modelo RF con umbral configurable")
    parser.add_argument("--threshold", type=float, default=0.5, help="Umbral para clase 1 (default: 0.5)")
    parser.add_argument("--compare", action="store_true", help="Comparar métricas para varios umbrales")
    parser.add_argument("--json", action="store_true", help="Salida JSON para API (incluye compare)")
    args = parser.parse_args()

    model_path = Path(__file__).resolve().parent / "models" / "rf_model.joblib"
    if not model_path.exists():
        print(f"Modelo no encontrado: {model_path}")
        print("Ejecuta primero: python -m random_forest.train")
        sys.exit(1)

    print("Cargando modelo y datos...")
    model = joblib.load(model_path)
    X, y = load_and_prepare()

    _, X_test, _, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    proba = model.predict_proba(X_test)[:, 1]  # P(clase 1)

    if args.json:
        thresholds = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]
        compare_data = []
        for th in thresholds:
            yp = (proba >= th).astype(int)
            r1 = recall_score(y_test, yp, pos_label=1, zero_division=0)
            p1 = precision_score(y_test, yp, pos_label=1, zero_division=0)
            compare_data.append({"thr": th, "recall_1": round(r1, 4), "prec_1": round(p1, 4), "pred_1": int(yp.sum())})

        y_pred = (proba >= args.threshold).astype(int)
        prec, rec, f1, _ = precision_recall_fscore_support(y_test, y_pred, labels=[0, 1], zero_division=0)
        cm = confusion_matrix(y_test, y_pred)
        out = {
            "threshold_comparison": compare_data,
            "threshold": args.threshold,
            "classification": {
                "0": {"precision": round(prec[0], 4), "recall": round(rec[0], 4), "f1": round(f1[0], 4)},
                "1": {"precision": round(prec[1], 4), "recall": round(rec[1], 4), "f1": round(f1[1], 4)},
            },
            "confusion_matrix": cm.tolist(),
        }
        print(json.dumps(out))
        return

    if args.compare:
        print("\n--- Comparación por umbral ---")
        print(f"{'Thr':>5}  {'Recall 1':>8}  {'Prec 1':>8}  {'Pred 1':>8}")
        print("-" * 40)
        for th in [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]:
            y_pred = (proba >= th).astype(int)
            r1 = recall_score(y_test, y_pred, pos_label=1, zero_division=0)
            p1 = precision_score(y_test, y_pred, pos_label=1, zero_division=0)
            n1 = y_pred.sum()
            print(f"{th:5.2f}  {r1:8.2%}  {p1:8.2%}  {n1:8d}")
        print()

    y_pred = (proba >= args.threshold).astype(int)
    print(f"\n--- Umbral: {args.threshold} ---")
    print("\n--- Classification Report ---")
    print(classification_report(y_test, y_pred, target_names=["0", "1"]))

    print("\n--- Confusion Matrix ---")
    cm = confusion_matrix(y_test, y_pred)
    print("         Pred 0  Pred 1")
    print(f"True 0   {cm[0][0]:6d}  {cm[0][1]:6d}")
    print(f"True 1   {cm[1][0]:6d}  {cm[1][1]:6d}")


if __name__ == "__main__":
    main()
