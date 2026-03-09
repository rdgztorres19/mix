"""
Evaluator — standardized evaluation for all experiment runs.
Computes precision/recall/f1 per class, precision@threshold for bullish,
and logs results to CSV for comparison.
"""

import json
import time
from pathlib import Path

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

RESULTS_DIR = Path(__file__).resolve().parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)
GRID_CSV = RESULTS_DIR / "grid_results.csv"


def precision_at_threshold(
    y_true: np.ndarray,
    y_proba: np.ndarray,
    threshold: float,
    bullish_class: int = 1,
) -> tuple[float, int]:
    """
    Compute precision for bullish class when P(bullish) > threshold.
    Returns (precision, n_signals).
    """
    mask = y_proba > threshold
    n_signals = int(mask.sum())
    if n_signals == 0:
        return 0.0, 0
    precision = float((mask & (y_true == bullish_class)).sum()) / n_signals
    return precision, n_signals


def evaluate_model(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    y_proba_all: np.ndarray,
    class_labels: tuple,
    model_name: str,
    feature_set: str,
    target_name: str,
    is_multiclass: bool,
    thresholds: list[float] | None = None,
) -> dict:
    """
    Full evaluation. Returns a dict with all metrics.
    y_proba_all shape: (n_samples, n_classes)
    """
    if thresholds is None:
        thresholds = [0.4, 0.5, 0.6, 0.7, 0.8]

    result = {
        "model": model_name,
        "feature_set": feature_set,
        "target": target_name,
        "is_multiclass": is_multiclass,
        "n_test": len(y_true),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision_macro": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
    }

    # Per-class metrics
    for i, cl in enumerate(class_labels):
        cl_mask = y_true == cl
        pred_mask = y_pred == cl
        tp = int((cl_mask & pred_mask).sum())
        fp = int((~cl_mask & pred_mask).sum())
        fn = int((cl_mask & ~pred_mask).sum())
        prec = tp / max(tp + fp, 1)
        rec = tp / max(tp + fn, 1)
        f1 = 2 * prec * rec / max(prec + rec, 1e-8)
        result[f"class_{cl}_precision"] = round(prec, 4)
        result[f"class_{cl}_recall"] = round(rec, 4)
        result[f"class_{cl}_f1"] = round(f1, 4)
        result[f"class_{cl}_count"] = int(cl_mask.sum())

    # Precision@threshold for bullish (class=1)
    if 1 in class_labels:
        idx_bullish = list(class_labels).index(1)
        proba_bullish = y_proba_all[:, idx_bullish]
        for th in thresholds:
            prec, n_sig = precision_at_threshold(y_true, proba_bullish, th, bullish_class=1)
            result[f"prec@{th:.1f}"] = round(prec, 4)
            result[f"signals@{th:.1f}"] = n_sig

    # Confusion matrix as string
    cm = confusion_matrix(y_true, y_pred, labels=list(class_labels))
    result["confusion_matrix"] = str(cm.tolist())

    return result


def log_result(result: dict):
    """Append result dict as a row in grid_results.csv."""
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
    print(f"  Accuracy:       {result['accuracy']:.4f}")
    print(f"  Precision(mac): {result['precision_macro']:.4f}")
    print(f"  Recall(mac):    {result['recall_macro']:.4f}")
    print(f"  F1(mac):        {result['f1_macro']:.4f}")

    # Precision@thresholds
    th_keys = [k for k in result if k.startswith("prec@")]
    if th_keys:
        print(f"\n  Precision@Threshold (bullish):")
        for k in sorted(th_keys):
            sig_k = k.replace("prec@", "signals@")
            n = result.get(sig_k, "?")
            print(f"    {k}: {result[k]:.4f}  ({n} signals)")

    # Per-class
    class_keys = sorted([k for k in result if k.startswith("class_") and k.endswith("_precision")])
    if class_keys:
        print(f"\n  Per-class:")
        for k in class_keys:
            cl = k.replace("class_", "").replace("_precision", "")
            p = result.get(f"class_{cl}_precision", 0)
            r = result.get(f"class_{cl}_recall", 0)
            f1 = result.get(f"class_{cl}_f1", 0)
            cnt = result.get(f"class_{cl}_count", 0)
            print(f"    Class {cl:>3s}: P={p:.4f} R={r:.4f} F1={f1:.4f}  (n={cnt})")
    print()


def load_grid_results() -> pd.DataFrame:
    """Load all grid results from CSV."""
    if not GRID_CSV.exists():
        return pd.DataFrame()
    return pd.read_csv(GRID_CSV)


def print_top_results(n: int = 20, sort_by: str = "prec@0.7"):
    """Load grid results and print top N by a given metric."""
    df = load_grid_results()
    if df.empty:
        print("No results yet.")
        return
    if sort_by not in df.columns:
        print(f"Column '{sort_by}' not found. Available: {list(df.columns)}")
        return
    top = df.nlargest(n, sort_by)
    cols = ["model", "feature_set", "target", "accuracy", "f1_macro",
            "class_1_precision", "class_1_recall",
            "prec@0.5", "prec@0.6", "prec@0.7", "prec@0.8",
            "signals@0.7"]
    cols = [c for c in cols if c in top.columns]
    print(f"\n{'='*100}")
    print(f"  TOP {n} by {sort_by}")
    print(f"{'='*100}")
    print(top[cols].to_string(index=False))
    print()
