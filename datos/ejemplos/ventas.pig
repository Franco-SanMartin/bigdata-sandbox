-- Ventas por producto, en Pig Latin.
-- Mismo calculo que mapper.py/reducer.py (MapReduce), ventas.hql (Hive) y
-- ventas.py (Spark): los cuatro tienen que dar el mismo resultado.
--
-- Uso (adentro del contenedor, parado en /datos):
--   pig ejemplos/ventas.pig
--   pig -param entrada=/user/root/otra_carpeta ejemplos/ventas.pig
--
-- Cada paso es un "alias" (una relacion). Pig no ejecuta nada hasta el STORE
-- (o un DUMP): ahi arma el plan completo y lo corre como trabajos MapReduce
-- en YARN (se ven en http://localhost:8088).

%default entrada '/user/root/ventas'
%default salida  '/user/root/resultados/pig_por_producto'

-- 1. Leer el CSV (todos los archivos de la carpeta), con su esquema
ventas = LOAD '$entrada' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);

-- 2. Sacar la fila de encabezado (fecha,sucursal,...)
datos = FILTER ventas BY fecha != 'fecha';

-- 3. Importe de cada venta
con_importe = FOREACH datos GENERATE producto, cantidad,
              (long)cantidad * precio AS importe;

-- 4. Agrupar por producto y sumar
por_producto = GROUP con_importe BY producto;
resumen = FOREACH por_producto GENERATE
              group                   AS producto,
              SUM(con_importe.cantidad) AS unidades,
              SUM(con_importe.importe)  AS facturado;

-- 5. Ordenar de mayor a menor facturacion
ordenado = ORDER resumen BY facturado DESC;

-- 6. Guardar en HDFS (si ya existia de una corrida anterior, se borra antes)
fs -rm -r -f $salida;
STORE ordenado INTO '$salida' USING PigStorage(',');
