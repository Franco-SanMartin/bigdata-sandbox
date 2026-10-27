# 5. Pig

Pig Latin: el procesamiento se escribe paso a paso (cargar, filtrar, agrupar,
sumar) y Pig lo traduce a trabajos MapReduce. Lo mismo de la guía anterior en
pocas líneas.

[← 4. YARN y MapReduce](04-yarn-mapreduce.md) · [Índice](README.md) · Siguiente: [6. Hive →](06-hive.md)

Todo va **adentro** del contenedor, parado en `/datos`. Hace falta haber subido
las ventas a `/user/root/ventas` ([guía 3](03-hdfs.md#un-dataset-de-verdad-200000-ventas)).

## Cómo piensa Pig

- Cada línea crea una **relación** (un "alias"): `ventas = LOAD ...`,
  `datos = FILTER ventas BY ...`.
- Pig **no ejecuta nada** hasta un `DUMP` (mostrar) o un `STORE` (guardar).
  Ahí arma el plan completo y lo manda a YARN como uno o más trabajos
  MapReduce (se ven en http://localhost:8088).
- Pig no es un servicio: es un comando. Con `pig -x local` corre sin cluster,
  sobre archivos de tu carpeta (sirve para probar rápido).

## Wordcount

`ejemplos/wordcount.pig` es el mismo wordcount de la guía 4, en 6 líneas:

<!-- prueba: adentro | espera: (datos,3) -->
```bash
cat ejemplos/wordcount.pig
hdfs dfs -put -f ejemplos/texto.txt /user/root/
pig ejemplos/wordcount.pig
```

Al final, entre muchas líneas de log, aparece el `DUMP`:

```text
(datos,3)
(los,3)
(en,2)
...
```

Sin cluster, sobre el archivo de tu carpeta (mucho más rápido: no usa HDFS ni
YARN):

<!-- prueba: adentro | espera: (datos,3) -->
```bash
pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig
```

`-param` cambia un valor del script: `wordcount.pig` tiene `%default entrada
'/user/root/texto.txt'`.

## Ventas por producto

`ejemplos/ventas.pig` hace el cálculo de la guía 4 y guarda el resultado en
`/user/root/resultados/pig_por_producto`:

<!-- prueba: adentro | espera: yerba,179512,448780000 -->
```bash
pig ejemplos/ventas.pig
hdfs dfs -cat /user/root/resultados/pig_por_producto/part-*
```

```text
yerba,179512,448780000
termo,11793,412755000
mate,48154,385232000
cafe,29471,191561500
galletitas,82979,149362200
facturas,121087,108978300
bombilla,36281,108843000
azucar,89796,107755200
```

Los mismos números que con MapReduce, ya ordenados. Abrí `ejemplos/ventas.pig`
con un editor (está en tu carpeta `datos/ejemplos/`): cada paso está
comentado.

## Tu propio script

Un script de Pig es un archivo de texto con las instrucciones. Por ejemplo,
las ventas de la sucursal Centro del archivo chico, con su importe. Guardalo
como `datos/centro.pig` en tu compu y corrélo con `pig -x local centro.pig`:

<!-- prueba: adentro < pig -x local {} | espera: (2026-10-03,termo,1,35000) -->
```pig
ventas = LOAD 'ejemplos/ventas.csv' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray,
             cantidad:int, precio:int);
datos  = FILTER ventas BY fecha != 'fecha';
centro = FILTER datos BY sucursal == 'Centro';
con_importe = FOREACH centro GENERATE fecha, producto, cantidad, cantidad * precio AS importe;
DUMP con_importe;
```

```text
(2026-10-01,yerba,3,7500)
(2026-10-02,yerba,5,12500)
(2026-10-03,termo,1,35000)
```

También se pueden escribir de a una en la consola de Pig, `grunt`: `pig -x
local` (o `pig` para el cluster), pegar las líneas y salir con `quit`.

Para correrlo en el cluster sobre las 200.000 ventas: cambiá el `LOAD` por
`'/user/root/ventas'` y usá `pig centro.pig`.

## Lo más usado de Pig Latin

| Instrucción | Qué hace | En SQL sería |
|---|---|---|
| `LOAD 'ruta' USING PigStorage(',') AS (...)` | Lee un archivo (o una carpeta) con su esquema | `FROM` |
| `FILTER r BY cond` | Se queda con las filas que cumplen | `WHERE` |
| `FOREACH r GENERATE a, b*c AS x` | Elige o calcula columnas | `SELECT` |
| `GROUP r BY col` | Agrupa: queda `group` y una bolsa con las filas | `GROUP BY` |
| `SUM(r.col)`, `COUNT(r)`, `AVG(...)` | Resumen de una bolsa (después de `GROUP`) | `SUM`, `COUNT`... |
| `ORDER r BY col DESC` | Ordena | `ORDER BY` |
| `JOIN a BY x, b BY y` | Une dos relaciones | `JOIN` |
| `LIMIT r 10` | Las primeras 10 | `LIMIT` |
| `DUMP r` | Muestra el resultado (ejecuta) | |
| `STORE r INTO 'ruta' USING PigStorage(',')` | Guarda en HDFS (ejecuta) | `INSERT` |
| `DESCRIBE r` | Muestra el esquema de una relación | `DESCRIBE` |

## Para profundizar

- Teoría: [Pig](base/teoria/04-pig.md): el porqué y cómo funciona por dentro.
- Evaluación: [Pig](base/evaluacion/04-pig.md): preguntas y ejercicios con sus respuestas.
- Referencia: [Pig](base/referencia.md#pig): comandos, opciones y puertos.
