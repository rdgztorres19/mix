# ML — Modelos de clasificación para training CSV

Carpeta Python para entrenar modelos sobre el CSV de 1 minuto (`training.csv`).

## Estructura

- `config.py` — Configuración compartida (paths, columnas, target)
- `random_forest/` — Modelo Random Forest
- `xgb/` — Modelo XGBoost (mejor calibración)

## Uso

```bash
cd stocks/stock-training/ml
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

# XGBoost (recomendado)
python -m xgb.train
python -m xgb.evaluate

# O Random Forest
python -m random_forest.train
python -m random_forest.evaluate
```

## Datos

El CSV `../data/training.csv` debe existir. Generarlo con:

```bash
cd stocks/stock-training
npm run build-csv
```
