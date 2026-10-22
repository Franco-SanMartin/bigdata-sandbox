"""Deja ventas_limpias.parquet (lo escribe etl_pandas.py) como lo lee Hive y muestra las primeras filas.

    python3 parquet_para_hive.py ventas_limpias.parquet

pandas guarda las fechas como TIMESTAMP en nanosegundos y Hive 3.1 las lee como
INT96: se reescribe el mismo archivo (mismas filas y columnas) con
use_deprecated_int96_timestamps. Al final imprime '@@muestra@@' y las 5
primeras filas en JSON (orient='split'), que el servidor muestra en el paso.
"""
import sys

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def main(argv):
    archivo = argv[1]
    df = pd.read_parquet(archivo)
    pq.write_table(pa.Table.from_pandas(df, preserve_index=False), archivo, use_deprecated_int96_timestamps=True)
    h = df.head(5).copy()
    if "fecha" in h:
        h["fecha"] = h["fecha"].astype(str).str[:10]
    print("@@muestra@@")
    print(h.to_json(orient="split", index=False), flush=True)


if __name__ == "__main__":
    main(sys.argv)
