#!/usr/bin/env python3
"""
Compare features computed by:
  - Training path: load_base_df() from CSV → add_features()
  - Predict path:  build_dataframe() from raw candles → add_features()

Usage: python debug_feature_compare.py [SYMBOL] [DATE] [CANDLE_IDX]
Example: python debug_feature_compare.py ASNS 2025-09-02 40
"""
import sys
import json
import numpy as np
import pandas as pd
from pathlib import Path

# Make sure we can import from experiments/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data_loader import load_base_df
from feature_engineer import add_features, FEATURE_SETS

BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_model"

def main():
    symbol = sys.argv[1] if len(sys.argv) > 1 else "ASNS"
    date_str = sys.argv[2] if len(sys.argv) > 2 else "2025-09-02"
    target_cidx = int(sys.argv[3]) if len(sys.argv) > 3 else 40

    # Load meta for feature columns
    with open(BEST_MODEL_DIR / "meta.json") as f:
        meta = json.load(f)
    feature_cols = meta["feature_columns"]

    # === PATH A: Training pipeline ===
    print("Loading training CSV...")
    df_all = load_base_df()
    # Filter to single symbol/date
    df_all["date_str"] = pd.to_datetime(df_all["date"]).dt.strftime("%Y-%m-%d")
    mask = (df_all["symbol"] == symbol) & (df_all["date_str"] == date_str)
    df_train = df_all[mask].copy().reset_index(drop=True)
    if len(df_train) == 0:
        print(f"No data for {symbol} {date_str} in CSV. Available symbols:")
        syms = df_all["symbol"].unique()[:20]
        print(", ".join(syms))
        return
    print(f"  CSV rows for {symbol} {date_str}: {len(df_train)}")

    df_train_feat = add_features(df_train)
    # Find row by candle_idx
    row_a_mask = df_train_feat["candle_idx"] == target_cidx
    if not row_a_mask.any():
        print(f"candle_idx {target_cidx} not found. Range: {df_train_feat['candle_idx'].min()}-{df_train_feat['candle_idx'].max()}")
        return
    row_a = df_train_feat[row_a_mask].iloc[0]

    # === PATH B: Predict pipeline (build_dataframe) ===
    from predict import build_dataframe
    # Build candle data like NestJS would send (with original candle_time_et and candle_idx)
    candles_up_to = df_train[df_train["candle_idx"] <= target_cidx].copy()
    candle_list = []
    candle_times_et = []
    candle_idx_arr = []
    for _, r in candles_up_to.iterrows():
        candle_list.append({
            "t": 0,
            "o": float(r["open"]),
            "h": float(r["high"]),
            "l": float(r["low"]),
            "c": float(r["close"]),
            "v": float(r["volume"]),
        })
        candle_times_et.append(str(r.get("candle_time_et", "09:30")))
        candle_idx_arr.append(int(r.get("candle_idx", 0)))

    target_row_csv = df_train[df_train["candle_idx"] == target_cidx].iloc[0]
    payload = {
        "candles": candle_list,
        "target_idx": len(candle_list) - 1,
        "candle_times_et": candle_times_et,
        "candle_idx_arr": candle_idx_arr,
        "atr": float(target_row_csv.get("atr", 0)) if pd.notna(target_row_csv.get("atr")) else 0,
        "high_of_day": float(target_row_csv.get("high_of_day", 0)) if pd.notna(target_row_csv.get("high_of_day")) else 0,
        "low_of_day": float(target_row_csv.get("low_of_day", 0)) if pd.notna(target_row_csv.get("low_of_day")) else 0,
        "pre_market_high": float(target_row_csv.get("pre_market_high", 0)) if pd.notna(target_row_csv.get("pre_market_high")) else 0,
        "change_pct_at_candle": float(target_row_csv.get("change_pct_at_candle", 0)) if pd.notna(target_row_csv.get("change_pct_at_candle")) else 0,
        "shares_outstanding": float(target_row_csv.get("shares_outstanding", 0)) if pd.notna(target_row_csv.get("shares_outstanding")) else 0,
        "market_cap": float(target_row_csv.get("market_cap", 0)) if pd.notna(target_row_csv.get("market_cap")) else 0,
        "gap_pct": float(target_row_csv.get("gap_pct", 0)) if pd.notna(target_row_csv.get("gap_pct")) else 0,
        "premarket_volume": float(target_row_csv.get("premarket_volume", 0)) if pd.notna(target_row_csv.get("premarket_volume")) else 0,
    }

    df_pred = build_dataframe(payload)
    df_pred_feat = add_features(df_pred)

    # Apply same cumulative_volume_ratio fix as predict.py main()
    if "cumulative_volume_ratio" in df_pred_feat.columns and len(df_pred_feat) < 500:
        df_pred_feat["cumulative_volume_ratio"] = df_pred_feat["cumulative_volume_ratio"] * (len(df_pred_feat) / 539.0)

    row_b = df_pred_feat.iloc[-1]  # Last row = target

    # === COMPARE ===
    print(f"\n{'Feature':<30} {'Training':>15} {'Predict':>15}  Match?")
    print("─" * 75)

    ok = 0
    close_count = 0
    diff_count = 0
    na_count = 0
    diffs = []

    for col in feature_cols:
        va = row_a.get(col, np.nan) if col in row_a.index else np.nan
        vb = row_b.get(col, np.nan) if col in row_b.index else np.nan

        va_f = float(va) if pd.notna(va) else None
        vb_f = float(vb) if pd.notna(vb) else None

        va_str = f"{va_f:.6f}" if va_f is not None else "NaN"
        vb_str = f"{vb_f:.6f}" if vb_f is not None else "NaN"

        if va_f is None and vb_f is None:
            label = "both NaN"
            na_count += 1
        elif va_f is None or vb_f is None:
            label = "✗ ONE NaN"
            diff_count += 1
            diffs.append((col, va_f, vb_f))
        elif abs(va_f - vb_f) < 0.001:
            label = "✓"
            ok += 1
            continue  # Don't print matching features
        elif abs(va_f - vb_f) < 0.05:
            label = "~close"
            close_count += 1
        else:
            label = "✗ DIFF"
            diff_count += 1
            diffs.append((col, va_f, vb_f))

        print(f"{col:<30} {va_str:>15} {vb_str:>15}  {label}")

    print("─" * 75)
    print(f"SUMMARY: {ok} exact match, {close_count} close, {diff_count} DIFFERENT, {na_count} both NaN (of {len(feature_cols)} features)")

    if diffs:
        print(f"\n⚠️  Features with significant differences:")
        for col, va, vb in diffs:
            va_s = f"{va:.6f}" if va is not None else "NaN"
            vb_s = f"{vb:.6f}" if vb is not None else "NaN"
            delta = abs((va or 0) - (vb or 0))
            print(f"  {col}: training={va_s}, predict={vb_s}, delta={delta:.6f}")


if __name__ == "__main__":
    main()
