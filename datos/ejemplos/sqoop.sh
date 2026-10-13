#!/usr/bin/env bash
# Sqoop de punta a punta: MySQL -> HDFS -> Hive -> MySQL.
#
# Uso (adentro del contenedor, parado en /datos):
#   bash ejemplos/sqoop.sh
# o copiar los comandos de a uno, para ver que hace cada paso.
#
# La base de ejemplo es "tienda" (ejemplos/tienda.sql), en el MySQL que corre
# adentro del contenedor. Usuario alumno, clave alumno.
#
# Sqoop no es un servicio: cada import/export es un trabajo MapReduce que solo
# tiene mappers (http://localhost:8088). Antes de copiar una tabla genera una
# clase Java para leerla (queda un <tabla>.java en la carpeta: se puede borrar).
set -e

echo; echo "=== 1. Mirar la base de datos desde Sqoop ==="
sqoop list-databases --connect jdbc:mysql://localhost --username alumno --password alumno

sqoop list-tables --connect jdbc:mysql://localhost/tienda --username alumno --password alumno

# eval: corre SQL en MySQL y muestra el resultado (no usa Hadoop)
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "SELECT * FROM productos"

echo; echo "=== 2. Importar: MySQL -> HDFS ==="
# Tabla chica: 1 mapper (-m 1) -> 1 archivo. --delete-target-dir: si la
# carpeta ya existe la pisa (sino falla, igual que MapReduce)
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table productos \
  --target-dir /user/root/tienda/productos --delete-target-dir \
  -m 1

# Tabla grande: 4 mappers en paralelo. Sqoop parte la tabla en 4 rangos de la
# clave primaria (id) y cada mapper copia uno -> 4 archivos part-m-0000N
sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table ventas \
  --target-dir /user/root/tienda/ventas --delete-target-dir \
  -m 4

hdfs dfs -ls /user/root/tienda/ventas
hdfs dfs -cat /user/root/tienda/ventas/part-m-00000 | head -5

echo; echo "=== 3. Procesar en Hive: JOIN ventas + productos ==="
beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql

echo; echo "=== 4. Exportar: HDFS -> MySQL ==="
# La tabla destino tiene que existir; se vacia para poder repetir el ejemplo
sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "TRUNCATE TABLE resumen_categoria"

sqoop export --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --table resumen_categoria \
  --export-dir /user/root/resultados/hive_por_categoria \
  -m 1

sqoop eval --connect jdbc:mysql://localhost/tienda --username alumno --password alumno \
  --query "SELECT * FROM resumen_categoria ORDER BY facturado DESC"
