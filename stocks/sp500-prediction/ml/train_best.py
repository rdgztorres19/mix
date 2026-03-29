#!/usr/bin/env python3
"""
train_best.py — Train the best model config and save to best_models/.

Usage:
  python -m ml.train_best XGBoost G_spy_optimized bin_rr10m_ge_2
  python -m ml.train_best XGBoost G_spy_optimized bin_rr10m_ge_2 --session open
  python -m ml.train_best --auto   # picks top from grid_results.csv
"""

import argparse
import importlib
import json
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ml.data_loader import load_base_df, prepare_Xy
from ml.feature_engineer import add_features
from ml.config import FEATURE_SETS
from ml.target_variants import compute_target_variants, TARGET_META
from ml.evaluator import GRID_CSV
from ml.session_filter import filter_session, SESSIONS

BEST_MODELS_DIR = Path(__file__).resolve().parent / "results" / "best_models"


def train_and_save(model_name: str, fset_name: str, target_name: str, session: str = "all"):
    session_label = f" [{session}]" if session != "all" else ""
    print(f"\n{'='*70}")
    print(f"  Training: {model_name} | {fset_name} | {target_name}{session_label}")
    print(f"{'='*70}")

    # Load & engineer features
    df_base = load_base_df()
    df = add_features(df_base)

    # Session filter
    if session != "all":
        before = len(df)
        df = filter_session(df, session)
        print(f"  Session filter [{session}]: {before} → {len(df)} rows")

    # Target
    targets = compute_target_variants(df)
    bundle = targets[target_name]
    is_mc, is_reg, desc = TARGET_META[target_name]

    y_full = np.asarray(bundle["y"])
    valid_mask = np.asarray(bundle["valid"]).astype(bool)
    df_target = df.loc[valid_mask].copy()
    df_target["_target"] = y_full[valid_mask]

    feature_cols = FEATURE_SETS[fset_name]
    X, y = prepare_Xy(df_target, feature_cols, target_col="_target")

    # Remap multiclass
    label_map = None
    inv_label_map = None
    if is_mc and not is_reg and y.min() < 0:
        unique_sorted = np.array(sorted(np.unique(y)))
        label_map = {int(old): int(new) for new, old in enumerate(unique_sorted)}
        inv_label_map = {v: k for k, v in label_map.items()}
        y = np.array([label_map[v] for v in y])

    # Scale
    scaler = StandardScaler()
    X_scaled = pd.DataFrame(scaler.fit_transform(X), columns=X.columns, index=X.index)

    # Train on full dataset
    MODEL_MODULE_MAP = {
        "LightGBM": "ml.models.lightgbm_model",
        "XGBoost": "ml.models.xgboost_model",
        "CatBoost": "ml.models.catboost_model",
        "RandomForest": "ml.models.random_forest",
        "LSTM": "ml.models.lstm_model",
    }
    mod = importlib.import_module(MODEL_MODULE_MAP[model_name])
    model = mod.make_model(is_mc, is_regression=is_reg)

    t0 = time.time()
    model = mod.train(model, X_scaled, y)
    elapsed = time.time() - t0
    print(f"  Training done in {elapsed:.1f}s ({len(X)} rows)")

    # Save
    session_suffix = f"_S_{session}" if session != "all" else ""
    save_dir = BEST_MODELS_DIR / f"{model_name}_{fset_name}_{target_name}{session_suffix}"
    save_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, save_dir / "model.joblib")
    joblib.dump(scaler, save_dir / "scaler.joblib")

    meta = {
        "model": model_name,
        "feature_set": fset_name,
        "target": target_name,
        "session": session,
        "is_multiclass": is_mc,
        "is_regression": is_reg,
        "description": desc,
        "features": list(X.columns),
        "n_train": len(X),
        "label_map": label_map,
        "inv_label_map": inv_label_map,
    }
    with open(save_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"  Saved to {save_dir}")
    return save_dir


def auto_pick_best() -> tuple[str, str, str]:
    """Pick the best config from grid_results.csv by prec@0.7."""
    if not GRID_CSV.exists():
        raise FileNotFoundError("No grid_results.csv found. Run run_grid.py first.")

    df = pd.read_csv(GRID_CSV)

    # Pick by highest prec@0.7 with enough signals
    if "prec@0.7" in df.columns and "signals@0.7" in df.columns:
        viable = df[df["signals@0.7"] > 50]
        if not viable.empty:
            best = viable.nlargest(1, "prec@0.7").iloc[0]
            return best["model"], best["feature_set"], best["target"]

    # Fallback to accuracy
    best = df.nlargest(1, "accuracy").iloc[0]
    return best["model"], best["feature_set"], best["target"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("model", nargs="?", default=None)
    parser.add_argument("fset", nargs="?", default=None)
    parser.add_argument("target", nargs="?", default=None)
    parser.add_argument("--auto", action="store_true")
    parser.add_argument("--session", default="all", choices=list(SESSIONS.keys()))
    args = parser.parse_args()

    if args.auto or not args.model:
        model_name, fset_name, target_name = auto_pick_best()
        print(f"Auto-selected: {model_name} | {fset_name} | {target_name}")
    else:
        model_name = args.model
        fset_name = args.fset
        target_name = args.target

    train_and_save(model_name, fset_name, target_name, session=args.session)
