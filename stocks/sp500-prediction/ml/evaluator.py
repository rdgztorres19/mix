"""
Evaluator — metricas de clasificacion y regresion, logging de resultados.
"""

from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score,
    classification_report, mean_squared_error, mean_absolute_error, r2_score,
)

RESULTS_DIR = Path(__file__).resolve().parent / "results"
GRID_CSV = RESULTS_DIR / "grid_results.csv"


def evaluate_classifier(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_proba_all: np.ndarray,
    model_name: str,
    feature_set: str,
    target_name: str,
    is_multiclass: bool,
    thresholds: list[float] | None = None,
) -> dict:
    """Full classification evaluation. Returns dict with all metrics."""
    if thresholds is None:
        thresholds = [0.4, 0.5, 0.6, 0.7, 0.8]

    result = {
        "model": model_name,
        "feature_set": feature_set,
        "target": target_name,
        "type": "classification",
        "n_test": len(y_true),
        "accuracy": accuracy_score(y_true, y_pred),
        "precision_macro": precision_score(y_true, y_pred, average="macro", zero_division=0),
        "recall_macro": recall_score(y_true, y_pred, average="macro", zero_division=0),
        "f1_macro": f1_score(y_true, y_pred, average="macro", zero_division=0),
    }

    # Per-class metrics
    unique_labels = sorted(np.unique(y_true))
    for lab in unique_labels:
        mask = y_true == lab
        result[f"class_{lab}_precision"] = precision_score(y_true == lab, y_pred == lab, zero_division=0)
        result[f"class_{lab}_recall"] = recall_score(y_true == lab, y_pred == lab, zero_division=0)
        result[f"class_{lab}_support"] = int(mask.sum())

    # Precision@threshold for binary (class 1 probability)
    if not is_multiclass and y_proba_all.shape[1] >= 2:
        prob_1 = y_proba_all[:, 1]
        for th in thresholds:
            mask = prob_1 >= th
            n_signals = mask.sum()
            if n_signals > 0:
                prec = (y_true[mask] == 1).sum() / n_signals
            else:
                prec = 0.0
            result[f"prec@{th}"] = prec
            result[f"signals@{th}"] = int(n_signals)

    return result


def evaluate_regressor(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    model_name: str,
    feature_set: str,
    target_name: str,
) -> dict:
    """Regression evaluation with directional accuracy."""
    result = {
        "model": model_name,
        "feature_set": feature_set,
        "target": target_name,
        "type": "regression",
        "n_test": len(y_true),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "r2": float(r2_score(y_true, y_pred)),
    }

    # Directional accuracy: what % of time predicted sign matches actual sign
    dir_correct = ((y_pred > 0) == (y_true > 0)).sum()
    result["directional_accuracy"] = float(dir_correct / max(len(y_true), 1))

    return result


def log_result(result: dict):
    """Append result dict as a row in grid_results.csv."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    df_row = pd.DataFrame([result])
    if GRID_CSV.exists():
        df_row.to_csv(GRID_CSV, mode="a", header=False, index=False)
    else:
        df_row.to_csv(GRID_CSV, mode="w", header=True, index=False)


def print_result(result: dict):
    """Pretty-print evaluation result to console."""
    print(f"\n{'='*70}")
    print(f"  Model: {result['model']}  |  Features: {result['feature_set']}  |  Target: {result['target']}")
    print(f"{'='*70}")

    if result.get("type") == "regression":
        print(f"  RMSE:            {result['rmse']:.6f}")
        print(f"  MAE:             {result['mae']:.6f}")
        print(f"  R2:              {result['r2']:.4f}")
        print(f"  Dir. Accuracy:   {result['directional_accuracy']:.4f}")
    else:
        print(f"  Accuracy:       {result['accuracy']:.4f}")
        print(f"  Precision(mac): {result['precision_macro']:.4f}")
        print(f"  Recall(mac):    {result['recall_macro']:.4f}")
        print(f"  F1(mac):        {result['f1_macro']:.4f}")

        th_keys = [k for k in result if k.startswith("prec@")]
        if th_keys:
            print(f"\n  Precision@Threshold:")
            for k in sorted(th_keys):
                sig_k = k.replace("prec@", "signals@")
                n = result.get(sig_k, "?")
                print(f"    {k}: {result[k]:.4f}  ({n} signals)")


def print_top_results(n: int = 20, sort_by: str = "accuracy"):
    """Load grid results and print top N by a given metric."""
    if not GRID_CSV.exists():
        print("No results yet.")
        return
    df = pd.read_csv(GRID_CSV)
    if df.empty:
        print("No results yet.")
        return
    if sort_by not in df.columns:
        print(f"Column '{sort_by}' not found. Available: {list(df.columns)}")
        return
    top = df.nlargest(n, sort_by)
    cols = ["model", "feature_set", "target", "type"]
    cols += [c for c in ["accuracy", "f1_macro", "directional_accuracy", "rmse", "r2",
                          "prec@0.5", "prec@0.6", "prec@0.7"] if c in top.columns]
    cols = [c for c in cols if c in top.columns]
    print(f"\n{'='*100}")
    print(f"  TOP {n} by {sort_by}")
    print(f"{'='*100}")
    print(top[cols].to_string(index=False))
    print()
