import pandas as pd
import numpy as np
import csv

# =========================
# CONFIG
# =========================
CSV_FILE = "experiments/results/grid_results.csv"  # cambia esto por tu archivo
TOP_N = 10
EXPECTED_COLUMNS = [
    "model","feature_set","target","is_multiclass","n_test","accuracy",
    "precision_macro","recall_macro","f1_macro",
    "class_-1_precision","class_-1_recall","class_-1_f1","class_-1_count",
    "class_0_precision","class_0_recall","class_0_f1","class_0_count",
    "class_1_precision","class_1_recall","class_1_f1","class_1_count",
    "prec@0.4","signals@0.4",
    "prec@0.5","signals@0.5",
    "prec@0.6","signals@0.6",
    "prec@0.7","signals@0.7",
    "prec@0.8","signals@0.8",
    "confusion_matrix","train_time_s","n_features","n_train"
]

NUMERIC_COLUMNS = [
    "n_test","accuracy","precision_macro","recall_macro","f1_macro",
    "class_-1_precision","class_-1_recall","class_-1_f1","class_-1_count",
    "class_0_precision","class_0_recall","class_0_f1","class_0_count",
    "class_1_precision","class_1_recall","class_1_f1","class_1_count",
    "prec@0.4","signals@0.4",
    "prec@0.5","signals@0.5",
    "prec@0.6","signals@0.6",
    "prec@0.7","signals@0.7",
    "prec@0.8","signals@0.8",
    "train_time_s","n_features","n_train"
]

def fix_row(parts):
    """
    Arregla filas con columnas faltantes en prec@0.7 / prec@0.8.
    Asume que las últimas 4 columnas siempre son:
    confusion_matrix, train_time_s, n_features, n_train
    """
    if len(parts) == len(EXPECTED_COLUMNS):
        return parts

    # si sobran o faltan columnas, reconstruimos
    head = parts[:27]  # hasta signals@0.6 inclusive
    tail = parts[-4:]  # confusion_matrix, train_time_s, n_features, n_train
    middle = parts[27:-4]  # debería contener prec/signals @0.7 y @0.8

    # Queremos exactamente 4 elementos en middle:
    # prec@0.7, signals@0.7, prec@0.8, signals@0.8
    if len(middle) == 4:
        fixed_middle = middle
    elif len(middle) == 2:
        # faltan @0.8
        fixed_middle = [middle[0], middle[1], np.nan, np.nan]
    elif len(middle) == 0:
        # faltan @0.7 y @0.8
        fixed_middle = [np.nan, np.nan, np.nan, np.nan]
    else:
        # caso raro: rellenar/truncar
        fixed_middle = (middle + [np.nan, np.nan, np.nan, np.nan])[:4]

    fixed = head + fixed_middle + tail

    if len(fixed) != len(EXPECTED_COLUMNS):
        raise ValueError(f"Fila no se pudo reparar. Largo={len(parts)} -> {len(fixed)}")
    return fixed

def load_fixed_csv(path):
    rows = []
    with open(path, "r", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)

        for i, parts in enumerate(reader, start=2):
            if not parts:
                continue
            try:
                fixed = fix_row(parts)
                rows.append(fixed)
            except Exception as e:
                print(f"Error en fila {i}: {e}")

    df = pd.DataFrame(rows, columns=EXPECTED_COLUMNS)

    for col in NUMERIC_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df["is_multiclass"] = df["is_multiclass"].astype(str).str.lower().map({
        "true": True, "false": False
    })

    return df

def validate_df(df):
    bad = df[
        (df["class_1_precision"] > 1) |
        (df["class_1_recall"] > 1) |
        (df["class_1_f1"] > 1) |
        (df["prec@0.4"] > 1) |
        (df["prec@0.5"] > 1) |
        (df["prec@0.6"] > 1) |
        (df["prec@0.7"] > 1) |
        (df["prec@0.8"] > 1)
    ]
    if len(bad) > 0:
        print("\n⚠️ Aún hay filas sospechosas:")
        print(bad[["model", "feature_set", "target", "class_1_precision", "class_1_recall", "prec@0.6"]].head(10))
    else:
        print("\n✅ Parseo parece correcto.")

def compute_score(df):
    df = df.copy()

    # aquí puedes excluir multiclass si quieres
    df = df[df["is_multiclass"] == False].copy()

    # score más orientado a trading real
    df["score"] = (
        df["prec@0.6"].fillna(0) * 0.40 +
        df["prec@0.5"].fillna(0) * 0.20 +
        df["prec@0.7"].fillna(0) * 0.15 +
        df["class_1_precision"].fillna(0) * 0.10 +
        df["class_1_f1"].fillna(0) * 0.10 +
        df["f1_macro"].fillna(0) * 0.05
    )

    # boost suave por número de señales @0.6
    sig = np.log1p(df["signals@0.6"].fillna(0))
    if sig.max() > 0:
        sig = sig / sig.max()
        df["score"] = df["score"] * (0.7 + 0.3 * sig)

    return df

def main():
    df = load_fixed_csv(CSV_FILE)
    validate_df(df)

    ranked = compute_score(df).sort_values("score", ascending=False)

    cols = [
        "model","feature_set","target","score",
        "class_1_precision","class_1_recall","class_1_f1",
        "prec@0.4","signals@0.4",
        "prec@0.5","signals@0.5",
        "prec@0.6","signals@0.6",
        "prec@0.7","signals@0.7",
        "prec@0.8","signals@0.8",
        "f1_macro","train_time_s","n_features"
    ]

    result = ranked[cols].head(TOP_N).copy()
    float_cols = result.select_dtypes(include=["float64", "float32"]).columns
    result[float_cols] = result[float_cols].round(4)

    print("\n===== TOP 10 BIEN PARSEADO =====\n")
    print(result.to_string(index=False))

    result.to_csv("top_10_models_fixed.csv", index=False)
    print("\nGuardado en top_10_models_fixed.csv")

if __name__ == "__main__":
    main()