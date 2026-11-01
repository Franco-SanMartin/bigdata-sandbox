-- Facturacion por categoria, en Pig Latin: un JOIN de las ventas con los
-- productos. La misma cuenta que el JOIN de tienda.hql (Hive) y que
-- categoria.py (Spark), sobre las tablas que trajo Sqoop desde MariaDB.
--
-- Uso (adentro del contenedor, parado en /datos), despues de traer la base:
--   bash ejemplos/sqoop.sh                  # o la etapa 1 del Pipeline
--   pig ejemplos/comparar/categoria.pig
--
-- Pig hace un JOIN "del lado del reduce": las ventas y los productos viajan
-- por el shuffle agrupados por producto. Con 'replicated' (al final del JOIN)
-- mandaria la tabla chica a cada mapper y se ahorraria ese shuffle.

%default salida '/user/root/resultados/pig_por_categoria'

-- 1. Las dos tablas, como las dejo Sqoop (texto separado por comas, sin encabezado)
ventas = LOAD '/user/root/tienda/ventas' USING PigStorage(',')
         AS (id:int, fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
productos = LOAD '/user/root/tienda/productos' USING PigStorage(',')
            AS (producto:chararray, categoria:chararray, precio:int);

-- 2. Unirlas por producto
unidas = JOIN ventas BY producto, productos BY producto;

-- 3. La categoria y el importe de cada venta
lineas = FOREACH unidas GENERATE productos::categoria AS categoria,
         ventas::cantidad AS cantidad,
         (long)ventas::cantidad * ventas::precio AS importe;

-- 4. Agrupar por categoria y sumar
por_categoria = GROUP lineas BY categoria;
resumen = FOREACH por_categoria GENERATE
              group                 AS categoria,
              SUM(lineas.cantidad)  AS unidades,
              SUM(lineas.importe)   AS facturado;
ordenado = ORDER resumen BY facturado DESC;

-- 5. Guardar en HDFS (si ya existia de una corrida anterior, se borra antes)
fs -rm -r -f $salida;
STORE ordenado INTO '$salida' USING PigStorage(',');
