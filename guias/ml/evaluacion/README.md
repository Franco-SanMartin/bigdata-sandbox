# Evaluación de `ml`

Preguntas y ejercicios para cada tema de la [teoría](../teoria/README.md). Sirven
para estudiar solo (las respuestas están escondidas: se abren con un clic) y
para armar un examen o un trabajo práctico.

[← Índice de ml](../README.md)

| # | Tema | Teoría | Guías que lo practican |
|---|---|---|---|
| 1 | [Qué es machine learning](01-que-es-ml.md) | [1](../teoria/01-que-es-ml.md) | [4](../04-modelos-sklearn.md) |
| 2 | [Preparación y calidad de datos](02-preparacion-de-datos.md) | [2](../teoria/02-preparacion-de-datos.md) | [2](../02-datos-sucios-pandas.md), [3](../03-etl-spark.md) |
| 3 | [Regresión lineal](03-regresion.md) | [3](../teoria/03-regresion.md) | [4](../04-modelos-sklearn.md) |
| 4 | [Clasificación](04-clasificacion.md) | [4](../teoria/04-clasificacion.md) | [4](../04-modelos-sklearn.md) |
| 5 | [Clustering](05-clustering.md) | [5](../teoria/05-clustering.md) | [4](../04-modelos-sklearn.md) |
| 6 | [Redes neuronales](06-redes-neuronales.md) | [6](../teoria/06-redes-neuronales.md) | [4](../04-modelos-sklearn.md), [5](../05-modelos-spark-mllib.md) |
| 7 | [Evaluación de modelos](07-evaluacion.md) | [7](../teoria/07-evaluacion.md) | [4](../04-modelos-sklearn.md) |
| 8 | [pandas contra Spark](08-pandas-vs-spark.md) | [8](../teoria/08-pandas-vs-spark.md) | [3](../03-etl-spark.md) |
| 9 | [ML distribuido con MLlib](09-ml-distribuido-mllib.md) | [9](../teoria/09-ml-distribuido-mllib.md) | [5](../05-modelos-spark-mllib.md) |

## Cómo está armado cada archivo

1. **Multiple choice**: 4 opciones, una correcta. La respuesta explica por qué
   es esa y por qué no las otras tres: leer la explicación aunque se haya
   acertado.
2. **Preguntas de desarrollo**: para contestar con palabras propias. Debajo
   hay una respuesta modelo: no hace falta que sea igual, pero tiene que
   tocar los mismos puntos.
3. **Ejercicios prácticos**: se hacen en la imagen `ml` (en JupyterLab o en
   la terminal de adentro), sobre los archivos que dejan las guías. Cada uno
   dice qué guía hay que haber hecho antes, trae una solución y una rúbrica
   corta para corregir.

## Antes de los ejercicios

Los ejercicios usan lo que generan las guías, parados en `/datos`:

| Archivo | Lo genera | Guía |
|---|---|---|
| `ventas_sucias.csv` | `python3 ejemplos/ml/generar_sucios.py` | [2](../02-datos-sucios-pandas.md) |
| `ventas_limpias.parquet` | `python3 ejemplos/ml/etl_pandas.py` | [2](../02-datos-sucios-pandas.md) |
| `/user/root/ml/ventas_limpias` (HDFS) | `spark-submit ejemplos/ml/etl_spark.py` | [3](../03-etl-spark.md) |
| `clientes_senal.csv` | `python3 ejemplos/ml/generar_senal.py` | [4](../04-modelos-sklearn.md) |
| `metricas_sklearn.json` | `python3 ejemplos/ml/modelos_sklearn.py` | [4](../04-modelos-sklearn.md) |
| `metricas_spark.json` | `spark-submit ejemplos/ml/modelos_spark.py` | [5](../05-modelos-spark-mllib.md) |

Los generadores usan una semilla fija: los datos son los mismos en todas las
compus, y por eso las soluciones pueden dar números exactos. Los de
scikit-learn salieron de las versiones de la imagen (scikit-learn 1.9.1,
pandas 2.3.3); en otra compu pueden cambiar en el último decimal, no más. Los
de Spark se dan como rangos, igual que en la [guía 5](../05-modelos-spark-mllib.md).

Las soluciones de los ejercicios están marcadas como celdas o comandos para
copiar a mano: no son parte de las guías y no las corre la prueba
automática.

## Para el profe

- Cada archivo tiene más preguntas de las que entran en un examen: elegir.
- Los ejercicios prácticos se pueden corregir mirando el número final: con
  la semilla fija, todos tienen que llegar al mismo (o al mismo rango, en
  Spark).
- Las rúbricas suman 10 puntos por ejercicio.
- Una variante que obliga a pensar: generar otra cantidad de clientes
  (`python3 ejemplos/ml/generar_senal.py 2000 clientes_chico.csv`, el primer
  argumento es la cantidad y el segundo el archivo) y pedir que expliquen
  qué números cambiaron y por qué (con 2.000 clientes, la prueba son 400 y
  los resultados se mueven más).

[← Índice de ml](../README.md)
