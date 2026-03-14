#!/usr/bin/env python3
"""
tune_focused.py — Fast, focused Optuna tuning for XGBoost and LightGBM.
Subsamples data for speed; tunes the best combos with practical signal volume.

Compatible with target_variants.compute_target_variants() returning:
{
  target_name: {
    "y": np.ndarray,
    "valid": np.ndarray[bool]
  }
}

Usage:
  cd stock-training/ml
  python3 experiments/tune_focused.py
"""

import json
import sys
import time
from pathlib import Path

import numpy as np
import optuna
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from experiments.data_loader import load_base_df, prepare_Xy
from experiments.feature_engineer import add_features, FEATURE_SETS
from experiments.target_variants import compute_target_variants, TARGET_META
from experiments.evaluator import precision_at_threshold, RESULTS_DIR
from experiments.run_grid import compute_sample_weights

optuna.logging.set_verbosity(optuna.logging.WARNING)

SUBSAMPLE = 200_000  # rows for tuning speed
N_TRIALS = 60
N_SPLITS = 3
EMBARGO = 30

# Top configs to tune — chosen by composite score / practical usefulness
CONFIGS = [
    ("LightGBM", "D_all", "bin_mfr10m_1p5"),
    ("XGBoost", "D_clean_ext", "mc_rr10m"),
    ("LightGBM", "D_clean_ext", "bin_mfr10m_1atr"),
    ("LightGBM", "D_clean_ext", "bin_rr10m_ge_2"),
    ("LightGBM", "D1_core_momentum", "mc_rr10m"),
    ("LightGBM", "D_clean_ext", "mc_rr10m"),
]


def _extract_target_arrays(target_obj):
    """
    Supports both old format:
      np.ndarray
    and new format:
      {"y": np.ndarray, "valid": np.ndarray}
    """
    if isinstance(target_obj, dict):
        y = np.asarray(target_obj["y"])
        valid = np.asarray(target_obj["valid"], dtype=bool)
    else:
        y = np.asarray(target_obj)
        valid = np.ones(len(y), dtype=bool)
    return y, valid


def walk_forward_prec07(model_factory, X, y, n_splits=N_SPLITS):
    """Walk-forward CV returning mean prec@0.7 for bullish class."""
    n = len(X)
    fold_size = n // (n_splits + 1)
    scores = []

    for i in range(n_splits):
        train_end = fold_size * (i + 1)
        test_start = train_end + EMBARGO
        test_end = min(test_start + fold_size, n)

        if test_end <= test_start + 50:
            continue

        X_tr, y_tr = X[:train_end], y[:train_end]
        X_te, y_te = X[test_start:test_end], y[test_start:test_end]

        if len(np.unique(y_tr)) < 2 or len(np.unique(y_te)) < 2:
            continue

        scaler = StandardScaler()
        X_tr_s = scaler.fit_transform(X_tr)
        X_te_s = scaler.transform(X_te)
        sw = compute_sample_weights(y_tr)

        model = model_factory()
        val_idx = int(len(X_tr_s) * 0.9)

        try:
            model.fit(
                X_tr_s[:val_idx],
                y_tr[:val_idx],
                sample_weight=sw[:val_idx],
                eval_set=[(X_tr_s[val_idx:], y_tr[val_idx:])],
                verbose=False,
            )
        except TypeError:
            try:
                model.fit(
                    X_tr_s[:val_idx],
                    y_tr[:val_idx],
                    sample_weight=sw[:val_idx],
                    eval_set=[(X_tr_s[val_idx:], y_tr[val_idx:])],
                )
            except TypeError:
                model.fit(X_tr_s, y_tr, sample_weight=sw)

        y_proba = model.predict_proba(X_te_s)
        classes = list(model.classes_)

        if 1 in classes:
            proba_1 = y_proba[:, classes.index(1)]
            prec, n_sig = precision_at_threshold(
                y_te,
                proba_1,
                0.7,
                bullish_class=1,
            )
            if n_sig < 10:
                prec *= 0.3
            scores.append(prec)
        else:
            scores.append(0.0)

    return float(np.mean(scores)) if scores else 0.0


def xgb_objective(trial, X, y, is_mc):
    from xgboost import XGBClassifier

    p = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 600),
        "max_depth": trial.suggest_int("max_depth", 3, 9),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.4, 1.0),
        "min_child_weight": trial.suggest_int("min_child_weight", 1, 20),
        "gamma": trial.suggest_float("gamma", 0.0, 3.0),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 5.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 5.0, log=True),
        "random_state": 42,
        "n_jobs": -1,
        "tree_method": "hist",
        "eval_metric": "mlogloss" if is_mc else "logloss",
        "objective": "multi:softprob" if is_mc else "binary:logistic",
    }

    if is_mc:
        p["num_class"] = int(len(np.unique(y)))

    return walk_forward_prec07(lambda: XGBClassifier(**p), X, y)


def lgbm_objective(trial, X, y, is_mc):
    from lightgbm import LGBMClassifier

    p = {
        "n_estimators": trial.suggest_int("n_estimators", 100, 600),
        "max_depth": trial.suggest_int("max_depth", 3, 10),
        "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.2, log=True),
        "subsample": trial.suggest_float("subsample", 0.6, 1.0),
        "colsample_bytree": trial.suggest_float("colsample_bytree", 0.4, 1.0),
        "min_child_samples": trial.suggest_int("min_child_samples", 5, 60),
        "reg_alpha": trial.suggest_float("reg_alpha", 1e-3, 5.0, log=True),
        "reg_lambda": trial.suggest_float("reg_lambda", 1e-3, 5.0, log=True),
        "num_leaves": trial.suggest_int("num_leaves", 20, 100),
        "random_state": 42,
        "n_jobs": -1,
        "verbose": -1,
        "objective": "multiclass" if is_mc else "binary",
        "metric": "multi_logloss" if is_mc else "binary_logloss",
    }

    if is_mc:
        p["num_class"] = int(len(np.unique(y)))

    return walk_forward_prec07(lambda: LGBMClassifier(**p), X, y)


def main():
    print("=" * 70)
    print("  FOCUSED TUNING — Loading data")
    print("=" * 70)

    t0 = time.time()
    df_base = load_base_df()
    df_data = add_features(df_base)
    targets = compute_target_variants(df_data)
    print(f"  Data ready: {len(df_data)} rows in {time.time() - t0:.1f}s")

    # Subsample
    if len(df_data) > SUBSAMPLE:
        step = max(1, len(df_data) // SUBSAMPLE)
        idx = np.arange(0, len(df_data), step)[:SUBSAMPLE]
        df_sub = df_data.iloc[idx].copy()

        targets_sub = {}
        for k, v in targets.items():
            y_arr, valid_arr = _extract_target_arrays(v)
            targets_sub[k] = {
                "y": y_arr[idx],
                "valid": valid_arr[idx],
            }

        print(f"  Subsampled to {len(df_sub)} rows for tuning speed")
    else:
        df_sub = df_data.copy()
        targets_sub = {}
        for k, v in targets.items():
            y_arr, valid_arr = _extract_target_arrays(v)
            targets_sub[k] = {
                "y": y_arr,
                "valid": valid_arr,
            }

    all_results = []

    for ci, (model_name, fset_name, target_name) in enumerate(CONFIGS, 1):
        is_mc = TARGET_META[target_name][0]
        feature_cols = FEATURE_SETS[fset_name]

        print(f"\n{'=' * 70}")
        print(f"  [{ci}/{len(CONFIGS)}] {model_name} | {fset_name} | {target_name}")
        print(f"  {N_TRIALS} trials, {N_SPLITS}-fold walk-forward CV")
        print(f"{'=' * 70}")

        target_info = targets_sub[target_name]

        df_work = df_sub.copy()
        df_work["_target"] = target_info["y"]
        df_work = df_work.loc[target_info["valid"]].copy()

        if len(df_work) < 1000:
            print("  SKIP: too few valid rows")
            continue

        if len(np.unique(df_work["_target"])) < 2:
            print("  SKIP: target has <2 classes after valid filtering")
            continue

        X, y = prepare_Xy(df_work, feature_cols, target_col="_target")

        if len(y) < 1000:
            print("  SKIP: too few usable rows after prepare_Xy")
            continue

        # Remap multiclass labels
        if is_mc and y.min() < 0:
            uq = np.array(sorted(np.unique(y)))
            label_map = {old: new for new, old in enumerate(uq)}
            y = np.array([label_map[v] for v in y], dtype=np.int32)

        # Use training portion only
        train_end = int(len(X) * 0.8)
        X_cv = X.values[:train_end]
        y_cv = y[:train_end]

        if len(np.unique(y_cv)) < 2:
            print("  SKIP: CV train portion has <2 classes")
            continue

        if model_name == "XGBoost":
            obj_fn = lambda trial: xgb_objective(trial, X_cv, y_cv, is_mc)
        else:
            obj_fn = lambda trial: lgbm_objective(trial, X_cv, y_cv, is_mc)

        study = optuna.create_study(
            direction="maximize",
            study_name=f"{model_name}_{fset_name}_{target_name}",
            sampler=optuna.samplers.TPESampler(seed=42, n_startup_trials=15),
        )

        t0 = time.time()
        study.optimize(obj_fn, n_trials=N_TRIALS, show_progress_bar=True)
        elapsed = time.time() - t0

        best = study.best_trial
        print(f"\n  Best CV prec@0.7: {best.value:.4f}")
        print(f"  Best params: {json.dumps(best.params, indent=2, default=str)}")
        print(f"  Time: {elapsed:.0f}s ({elapsed / N_TRIALS:.1f}s/trial)")

        all_results.append({
            "model": model_name,
            "feature_set": fset_name,
            "target": target_name,
            "cv_prec07": round(float(best.value), 4),
            "best_params": best.params,
            "time_s": round(elapsed, 1),
        })

    # Save
    out_path = RESULTS_DIR / "tuned_params.json"
    with open(out_path, "w") as f:
        json.dump(all_results, f, indent=2, default=str)

    print(f"\nResults saved to {out_path}")

    # Summary
    print(f"\n{'=' * 70}")
    print("  TUNING SUMMARY")
    print(f"{'=' * 70}")

    for r in all_results:
        print(
            f"  {r['model']:10s} | "
            f"{r['feature_set']:20s} | "
            f"{r['target']:30s} → CV prec@0.7 = {r['cv_prec07']:.4f}"
        )

    if all_results:
        best_r = max(all_results, key=lambda x: x["cv_prec07"])
        print(
            f"\n  BEST: {best_r['model']} | "
            f"{best_r['feature_set']} | "
            f"{best_r['target']} → {best_r['cv_prec07']:.4f}"
        )
    else:
        print("\n  No valid tuning results produced.")


if __name__ == "__main__":
    main()