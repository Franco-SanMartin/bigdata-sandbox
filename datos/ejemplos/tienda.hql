-- Lo que trajo Sqoop desde MySQL, consultado en Hive.
-- Lo corre ejemplos/sqoop.sh despues de importar; a mano:
--   beeline -u jdbc:hive2://localhost:10000 -f ejemplos/tienda.hql
--
-- Sqoop dejo cada tabla como archivos de texto separados por comas en
-- /user/root/tienda/<tabla>. Las tablas EXTERNAS de Hive las leen en su lugar.

CREATE EXTERNAL TABLE IF NOT EXISTS tienda_ventas (
  id       INT,
  fecha    STRING,
  sucursal STRING,
  producto STRING,
  cantidad INT,
  precio   INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/tienda/ventas';

CREATE EXTERNAL TABLE IF NOT EXISTS tienda_productos (
  producto  STRING,
  categoria STRING,
  precio    INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/tienda/productos';

-- JOIN entre las dos tablas importadas: facturacion por categoria
SELECT p.categoria,
       SUM(v.cantidad)                           AS unidades,
       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado
FROM tienda_ventas v
JOIN tienda_productos p ON v.producto = p.producto
GROUP BY p.categoria
ORDER BY facturado DESC;

-- El mismo resultado, a archivo en HDFS: es lo que 'sqoop export' devuelve a MySQL
INSERT OVERWRITE DIRECTORY '/user/root/resultados/hive_por_categoria'
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
SELECT p.categoria,
       SUM(v.cantidad)                           AS unidades,
       SUM(CAST(v.cantidad AS BIGINT) * v.precio) AS facturado
FROM tienda_ventas v
JOIN tienda_productos p ON v.producto = p.producto
GROUP BY p.categoria;
