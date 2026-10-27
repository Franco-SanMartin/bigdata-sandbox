# 4. Pig

Un lenguaje de **flujo de datos** para Hadoop: el procesamiento se escribe
como una secuencia de transformaciones (cargar, filtrar, agrupar, sumar) y
Pig se encarga de convertirla en trabajos MapReduce.

[← 3. YARN y MapReduce](03-yarn-mapreduce.md) · [Teoría](README.md) · Siguiente: [5. Hive →](05-hive.md)

## Por qué existe

Escribir MapReduce a mano es largo: el wordcount en Java son decenas de
líneas, y un JOIN o dos agrupamientos seguidos son varios trabajos
encadenados a mano. Yahoo creó Pig (~2006) para que sus analistas escribieran
**qué** querían hacer con los datos, paso a paso, y que la herramienta
resolviera **cómo** repartirlo en el cluster. El mismo wordcount en Pig
Latin son 6 líneas.

Pig está entre MapReduce y SQL: como SQL, es declarativo en cada paso (decís
"agrupá por producto", no cómo agrupar); como un programa, se escribe en
orden, un paso detrás de otro, y cada resultado intermedio tiene nombre.

## Conceptos

| Concepto | Qué es |
|---|---|
| **Relación** | El resultado de cada paso, con un nombre (*alias*): `ventas = LOAD ...`. Es una bolsa de tuplas |
| **Tupla** | Una fila: una lista ordenada de campos, `(yerba,179512,448780000)` |
| **Bolsa** (*bag*) | Un conjunto de tuplas, que puede tener repetidas y no tiene orden: `{(a,1),(a,2)}` |
| **Campo** | Cada valor de una tupla; puede ser simple (`int`, `long`, `chararray`) o complejo (otra tupla, una bolsa, un `map`) |
| **Esquema** | Los nombres y tipos de los campos, declarados en el `LOAD ... AS (...)`. Es opcional: sin esquema, los campos se nombran `$0`, `$1`... |
| **Evaluación diferida** | Nada se ejecuta hasta un `DUMP` o un `STORE` |
| **Plan** | Lo que arma Pig con todo el script: un plan lógico, uno físico y uno de trabajos MapReduce |
| **Modo** | `mapreduce` (en el cluster, de fábrica) o `local` (en una sola máquina, sin HDFS ni YARN) |

El modelo de datos **anidado** es lo que más diferencia a Pig de SQL: una
celda puede contener una bolsa entera. Eso es justo lo que produce un
`GROUP`:

```text
  con_importe:                          GROUP con_importe BY producto:
  (yerba, 3, 7500)                      (yerba,  {(yerba,3,7500), (yerba,5,12500), (yerba,1,2500)})
  (mate, 1, 8000)                       (mate,   {(mate,1,8000), (mate,2,16000)})
  (yerba, 5, 12500)          ---->      (bombilla, {(bombilla,2,6000)})
  (bombilla, 2, 6000)                   (termo,  {(termo,1,35000)})
  (yerba, 1, 2500)
  (termo, 1, 35000)                     cada tupla: el campo "group" (la clave)
  (mate, 2, 16000)                      y una bolsa con todas sus filas
```

(Son las 7 ventas de `ejemplos/ventas.csv`.) Después, `FOREACH ... GENERATE
group, SUM(con_importe.cantidad)` recorre cada grupo y resume su bolsa. En SQL
el agrupamiento y el resumen van juntos en una misma consulta; en Pig son dos
pasos, y entre ellos se puede hacer cualquier cosa con la bolsa (ordenarla,
filtrarla, quedarse con las primeras).

## Cómo funciona por dentro

```text
  script .pig
     |   1. parser: verifica la sintaxis y los esquemas
     v
  plan lógico        LOAD -> FILTER -> FOREACH -> GROUP -> FOREACH -> ORDER -> STORE
     |   2. optimizador: sube los FILTER lo más cerca del LOAD posible,
     |      descarta columnas que no se usan, junta FOREACH seguidos...
     v
  plan físico        operadores concretos (incluido el reparto por clave del GROUP)
     |   3. compilador: corta el plan en trabajos donde hace falta un shuffle
     v
  plan MapReduce     trabajo 1: map (LOAD, FILTER, FOREACH) + shuffle + reduce (GROUP, SUM)
                     trabajos del ORDER: uno muestrea las claves para repartir
                     rangos parejos entre reducers, otro ordena
     |   4. los manda a YARN, uno detrás de otro, y espera
     v
  resultado (DUMP en pantalla o STORE en HDFS)
```

- Cada operación que necesita juntar filas por clave (`GROUP`, `JOIN`,
  `ORDER`, `DISTINCT`) obliga a un **shuffle** y, por lo tanto, a un reduce.
  Los `FILTER` y `FOREACH` sin agrupar se hacen dentro de los map.
- Con funciones **algebraicas** como `SUM` y `COUNT`, que se pueden calcular
  por partes y juntar después, Pig usa el **combiner** solo: cada mapper manda
  sumas parciales en vez de cada fila.
- `EXPLAIN alias;` muestra los tres planes. Es la mejor forma de ver cuántos
  trabajos va a generar un script antes de correrlo.
- Por la evaluación diferida, si un script tiene dos `STORE`, Pig puede
  compartir la lectura de la entrada entre los dos (*multi-query*).

### Modo local y modo cluster

- `pig -x local`: todo en un solo proceso, sobre archivos del disco local.
  Arranca en segundos y no necesita HDFS ni YARN. Sirve para probar un script
  con un archivo chico.
- `pig` (modo `mapreduce`): rutas de HDFS y trabajos en YARN. Es el mismo
  script: solo cambian las rutas, que conviene pasar como parámetros
  (`%default entrada ...` y `-param entrada=...`).

## Ventajas y limitaciones

**Ventajas**

- Mucho más corto que MapReduce y más fácil de leer.
- El flujo paso a paso, con nombres para cada resultado intermedio, es
  natural para ETL (extraer, transformar, cargar).
- Modelo de datos anidado: maneja bien datos semiestructurados.
- Se puede extender con funciones propias (UDF) en Java o Python.

**Limitaciones**

- Genera trabajos **MapReduce**: hereda su latencia y el paso por disco
  entre trabajos.
- Es un lenguaje propio. Para el análisis, la mayoría prefiere SQL, que ya
  conoce.
- El proyecto tiene muy poca actividad: sale una versión cada varios años (la
  de esta imagen es la 0.18.0). Lo nuevo se escribe con DataFrames de Spark (que copian la idea
  de transformaciones encadenadas con evaluación diferida) o con SQL.

Se sigue enseñando porque muestra muy claro el camino de un lenguaje de alto
nivel a trabajos distribuidos, y porque hay mucho código en Pig en
producción.

## En la guía 5 lo ves cuando...

- **[Wordcount](../../05-pig.md#wordcount)**: `TOKENIZE` + `FLATTEN` arman
  una tupla por palabra, y `GROUP` + `COUNT` hacen el mismo wordcount de la
  guía 4 en 6 líneas.
- **[Wordcount con `-x local`](../../05-pig.md#wordcount)**: el mismo script
  sin cluster, mucho más rápido, cambiando la entrada con `-param`.
- **[Ventas por producto](../../05-pig.md#ventas-por-producto)**: en
  http://localhost:8088 aparecen varios trabajos MapReduce para un solo
  script (el `GROUP` y el `ORDER`); el resultado es el mismo de MapReduce, ya
  ordenado.
- **[Tu propio script](../../05-pig.md#tu-propio-script)**: `FILTER` y
  `FOREACH` sin `GROUP`; en modo local, el resultado sale con `DUMP`.

Para repasar: [evaluación de Pig](../evaluacion/04-pig.md). Comandos:
[referencia de Pig](../referencia.md#pig).
