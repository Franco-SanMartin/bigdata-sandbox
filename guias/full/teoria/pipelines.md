# Pipelines de datos: de un CSV sucio a un resultado que se usa

Qué es un pipeline, por qué se parte en etapas, qué se decide en cada una y
cómo se elige la herramienta. Es la teoría detrás de la pantalla
[Pipeline](../06-pipeline.md), que lleva `ventas_sucias.csv` hasta un
resumen y un modelo en 6 etapas.

[← Teoría](README.md) · [Índice de full](../README.md)

## Qué es un pipeline

Un **pipeline de datos** es una cadena de pasos donde cada uno toma lo que
dejó el anterior, lo transforma y lo deja en un lugar conocido para el
siguiente. Partirlo en etapas tiene tres ventajas:

- **Se puede rehacer una parte**: si el análisis estaba mal, no hace falta
  volver a traer los datos.
- **Cada etapa puede usar su herramienta**: pandas para limpiar 4,5 MB, Hive
  para un SQL, Sqoop para llevar el resultado a una base.
- **Se puede controlar**: entre etapa y etapa hay un dato con nombre, formato
  y cantidad de filas que se puede revisar. Es lo que la pantalla muestra en
  el cable entre etapas y en **Viaja**.

La pantalla no deja correr una etapa sin su entrada (el error dice qué falta
y ofrece ir a la etapa anterior): es la regla de **dependencias** de
cualquier orquestador.

## Las seis etapas del sandbox

| Etapa | Pregunta que contesta | Entra | Sale |
|---|---|---|---|
| Ingesta | ¿Cómo traigo los datos al cluster? | `ventas_sucias.csv` en la carpeta local | `/user/root/ml/ventas_sucias.csv` en HDFS |
| ETL | ¿Cómo los dejo limpios y en un formato eficiente? | el CSV sucio | `/user/root/ml/ventas_limpias` en Parquet |
| Almacenamiento | ¿Cómo los hago consultables? | el Parquet | la tabla `default.ventas_limpias` o los Parquet solos |
| Análisis | ¿Qué digo con ellos? | la tabla o el Parquet | `/user/root/resultados/por_<campo>` |
| Machine Learning | ¿Qué puedo predecir? | `clientes_senal.csv` (una rama aparte) | un modelo |
| Resultados | ¿Cómo lo llevo a quien lo usa? | el resumen | un CSV local o `tienda.resumen_<campo>` en MySQL |

### Ingesta

Traer datos de donde nacen. Si ya son un **archivo**, se copian
(`hdfs dfs -put`); si viven en una **base relacional**, se leen con una
herramienta que hable SQL y escriba en HDFS en paralelo (**Sqoop**, que lanza
un MapReduce con varios mappers que leen la tabla por rangos de id). En la
industria se suman las **colas de mensajes** (Kafka) para datos que llegan
de a uno, todo el tiempo.

### ETL: extraer, transformar, cargar

Los datos reales vienen sucios: en `ventas_sucias.csv` hay fechas en tres
formatos, precios con coma, duplicados y faltantes. El ETL los arregla y los
guarda en un formato pensado para leer rápido: **Parquet**, que guarda por
columna y comprimido, así un análisis que usa 3 columnas de 10 lee solo
esas 3.

Hoy es común el orden inverso, **ELT**: cargar los datos crudos tal cual y
transformarlos después dentro del almacén con SQL. La ventaja es no perder
el crudo; la desventaja, guardar todo dos veces.

### Almacenamiento

En Big Data "almacenar" casi nunca es copiar a una base: los datos ya están
en HDFS. Lo que se agrega es la **descripción**: una tabla **externa** de
Hive anota en el Metastore dónde están los archivos y qué columnas tienen,
sin moverlos. Borrar una tabla externa borra la descripción, no los
archivos. Esa separación entre **archivos** y **catálogo** es la base de un
*data lake*.

### Análisis

Agregar: sumar, contar, agrupar. Es lo que más se repite y lo que más se
paraleliza: cada bloque se resume por separado y después se juntan los
resúmenes. Hive lo convierte en un trabajo Tez; Spark SQL, en etapas de
Spark; pandas lo hace en memoria en una máquina.

### Machine Learning

Una **rama aparte**: usa otro conjunto de datos (`clientes_senal.csv`)
porque las ventas generadas no tienen una relación que un modelo pueda
aprender. Un pipeline real no siempre es una línea: suele ser un **grafo**
(un DAG) con ramas que comparten algunas etapas.

### Resultados

El último tramo es llevar el resultado a quien lo usa. El resultado de un
trabajo distribuido son **varios archivos** (`part-…`, uno por tarea):
`hdfs dfs -getmerge` los junta en un CSV para una planilla; `sqoop export` lo
lleva a una tabla de MySQL para una aplicación. En la industria, esta etapa
se llama a veces *reverse ETL*: devolver los datos procesados a los sistemas
operativos.

![La pantalla Pipeline con el riel de las 6 etapas](../../../docs/capturas/pipeline.png)

## Elegir la herramienta: una máquina o un cluster

La pregunta de cada etapa es la misma: **¿entra en una máquina?**

| Si los datos... | Conviene | Por qué |
|---|---|---|
| entran holgados en memoria (MB, pocos GB) | pandas, scikit-learn, un cliente | Sin costo fijo: arrancan en milisegundos |
| no entran en una máquina (decenas de GB o más) | Spark, Hive sobre Tez, MapReduce | Reparten el trabajo; pagan un costo fijo de segundos (pedir contenedores, arrancar JVMs) |

Con los 4,5 MB del sandbox, pandas gana siempre: la sesión de Spark sola
lleva unos 15 s. Por eso la pantalla dice, para cada herramienta, cuándo
**conviene** y cuándo **no conviene**: la herramienta distribuida vale la
pena recién cuando los datos son grandes. Elegir Spark para todo "porque es
Big Data" es un error común y caro.

## Idempotencia: poder correrlo dos veces

Un paso es **idempotente** si correrlo dos veces deja lo mismo que una. En
un pipeline importa porque las etapas fallan y se reintentan. Ejemplos del
sandbox:

- `hdfs dfs -put -f` pisa el archivo: correrlo de nuevo deja lo mismo.
- Un wordcount sin *pisar la salida* falla la segunda vez porque la carpeta
  existe: MapReduce se niega a escribir encima, justamente para no mezclar
  resultados.
- **Empezar de nuevo** del pipeline solo borra el **registro** de la
  interfaz; los archivos y las tablas quedan. Volver a correr una etapa
  vuelve a escribir su salida.

## Linaje: de dónde salió cada dato

El **historial** de corridas guarda, para cada una, la herramienta, el motor,
el trabajo de YARN, cuánto tardó y qué dejó. Eso es **linaje** (*lineage*):
poder contestar "este número del resumen, ¿de qué archivo y con qué proceso
salió?". En una empresa es lo que se audita cuando un número no cierra.

## En la industria

Los pipelines se escriben como código y los corre un **orquestador**:
**Apache Airflow** (el más usado), **Dagster**, **Prefect**, **Apache
Oozie** en clusters Hadoop, o los servicios de nube (**AWS Glue**, **Azure
Data Factory**, **Google Cloud Composer**). Todos tienen lo mismo que esta
pantalla: etapas con dependencias, un historial de corridas, reintentos y una
vista de qué dejó cada una. El linaje lo llevan herramientas como
**OpenLineage** o **Apache Atlas**.

## Para pensar

- ¿Por qué el ETL guarda en Parquet y no en CSV?
- Si el análisis da un número raro, ¿qué etapa revisás primero y cómo?
- ¿Cuándo usarías Sqoop para la ingesta en vez de `hdfs dfs -put`?

Hay preguntas sobre esto en la
[evaluación del pipeline](../evaluacion/pipeline.md).
