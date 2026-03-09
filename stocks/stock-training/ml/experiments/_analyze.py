#!/usr/bin/env python3
"""Quick analysis of grid results."""
import pandas as pd

df = pd.read_csv("experiments/results/grid_results.csv")
print(f"Total experiments: {len(df)}")
print(f"Models: {df['model'].unique().tolist()}")
print(f"Feature sets: {df['feature_set'].unique().tolist()}")
print(f"Targets: {df['target'].unique().tolist()}")
print()

models = ['XGBoost','LightGBM','CatBoost','RandomForest','ExtraTrees','LogisticRegression']
for m in models:
    sub = df[df['model']==m]
    done = sub['feature_set'].unique().tolist()
    print(f"  {m}: {len(sub)} runs, fsets={done}")
print()

if 'prec@0.7' in df.columns:
    for c in ['prec@0.4','prec@0.5','prec@0.6','prec@0.7','prec@0.8',
              'signals@0.4','signals@0.5','signals@0.6','signals@0.7','signals@0.8',
              'accuracy','class_1_precision','class_1_recall']:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors='coerce')
    top = df.nlargest(20, 'prec@0.7')
    cols = ['model','feature_set','target','accuracy','class_1_precision','class_1_recall',
            'prec@0.5','prec@0.6','prec@0.7','prec@0.8','signals@0.7']
    cols = [c for c in cols if c in top.columns]
    print("TOP 20 by prec@0.7:")
    pd.set_option('display.width', 200)
    pd.set_option('display.max_columns', 20)
    print(top[cols].to_string(index=False))
    print()
    
    # Also show top by class_1_precision with enough signals
    if 'signals@0.5' in df.columns:
        df_sig = df[df['signals@0.5'] > 100]
        if len(df_sig) > 0:
            top2 = df_sig.nlargest(10, 'prec@0.5')
            print("\nTOP 10 by prec@0.5 (where signals@0.5 > 100):")
            print(top2[cols].to_string(index=False))
