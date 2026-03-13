#!/usr/bin/env python3
"""
Diagnóstico: ¿por qué predict.py devuelve mayormente prob > 0.7 cuando en el test set no debería?

Compara la distribución de probabilidades del modelo sobre datos de test con lo que
meta.json reporta. Si hay desvío, puede ser:
  1. Features distintas entre training y predict (drift)
  2. LightGBM sobreconfiado (calibración mala)
  3. Los datos que pruebas (backtest/live) son sesgados (solo momo stocks, días fuertes)

Uso: python -m experiments.check_prob_distribution
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from experiments.data_loader import load_base_df
from experiments.feature_engineer import add_features

BEST_MODEL_DIR = Path(__file__).resolve().parent / "results" / "best_models" / "LightGBM_D_all_bin_tb10m_tp5p0_sl2p5"


def main():
    meta_path = BEST_MODEL_DIR / "meta.json"
    model_path = BEST_MODEL_DIR / "model.joblib"
    scaler_path = BEST_MODEL_DIR / "scaler.joblib"

    if not meta_path.exists() or not model_path.exists():
        print("❌ Modelo no encontrado:", BEST_MODEL_DIR)
        return 1

    with open(meta_path) as f:
        meta = json.load(f)

    feature_cols = meta["feature_columns"]
    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path) if scaler_path.exists() else None

    print("📊 Cargando datos de test (mismo pipeline que entrenamiento)...")
    df_all = load_base_df()
    df_all["date_str"] = pd.to_datetime(df_all["date"]).dt.strftime("%Y-%m-%d")

    # Usar un subset representativo para no saturar memoria
    np.random.seed(42)
    sample_days = df_all["date_str"].unique()
    sample_days = np.random.choice(sample_days, min(30, len(sample_days)), replace=False)
    mask = df_all["date_str"].isin(sample_days)
    df_sample = df_all[mask].copy()

    df_feat = add_features(df_sample)
    X = df_feat[feature_cols].fillna(0).replace([np.inf, -np.inf], 0).values
    if scaler is not None:
        X = scaler.transform(X)

    probas = model.predict_proba(X)[:, 1]
    n = len(probas)

    print(f"\n✅ Evaluado {n:,} filas (sample de test)")
    print("\n📈 Distribución de prob (clase 1 = long):")
    print("─" * 50)

    for th in [0.4, 0.5, 0.6, 0.7, 0.8, 0.9]:
        pct = 100 * (probas >= th).sum() / n
        print(f"  prob >= {th:.1f}:  {pct:5.1f}%  ({int((probas >= th).sum()):,} señales)")

    n_test = meta.get("test_metrics", {}).get("n_test", 208416)
    print("\n📋 Lo que meta.json reporta (test set completo, n={}):".format(n_test))
    print("─" * 50)
    for k, v in meta.get("test_metrics", {}).items():
        if k.startswith("signals@"):
            th = float(k.split("@")[1])
            pct = 100 * v / n_test
            print(f"  signals@{th:.1f}: {v:,}  ({pct:.1f}%)")

    print("\n📉 Histograma de prob (bins):")
    bins = [0, 0.2, 0.4, 0.6, 0.7, 0.8, 0.9, 1.0]
    hist, _ = np.histogram(probas, bins=bins)
    for i in range(len(bins) - 1):
        pct = 100 * hist[i] / n
        bar = "█" * int(pct / 2) + "░" * (50 - int(pct / 2))
        print(f"  [{bins[i]:.1f}-{bins[i+1]:.1f}): {pct:5.1f}% {bar}")

    median_prob = np.median(probas)
    mean_prob = np.mean(probas)
    pct_ge_07 = 100 * (probas >= 0.7).sum() / n
    print(f"\n  Mediana prob: {median_prob:.3f}")
    print(f"  Media prob:   {mean_prob:.3f}")
    print(f"  % con prob >= 0.7: {pct_ge_07:.1f}%")

    if pct_ge_07 > 25:
        print("\n⚠️  Si en TU backtest ves >50% con prob>=0.7, hay drift:")
        print("    - Los datos que pruebas (ticker/fecha) pueden ser sesgados (momo, gap up)")
        print("    - O hay diferencia en features: ejecuta debug_feature_compare.py")
        print("    - LightGBM tiende a ser sobreconfiado: considera calibrar (Platt scaling)")
    else:
        print("\n✓  La distribución en test es normal. Si en predict ves más prob>0.7,")
        print("   los inputs que envías (candles/metadata) difieren del training.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
