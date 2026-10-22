"""Análisis del pipeline con pandas: el mismo GROUP BY que Hive y Spark SQL.

    python3 resumen_pandas.py <carpeta con los .parquet> <sucursal|producto|mes|pago> <salida.csv>

Lee los Parquet de ventas_limpias (bajados de HDFS con hdfs dfs -get), agrupa y
escribe un CSV sin encabezado, ordenado por facturado de mayor a menor, como
INSERT OVERWRITE DIRECTORY de Hive.
"""
import glob
import sys

import pandas as pd

CLAVE = {"sucursal": "sucursal", "producto": "producto", "mes": "mes", "pago": "medio_pago"}


def main(argv):
    carpeta, por, salida = argv[1], argv[2], argv[3]
    df = pd.read_parquet(sorted(glob.glob(f"{carpeta}/*.parquet")))
    if por == "mes":
        df["mes"] = pd.to_datetime(df["fecha"]).dt.month
    k = CLAVE[por]
    if por == "producto":
        r = df.groupby(k).agg(unidades=("cantidad", "sum"), facturado=("importe", "sum"))
    elif por == "mes":
        r = df.groupby(k).agg(facturado=("importe", "sum"))
    else:
        r = df.groupby(k).agg(filas=("ticket", "size"), facturado=("importe", "sum"))
    r = r.reset_index().sort_values("facturado", ascending=False)
    r.to_csv(salida, header=False, index=False)
    print(f"{len(r)} filas en {salida}")


if __name__ == "__main__":
    main(sys.argv)
