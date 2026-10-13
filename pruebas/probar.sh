#!/usr/bin/env bash
# Prueba de punta a punta: hace el paso a paso de TUTORIAL.md adentro del
# contenedor y verifica que MapReduce, Pig, Hive y Spark den el mismo
# resultado que un calculo directo en Python, y que Sqoop traiga y devuelva
# bien los datos de MySQL. GitHub Actions la corre antes de
# publicar la imagen; si algo falla, la imagen no se publica.
#
# A mano, con el contenedor 'bigdata' prendido y en "Cluster LISTO":
#   docker cp pruebas/probar.sh bigdata:/tmp/probar.sh
#   docker exec bigdata bash /tmp/probar.sh
set -euo pipefail
cd /datos

paso() { echo; echo "=== $* ==="; }
falla() { echo "FALLA: $*" >&2; exit 1; }

# Normaliza un resultado a "producto,unidades,facturado" ordenado
normalizar() { tr '\t' ',' | grep -v '^producto,' | LC_ALL=C sort; }

paso "Dataset de prueba"
python3 ejemplos/generar_ventas.py
# Mismos datos en cualquier compu y version de Python (semilla fija)
echo "2a5af82c1a6e8a4385b86a144f5a5589  ventas_grandes.csv" | md5sum -c -
python3 ejemplos/mapper.py < ventas_grandes.csv | LC_ALL=C sort \
  | python3 ejemplos/reducer.py | normalizar > /tmp/esperado.txt
cat /tmp/esperado.txt

paso "HDFS: subir y ver bloques"
hdfs dfs -mkdir -p /user/root/ventas
hdfs dfs -put -f ventas_grandes.csv /user/root/ventas/
hdfs dfs -ls /user/root/ventas
bloques=$(hdfs fsck /user/root/ventas/ventas_grandes.csv -files -blocks | grep -c 'blk_' || true)
echo "bloques: $bloques"
[ "$bloques" -ge 2 ] || falla "se esperaban varios bloques (BLOCK_SIZE chico)"

paso "MapReduce: wordcount (Java)"
hdfs dfs -put -f ejemplos/texto.txt /user/root/
hdfs dfs -rm -r -f /user/root/wc-out
hadoop jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar \
  wordcount /user/root/texto.txt /user/root/wc-out
hdfs dfs -cat /user/root/wc-out/part-r-00000 | grep -q '^datos[[:space:]]3$' \
  || falla "wordcount: 'datos' tendria que aparecer 3 veces"

paso "MapReduce: Hadoop Streaming (Python)"
hdfs dfs -rm -r -f /user/root/resultados/mr_por_producto
hadoop jar $HADOOP_HOME/share/hadoop/tools/lib/hadoop-streaming-3.3.6.jar \
  -files ejemplos/mapper.py,ejemplos/reducer.py \
  -mapper "python3 mapper.py" -reducer "python3 reducer.py" \
  -input /user/root/ventas -output /user/root/resultados/mr_por_producto
hdfs dfs -cat '/user/root/resultados/mr_por_producto/part-*' | normalizar > /tmp/mr.txt
diff /tmp/esperado.txt /tmp/mr.txt || falla "MapReduce no coincide"

paso "Pig: wordcount"
pig ejemplos/wordcount.pig 2>/tmp/pig-wc.log | tee /tmp/pig-wc.txt
grep -q '^(datos,3)$' /tmp/pig-wc.txt || { tail -50 /tmp/pig-wc.log; falla "Pig wordcount"; }

paso "Pig: ventas por producto"
pig ejemplos/ventas.pig || falla "Pig ventas"
hdfs dfs -cat '/user/root/resultados/pig_por_producto/part-*' | normalizar > /tmp/pig.txt
diff /tmp/esperado.txt /tmp/pig.txt || falla "Pig no coincide"

paso "Pig: modo local (sin cluster)"
pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig 2>/dev/null \
  | grep -q '^(datos,3)$' || falla "Pig local"

paso "Hive"
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
hdfs dfs -cat '/user/root/resultados/hive_por_producto/*' | normalizar > /tmp/hive.txt
diff /tmp/esperado.txt /tmp/hive.txt || falla "Hive no coincide"

paso "Spark"
spark-submit ejemplos/ventas.py
hdfs dfs -cat '/user/root/resultados/spark_por_producto/part-*' | normalizar > /tmp/spark.txt
diff /tmp/esperado.txt /tmp/spark.txt || falla "Spark no coincide"

paso "Sqoop: MySQL -> HDFS -> Hive -> MySQL"
mysql -N -B -e "SELECT COUNT(*) FROM tienda.ventas" | grep -qx 200000 \
  || falla "la base MySQL 'tienda' no tiene las 200000 ventas"
bash ejemplos/sqoop.sh
partes=$(hdfs dfs -ls /user/root/tienda/ventas | grep -c 'part-m-' || true)
[ "$partes" -eq 4 ] || falla "sqoop import -m 4: se esperaban 4 archivos y hay $partes"
# Lo importado es exactamente el dataset (sacando la columna id)
a=$(hdfs dfs -cat '/user/root/tienda/ventas/part-m-*' | cut -d, -f2- | md5sum)
b=$(tail -n +2 ventas_grandes.csv | md5sum)
[ "$a" = "$b" ] || falla "sqoop import: lo importado no coincide con la tabla de MySQL"
# Y lo exportado volvio a MySQL con el JOIN por categoria
cat > /tmp/esperado_cat.txt <<'FIN'
accesorios,96228,906830000
almacen,172775,257117400
infusiones,208983,640341500
panaderia,121087,108978300
FIN
mysql -N -B -e "SELECT categoria, unidades, facturado FROM tienda.resumen_categoria" \
  | normalizar > /tmp/sqoop.txt
diff /tmp/esperado_cat.txt /tmp/sqoop.txt || falla "sqoop export: no coincide"

# --hive-import (Sqoop 1.4.7 es anterior a Hive 4): se informa, no corta la prueba
paso "Sqoop: --hive-import (informativo)"
if timeout 600 sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
     --table sucursales --hive-import --hive-table sqoop_sucursales --delete-target-dir -m 1 \
     > /tmp/hive-import.log 2>&1 \
   && beeline -u jdbc:hive2://localhost:10000 --outputformat=csv2 \
        -e "SELECT COUNT(*) FROM sqoop_sucursales" 2>/dev/null | grep -qx 4; then
  echo "HIVE-IMPORT: ANDA"
else
  echo "HIVE-IMPORT: NO ANDA"; tail -40 /tmp/hive-import.log
fi

paso "Bajar un resultado a la compu"
rm -rf resultados && mkdir resultados
hdfs dfs -get /user/root/resultados/pig_por_producto resultados/
ls resultados/pig_por_producto

paso "Se cae un DataNode: los datos siguen ahi"
datanode stop 2
hdfs dfs -cat /user/root/ventas/ventas_grandes.csv | md5sum | grep -q 2a5af82c1a6e8a4385b86a144f5a5589 \
  || falla "con un DataNode caido no se pudo leer el archivo"
datanode start 2

paso "estado"
estado

echo
echo "TODO OK: MapReduce, Pig, Hive, Spark y Sqoop dan el resultado esperado"
