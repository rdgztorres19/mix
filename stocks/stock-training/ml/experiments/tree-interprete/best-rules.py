import json
import joblib

MODEL_DIR = "../results/best_models/LightGBM_D_clean_ext_bin_rr10m_ge_2"

with open(f"{MODEL_DIR}/meta.json", "r") as f:
    meta = json.load(f)

feature_names = meta["feature_columns"]

model = joblib.load(f"{MODEL_DIR}/model.joblib")
booster = model.booster_ if hasattr(model, "booster_") else model

importances_gain = booster.feature_importance(importance_type="gain")
importances_split = booster.feature_importance(importance_type="split")

rows = list(zip(feature_names, importances_gain, importances_split))
rows.sort(key=lambda x: x[1], reverse=True)

print("\n=== TOP FEATURES BY GAIN ===")
for name, gain, split in rows[:30]:
    print(f"{name:30s} gain={gain:12.4f} splits={split}")