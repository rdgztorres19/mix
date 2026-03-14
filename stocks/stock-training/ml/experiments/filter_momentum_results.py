#!/usr/bin/env python3
"""
filter_momentum_results.py — Filtra grid_results.csv por métricas priorizadas para trading long momentum.
Produce un CSV con columnas: model, feature_set, target + prec@0.7, signals@0.7, class_1_precision, etc.

Usage:
  cd stock-training/ml
  python -m experiments.filter_momentum_results
  python -m experiments.filter_momentum_results --binary
  python -m experiments.filter_momentum_results -o custom_momentum.csv
"""

import argparse
from pathlib import Path

import pandas as pd


MOMENTUM_COLS = [
    "prec@0.4",
    "signals@0.4",
    "prec@0.5",
    "signals@0.5",
    "prec@0.7",
    "signals@0.7",
    "class_1_precision",
    "prec@0.6",
    "signals@0.6",
    "class_1_recall",
    "class_1_f1",
    "f1_macro",
    "prec@0.8",
    "signals@0.8",
    "accuracy",
]

ID_COLS = ["model", "feature_set", "target"]


def main():
    parser = argparse.ArgumentParser(
        description="Filter grid_results by momentum-relevant metrics"
    )
    parser.add_argument(
        "--binary",
        action="store_true",
        help="Keep only binary targets (is_multiclass == False)",
    )
    parser.add_argument(
        "-o", "--output",
        default="grid_results_momentum.csv",
        help="Output filename (default: grid_results_momentum.csv)",
    )
    parser.add_argument(
        "-i", "--input",
        default="grid_results.csv",
        help="Input filename (default: grid_results.csv)",
    )
    args = parser.parse_args()

    results_dir = Path(__file__).resolve().parent / "results"
    in_path = results_dir / args.input
    out_path = results_dir / args.output

    if not in_path.exists():
        print(f"Error: {in_path} not found")
        return 1

    df = pd.read_csv(in_path, index_col=False)

    # Filter rows if --binary
    if args.binary and "is_multiclass" in df.columns:
        is_binary = df["is_multiclass"].astype(str).str.lower() == "false"
        df = df[is_binary].copy()
        print(f"Filtered to binary targets: {len(df)} rows")

    # Select columns that exist
    all_cols = ID_COLS + MOMENTUM_COLS
    available = [c for c in all_cols if c in df.columns]
    missing = [c for c in all_cols if c not in df.columns]
    if missing:
        print(f"Warning: columns not found: {missing}")

    df_out = df[available].copy()

    # Coerce prec@0.7 to numeric (CSV parse issues can yield mixed types)
    if "prec@0.7" in df_out.columns:
        df_out["prec@0.7"] = pd.to_numeric(df_out["prec@0.7"], errors="coerce")

    # Sort by prec@0.7 descending (NaN last)
    if "prec@0.7" in df_out.columns:
        df_out = df_out.sort_values("prec@0.7", ascending=False, na_position="last").reset_index(drop=True)

    df_out.to_csv(out_path, index=False)
    print(f"Saved {len(df_out)} rows to {out_path}")
    return 0


if __name__ == "__main__":
    exit(main())
