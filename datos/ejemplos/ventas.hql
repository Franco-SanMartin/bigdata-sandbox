-- Ventas por producto, en Hive (SQL).
-- Mismo calculo que ventas.pig (Pig), mapper.py/reducer.py (MapReduce) y
-- ventas.py (Spark).
--
-- Uso (adentro del contenedor, parado en /datos):
--   beeline -u jdbc:hive2://localhost:10000 -f ejemplos/ventas.hql
--
-- Cada consulta corre como un trabajo TEZ en YARN (http://localhost:8088).

-- Tabla EXTERNA: Hive solo guarda el esquema en su metastore; los datos siguen
-- siendo los archivos de /user/root/ventas en HDFS, los mismos que leen Pig y
-- Spark. Si borras la tabla (DROP TABLE), los archivos quedan.
CREATE EXTERNAL TABLE IF NOT EXISTS ventas (
  fecha    STRING,
  sucursal STRING,
  producto STRING,
  cantidad INT,
  precio   INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/ventas'
TBLPROPERTIES ('skip.header.line.count' = '1');

-- Ventas por producto
SELECT producto,
       SUM(cantidad)                   AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto
ORDER BY facturado DESC;

-- Ventas por sucursal
SELECT sucursal,
       COUNT(*)                        AS tickets,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY sucursal
ORDER BY facturado DESC;

-- Guardar el resultado por producto como archivo en HDFS
INSERT OVERWRITE DIRECTORY '/user/root/resultados/hive_por_producto'
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
SELECT producto,
       SUM(cantidad)                   AS unidades,
       SUM(CAST(cantidad AS BIGINT) * precio) AS facturado
FROM ventas
GROUP BY producto
ORDER BY facturado DESC;
