#!/usr/bin/env python3
"""
Entrena un Random Forest sobre el CSV de 1 minuto (training.csv).
Predice target (0/1) a partir de las features tabulares.
"""

import sys
from pathlib import Path

# Add parent (ml/) to path for config import
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import joblib
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, classification_report

import config


def load_and_prepare():
    """Carga CSV, elimina filas sin target, rellena NaN."""
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
    print("Cargando datos...")
    X, y = load_and_prepare()
    print(f"Filas: {len(X)}, Features: {len(config.FEATURE_COLUMNS)}")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    print("\nEntrenando Random Forest...")
    model = RandomForestClassifier(
        n_estimators=100,
        max_depth=10,
        random_state=42,
        n_jobs=-1,
        class_weight='balanced',
    )
    model.fit(X_train, y_train)

    models_dir = Path(__file__).resolve().parent / "models"
    models_dir.mkdir(exist_ok=True)
    model_path = models_dir / "rf_model.joblib"
    joblib.dump(model, model_path)
    print(f"\nModelo guardado en {model_path}")

    y_pred = model.predict(X_test)
    print("\n--- Métricas ---")
    print(f"Accuracy:  {accuracy_score(y_test, y_pred):.4f}")
    print(f"Precision: {precision_score(y_test, y_pred, zero_division=0):.4f}")
    print(f"Recall:    {recall_score(y_test, y_pred, zero_division=0):.4f}")
    print(f"F1:       {f1_score(y_test, y_pred, zero_division=0):.4f}")
    print("\n--- Classification Report ---")
    print(classification_report(y_test, y_pred, target_names=["0", "1"]))

    print("\n--- Feature Importances (top 10) ---")
    imp = pd.Series(model.feature_importances_, index=config.FEATURE_COLUMNS).sort_values(ascending=False)
    for name, val in imp.head(10).items():
        print(f"  {name}: {val:.4f}")


if __name__ == "__main__":
    main()
