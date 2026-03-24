import json
import joblib

MODEL_DIR = "../results/best_models/LightGBM_D_clean_ext_bin_rr10m_ge_2"

with open(f"{MODEL_DIR}/meta.json", "r") as f:
    meta = json.load(f)

feature_names = meta["feature_columns"]

model = joblib.load(f"{MODEL_DIR}/model.joblib")
booster = model.booster_ if hasattr(model, "booster_") else model

dump = booster.dump_model()

def feature_name_from_split(split_feature):
    if isinstance(split_feature, int) and 0 <= split_feature < len(feature_names):
        return feature_names[split_feature]
    return f"feature_{split_feature}"

def walk_tree(node, path=None, rules=None):
    if path is None:
        path = []
    if rules is None:
        rules = []

    if "leaf_index" in node:
        rules.append({
            "rule": " AND ".join(path) if path else "(root)",
            "leaf_value": node.get("leaf_value"),
            "leaf_count": node.get("leaf_count"),
            "leaf_weight": node.get("leaf_weight"),
        })
        return rules

    feat = feature_name_from_split(node["split_feature"])
    threshold = node["threshold"]
    decision_type = node.get("decision_type", "<=")

    left_condition = f"{feat} {decision_type} {threshold}"
    right_condition = f"{feat} > {threshold}" if decision_type == "<=" else f"NOT({left_condition})"

    walk_tree(node["left_child"], path + [left_condition], rules)
    walk_tree(node["right_child"], path + [right_condition], rules)

    return rules

for i, tree in enumerate(dump["tree_info"][:10]):  # primeros 10 árboles
    print(f"\n{'='*80}")
    print(f"TREE {i}")
    print(f"{'='*80}")
    rules = walk_tree(tree["tree_structure"])
    for r in rules:
        print(f"IF {r['rule']} THEN leaf_value={r['leaf_value']}  leaf_count={r['leaf_count']}")