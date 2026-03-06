#!/usr/bin/env python3
"""
Ejecuta código Python con librerías pre-cargadas.
Uso: echo "print(1+1)" | python run.py
      o: python run.py < code.txt

Libs disponibles: pandas (pd), numpy (np), matplotlib.pyplot (plt), json, math
Para gráficos: usa plt.savefig('/tmp/mpl_out.png') para guardar; el path se devuelve.
"""
import sys
import io
import json
import traceback

# Pre-cargar librerías comúnmente usadas
try:
    import pandas as pd
except ImportError:
    pd = None
try:
    import numpy as np
except ImportError:
    np = None
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
except ImportError:
    plt = None

OUTPUT = {"stdout": "", "stderr": "", "success": True, "charts": []}


def main():
    code = sys.stdin.read()
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    out = io.StringIO()
    err = io.StringIO()
    sys.stdout = out
    sys.stderr = err

    try:
        exec(code, {
            "pd": pd, "np": np, "plt": plt,
            "pandas": pd, "numpy": np, "matplotlib": plt,
            "json": json, "math": __import__("math"),
        })
    except Exception as e:
        OUTPUT["success"] = False
        OUTPUT["stderr"] = traceback.format_exc()
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        OUTPUT["stdout"] = out.getvalue()
        if OUTPUT["stderr"] == "":
            OUTPUT["stderr"] = err.getvalue()

    print(json.dumps(OUTPUT, ensure_ascii=False))


if __name__ == "__main__":
    main()
