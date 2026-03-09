#!/usr/bin/env python3
"""Comprehensive analysis of all grid results — find best model/feature/target combo."""
import pandas as pd
import numpy as np

df = pd.read_csv("experiments/results/grid_results.csv")

# Convert numeric columns
num_cols = ['accuracy','class_1_precision','class_1_recall',
            'prec@0.4','prec@0.5','prec@0.6','prec@0.7','prec@0.8',
            'signals@0.4','signals@0.5','signals@0.6','signals@0.7','signals@0.8']
for c in num_cols:
    if c in df.columns:
        df[c] = pd.to_numeric(df[c], errors='coerce')

# Remove exact duplicates (keep best prec@0.7)
df = df.sort_values('prec@0.7', ascending=False).drop_duplicates(
    subset=['model','feature_set','target'], keep='first'
).reset_index(drop=True)

print(f"Total unique experiments: {len(df)}")
print(f"Models: {df['model'].value_counts().to_dict()}")
print()

# =========================================================================
# 1. TOP 20 overall by prec@0.7
# =========================================================================
print("=" * 100)
print("TOP 20 by prec@0.7 (precision at 70% confidence threshold)")
print("=" * 100)
cols = ['model','feature_set','target','prec@0.5','prec@0.6','prec@0.7','prec@0.8','signals@0.7']
top = df.nlargest(20, 'prec@0.7')
pd.set_option('display.width', 220)
pd.set_option('display.max_columns', 20)
print(top[cols].to_string(index=False))
print()

# =========================================================================
# 2. Best model per target (prec@0.7)
# =========================================================================
print("=" * 100)
print("BEST MODEL per TARGET (by prec@0.7)")
print("=" * 100)
for tgt in sorted(df['target'].unique()):
    sub = df[df['target'] == tgt].nlargest(3, 'prec@0.7')
    if len(sub) > 0:
        best = sub.iloc[0]
        sig = best.get('signals@0.7', 0)
        print(f"  {tgt:25s} → {best['model']:15s} {best['feature_set']:20s} prec@0.7={best['prec@0.7']:.4f}  signals={sig:.0f}")
print()

# =========================================================================
# 3. Best feature set per model (prec@0.7)
# =========================================================================
print("=" * 100)
print("BEST FEATURE SET per MODEL (by prec@0.7)")
print("=" * 100)
for mdl in ['XGBoost','LightGBM','CatBoost','RandomForest']:
    sub = df[df['model'] == mdl].nlargest(5, 'prec@0.7')
    if len(sub) > 0:
        print(f"\n  {mdl}:")
        for _, r in sub.iterrows():
            sig = r.get('signals@0.7', 0)
            print(f"    {r['feature_set']:20s} {r['target']:20s} prec@0.7={r['prec@0.7']:.4f}  signals={sig:.0f}")
print()

# =========================================================================
# 4. Best combo with enough signals (prec@0.7 > 0.60 AND signals@0.7 >= 500)
# =========================================================================
print("=" * 100)
print("BEST COMBOS with prec@0.7 > 0.60 AND signals@0.7 >= 500")
print("=" * 100)
mask = (df['prec@0.7'] > 0.60) & (df['signals@0.7'] >= 500)
good = df[mask].nlargest(20, 'prec@0.7')
if len(good) > 0:
    print(good[cols].to_string(index=False))
else:
    print("  (no combos meet this criteria)")
print()

# =========================================================================
# 5. Target comparison — which target type works best?
# =========================================================================
print("=" * 100)
print("AVERAGE prec@0.7 by TARGET (across all models)")
print("=" * 100)
tgt_avg = df.groupby('target')['prec@0.7'].agg(['mean','max','count']).sort_values('max', ascending=False)
print(tgt_avg.to_string())
print()

# =========================================================================
# 6. Feature set comparison — which features are most useful?
# =========================================================================
print("=" * 100)
print("AVERAGE prec@0.7 by FEATURE SET (across all models & targets)")
print("=" * 100)
fset_avg = df.groupby('feature_set')['prec@0.7'].agg(['mean','max','count']).sort_values('max', ascending=False)
print(fset_avg.to_string())
print()

# =========================================================================
# 7. Model comparison
# =========================================================================
print("=" * 100)
print("AVERAGE prec@0.7 by MODEL (across all feature sets & targets)")
print("=" * 100)
mdl_avg = df.groupby('model')['prec@0.7'].agg(['mean','max','count']).sort_values('max', ascending=False)
print(mdl_avg.to_string())
print()

# =========================================================================
# 8. Top 5 combos to tune (highest prec@0.7 with decent signals)
# =========================================================================
print("=" * 100)
print("TOP 5 CANDIDATES FOR HYPERPARAMETER TUNING")
print("=" * 100)
# Score = prec@0.7 * 0.7 + min(signals@0.7/2000, 1) * 0.3
df['score'] = df['prec@0.7'] * 0.7 + np.minimum(df['signals@0.7'] / 2000, 1.0) * 0.3
top5 = df.nlargest(10, 'score')
print(top5[['model','feature_set','target','prec@0.7','signals@0.7','score']].to_string(index=False))
print()

# =========================================================================
# 9. Precision at various thresholds for top combos
# =========================================================================
print("=" * 100)
print("PRECISION AT VARIOUS THRESHOLDS — Top 10 combos")
print("=" * 100)
thresh_cols = ['model','feature_set','target','prec@0.4','prec@0.5','prec@0.6','prec@0.7','prec@0.8',
               'signals@0.4','signals@0.5','signals@0.6','signals@0.7','signals@0.8']
thresh_cols = [c for c in thresh_cols if c in df.columns]
top10 = df.nlargest(10, 'prec@0.7')
print(top10[thresh_cols].to_string(index=False))
