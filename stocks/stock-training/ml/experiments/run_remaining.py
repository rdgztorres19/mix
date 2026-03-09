#!/usr/bin/env python3
"""
run_remaining.py — Run remaining models (RF, ExtraTrees, LogReg) then tune + ensemble.
Usage:
  cd stock-training/ml
  python -m experiments.run_remaining
"""
import subprocess
import sys

steps = [
    ("RandomForest grid", [sys.executable, "-m", "experiments.run_grid", "--models", "RandomForest"]),
    ("ExtraTrees grid", [sys.executable, "-m", "experiments.run_grid", "--models", "ExtraTrees"]),
    ("LogisticRegression grid", [sys.executable, "-m", "experiments.run_grid", "--models", "LogisticRegression"]),
    ("Tune top 5", [sys.executable, "-m", "experiments.tune_top", "--top", "5", "--trials", "80"]),
    ("Ensemble", [sys.executable, "-m", "experiments.ensemble"]),
]

for label, cmd in steps:
    print(f"\n{'='*70}")
    print(f"  STEP: {label}")
    print(f"{'='*70}\n")
    result = subprocess.run(cmd, cwd=".")
    if result.returncode != 0:
        print(f"  WARNING: {label} exited with code {result.returncode}")
    print(f"\n  {label} — DONE\n")

print("\nAll steps complete. Run: python -m experiments._analyze")
