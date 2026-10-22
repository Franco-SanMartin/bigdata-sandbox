#!/usr/bin/env bash
# Prueba de la version ml de la imagen: las librerias de Python, PySpark desde
# un python3 cualquiera (como en JupyterLab), JupyterLab, y los ejemplos de
# ejemplos/ml: que el ETL de pandas y el de Spark den exactamente lo mismo (y
# encuentren la suciedad que metio el generador), y que los modelos de
# scikit-learn y de Spark MLlib aprendan las reglas con las que se generaron
# los datos. GitHub Actions la corre antes de publicar la version ml.
#
# A mano, con el contenedor prendido (SERVICIOS=todo y MONGODB=si) y en
# "Cluster LISTO":
#   docker cp pruebas/probar_ml.sh bigdata:/tmp/probar_ml.sh
#   docker exec bigdata bash /tmp/probar_ml.sh
# Deja en /datos los archivos que generan los ejemplos y en HDFS /user/root/ml.
set -euo pipefail
cd /datos

paso() { echo; echo "=== $* ==="; }
falla() { echo "FALLA: $*" >&2; exit 1; }
# Una linea del resumen de un ETL: "  <paso> <numero>" -> numero
dato() { grep -F "  $2 " "$1" | head -1 | awk '{print $NF}'; }
igual() { # $1=descripcion $2=valor $3=esperado
  echo "$1: $2"
  [ "$2" = "$3" ] || falla "$1 da $2 y tendria que dar $3"
}

paso "Version de la imagen y librerias de Python"
[ "$SANDBOX_VERSION" = ml ] || falla "SANDBOX_VERSION=$SANDBOX_VERSION"
python3 - <<'FIN'
import sys
import matplotlib, numpy, pandas, pyarrow, pymongo, scipy, sklearn
print("Python", sys.version.split()[0])
for m in (numpy, pandas, pyarrow, sklearn, scipy, matplotlib, pymongo):
    print(f"  {m.__name__:12} {m.__version__}")
assert sys.version_info[:2] == (3, 12), "se esperaba Python 3.12"
assert numpy.__version__.startswith("1."), "Spark 3.5 necesita numpy 1.x"
FIN
pip --version
# pip ve a pyspark (por el PYTHONPATH) pero no a py4j, que va como .zip: ese
# aviso no es un problema
rotas=$(pip check | grep -v '^pyspark .* requires py4j' || true)
[ -z "$rotas" ] || falla "pip check: hay librerias con dependencias rotas: $rotas"
echo "pip check: sin dependencias rotas"

paso "PySpark desde python3 (sin spark-submit): YARN, UDF de Python y Arrow"
python3 - <<'FIN'
from pyspark.sql import SparkSession, functions as F

spark = SparkSession.builder.appName("prueba python3").getOrCreate()
print("master:", spark.sparkContext.master, "| Spark", spark.version)
assert spark.sparkContext.master == "yarn"
numeros = spark.range(1000)

# Una funcion de Python que corre en los executors: Spark la serializa
# (cloudpickle) y la ejecuta con el Python 3.12 de cada executor
@F.udf("long")
def doble(x):
    return x * 2

assert numeros.select(F.sum(doble("id"))).first()[0] == 999000
# Spark -> pandas y pandas -> Spark, con Arrow (pyarrow)
spark.conf.set("spark.sql.execution.arrow.pyspark.enabled", "true")
tabla = numeros.withColumn("fecha", F.current_date()).withColumn("hora", F.current_timestamp()).toPandas()
assert len(tabla) == 1000 and str(tabla["fecha"].dtype) == "object"
assert spark.createDataFrame(tabla).count() == 1000
spark.stop()
print("OK")
FIN

paso "JupyterLab: prendido, sin contrasena, y un notebook que corre"
netstat -tln | grep -q ":8888 " || falla "JupyterLab no escucha en el puerto 8888"
curl -sf http://localhost:8888/api | tee /dev/stderr | grep -q '"version"' || falla "la API de Jupyter no responde"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8888/lab)" = 200 ] \
  || falla "JupyterLab pide contrasena o no responde"
python3 - <<'FIN'
import nbformat
nb = nbformat.v4.new_notebook()
nb.cells = [nbformat.v4.new_code_cell("import pandas as pd, numpy as np, pyspark, sklearn\n"
                                      "print(pd.DataFrame({'x': np.arange(3)}).x.sum())")]
nbformat.write(nb, "/tmp/prueba.ipynb")
FIN
jupyter nbconvert --to notebook --execute --output /tmp/prueba-hecha.ipynb /tmp/prueba.ipynb \
  || falla "el notebook de prueba no corrio"
python3 -c "import nbformat; s = nbformat.read('/tmp/prueba-hecha.ipynb', 4).cells[0].outputs[0]['text']; print('salida del notebook:', s); assert s == '3\n'"
estado | grep -q "JupyterLab.*arriba" || falla "estado no muestra JupyterLab"

paso "ETL: datos sucios -> pandas y Spark"
python3 ejemplos/ml/generar_sucios.py | tee /tmp/generar_sucios.txt
echo "ba165b55f593caace58a53daefd0e1fa  ventas_sucias.csv" | md5sum -c - || falla "el generador no dio los mismos datos de siempre"
python3 ejemplos/ml/etl_pandas.py > /tmp/etl_pandas.txt || { cat /tmp/etl_pandas.txt; falla "etl_pandas.py"; }
sed -n '/=== RESUMEN/,$p' /tmp/etl_pandas.txt
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f ventas_sucias.csv /user/root/ml/
spark-submit ejemplos/ml/etl_spark.py > /tmp/etl_spark.txt 2> /tmp/etl_spark.err \
  || { tail -30 /tmp/etl_spark.err; falla "etl_spark.py"; }
# Los dos resumenes, linea por linea (sin el tiempo, que cambia)
diff <(sed -n '/=== RESUMEN/,/^$/p' /tmp/etl_pandas.txt) <(sed -n '/=== RESUMEN/,/^$/p' /tmp/etl_spark.txt) \
  || falla "pandas y Spark no dan el mismo resumen"
echo "pandas y Spark: mismo resumen"
# Y encontraron exactamente lo que metio el generador
g() { grep -F "  $1 " /tmp/generar_sucios.txt | awk '{print $NF}'; }
igual "duplicados" "$(dato /tmp/etl_pandas.txt 'duplicados eliminados')" "$(g 'tickets duplicados')"
igual "sin cantidad" "$(dato /tmp/etl_pandas.txt 'sin cantidad (fuera)')" "$(g 'cantidad vacia')"
igual "cantidad imposible" "$(dato /tmp/etl_pandas.txt 'cantidad imposible (fuera)')" \
  "$(( $(g 'cantidad x100') + $(g 'cantidad negativa') ))"
igual "precio sin la coma" "$(dato /tmp/etl_pandas.txt 'precio sin la coma (/100)')" "$(g 'precio sin coma decimal')"
igual "sin precio" "$(dato /tmp/etl_pandas.txt 'sin precio (-> mediana del producto)')" "$(g 'precio vacio')"
igual "sin medio de pago" "$(dato /tmp/etl_pandas.txt 'sin medio de pago (-> desconocido)')" "$(g 'medio de pago vacio')"
igual "filas limpias" "$(dato /tmp/etl_pandas.txt 'filas limpias')" \
  "$(grep 'tendrian que quedar' /tmp/generar_sucios.txt | awk '{print $NF}')"
igual "fechas que no se entienden" "$(dato /tmp/etl_pandas.txt 'fechas que no se entienden (fuera)')" 0
# El Parquet que dejo cada uno se lee igual desde el otro lado
python3 -c "import pandas as pd; t = pd.read_parquet('ventas_limpias.parquet'); print(t.dtypes.to_dict()); assert t.ticket.is_unique"
hdfs dfs -test -e /user/root/ml/ventas_limpias/_SUCCESS || falla "Spark no dejo el Parquet en HDFS"

paso "Modelos con scikit-learn"
python3 ejemplos/ml/generar_senal.py
echo "db95cd0bc476efa6107a277334b943c7  clientes_senal.csv" | md5sum -c - || falla "el generador con senal no dio los mismos datos de siempre"
python3 ejemplos/ml/modelos_sklearn.py | tee /tmp/modelos_sklearn.txt
[ -s clusters_sklearn.png ] || falla "no se genero el grafico"

paso "Modelos con Spark MLlib"
hdfs dfs -put -f clientes_senal.csv /user/root/ml/
spark-submit ejemplos/ml/modelos_spark.py > /tmp/modelos_spark.txt 2> /tmp/modelos_spark.err \
  || { tail -30 /tmp/modelos_spark.err; falla "modelos_spark.py"; }
cat /tmp/modelos_spark.txt

paso "Lo aprendido se parece a la regla real (en los dos)"
python3 - <<'FIN'
import json

REGLA = {"antiguedad_meses": 50, "visitas_mes": 1500, "ticket_promedio": 0.8, "reclamos": -1500, "edad": 0}
TOLERANCIA = {"antiguedad_meses": 5, "visitas_mes": 60, "ticket_promedio": 0.03, "reclamos": 100, "edad": 5}
for archivo in ("metricas_sklearn.json", "metricas_spark.json"):
    m = json.load(open(archivo))
    print(archivo)
    for nombre, real in REGLA.items():
        aprendido = m["regresion"]["coeficientes"][nombre]
        print(f"  {nombre:18} aprendido {aprendido:10.2f}  real {real}")
        assert abs(aprendido - real) <= TOLERANCIA[nombre], f"{archivo}: {nombre} lejos de la regla"
    assert abs(m["regresion"]["constante"] - 5000) < 500
    assert m["regresion"]["r2"] > 0.9
    c = m["clasificacion"]
    arbol, red, logistica = (c["arbol de decision"]["aciertos"], c["red neuronal (MLP)"]["aciertos"],
                             c["regresion logistica"]["aciertos"])
    print(f"  aciertos: arbol {arbol:.3f}, red {red:.3f}, logistica {logistica:.3f}")
    assert 0.87 <= arbol <= 0.93, "el arbol tendria que llegar al techo (~90%)"
    assert 0.86 <= red <= 0.93, "la red tendria que llegar cerca del techo"
    assert logistica < arbol, "la logistica no puede ganarle al arbol con esta regla"
    print(f"  clustering (Rand ajustado): {m['clustering']['rand_ajustado']:.3f}")
    assert m["clustering"]["rand_ajustado"] > 0.8, "KMeans no encontro los segmentos"
s = json.load(open("metricas_sklearn.json"))
assert s["clasificacion"]["tonto (siempre lo mas comun)"]["aciertos"] < 0.7
assert s["clustering"]["rand_ajustado_sin_escalar"] < s["clustering"]["rand_ajustado"]
assert json.load(open("metricas_spark.json"))["validacion_cruzada"]["profundidad_elegida"] >= 3
print("OK")
FIN
grep -A12 "Lo que aprendio el arbol" /tmp/modelos_sklearn.txt | grep -q "visitas_mes <= 3.50" \
  || falla "el arbol de scikit-learn no encontro el corte de visitas (>= 4)"
grep -q "antiguedad_meses <= 35.50" /tmp/modelos_sklearn.txt \
  || falla "el arbol de scikit-learn no encontro el corte de antiguedad (>= 36)"

paso "MongoDB desde Python (pymongo -> pandas)"
if netstat -tln | grep -q ":27017 "; then
  python3 ejemplos/ml/mongo_pandas.py | tee /tmp/mongo_pandas.txt | tail -15
  grep -q "MongoDB calcula lo mismo: si" /tmp/mongo_pandas.txt || falla "pandas y MongoDB no dan lo mismo"
else
  falla "MongoDB no esta prendido (la prueba necesita MONGODB=si)"
fi

echo
echo "TODO OK: librerias, PySpark, JupyterLab, ETL (pandas = Spark) y modelos (sklearn y MLlib)"
