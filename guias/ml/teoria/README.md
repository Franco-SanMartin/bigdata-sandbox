# Teoría de `ml`

Los conceptos detrás de las guías, explicados con los ejemplos de la imagen:
las ventas sucias (`generar_sucios.py`) y los clientes con reglas conocidas
(`generar_senal.py`). Cada tema se puede leer solo, pero el orden de abajo es
el que conviene la primera vez.

[← Índice de ml](../README.md)

| # | Tema | Qué responde | Guía práctica |
|---|---|---|---|
| 1 | [Qué es machine learning](01-que-es-ml.md) | Supervisado y no supervisado, regresión y clasificación, entrenar y predecir | [4](../04-modelos-sklearn.md) |
| 2 | [Preparación y calidad de datos](02-preparacion-de-datos.md) | ETL, tipos de errores, nulos, duplicados, outliers, escalado | [2](../02-datos-sucios-pandas.md) |
| 3 | [Regresión lineal](03-regresion.md) | Cómo aprende una fórmula, qué son los coeficientes, R² y MAE | [4](../04-modelos-sklearn.md) |
| 4 | [Clasificación: logística y árboles](04-clasificacion.md) | Por qué la logística no puede con la regla y el árbol sí | [4](../04-modelos-sklearn.md) |
| 5 | [Clustering con k-means](05-clustering.md) | Grupos sin respuestas, por qué hay que escalar, cómo elegir k | [4](../04-modelos-sklearn.md) |
| 6 | [Redes neuronales básicas](06-redes-neuronales.md) | Qué es un perceptrón multicapa y cuándo conviene | [4](../04-modelos-sklearn.md), [5](../05-modelos-spark-mllib.md) |
| 7 | [Evaluación](07-evaluacion.md) | Entrenamiento y prueba, métricas, sobreajuste, validación cruzada | [4](../04-modelos-sklearn.md) |
| 8 | [pandas contra Spark](08-pandas-vs-spark.md) | Una compu o un cluster: qué cambia y cuándo conviene cada uno | [3](../03-etl-spark.md) |
| 9 | [ML distribuido con MLlib](09-ml-distribuido-mllib.md) | Transformers, Estimators, Pipelines y cómo se reparte el entrenamiento | [5](../05-modelos-spark-mllib.md) |

Cada tema tiene sus preguntas y ejercicios en [evaluación](../evaluacion/README.md).

## Las dos bases de ejemplo, en una tabla

Se nombran en todos los temas:

| | Ventas sucias | Clientes con señal |
|---|---|---|
| Script | `generar_sucios.py` | `generar_senal.py` |
| Archivo | `ventas_sucias.csv` (103.000 filas) | `clientes_senal.csv` (20.000 filas) |
| Para | Limpieza de datos (ETL) | Machine learning |
| Qué se sabe | Cuántos errores de cada tipo hay | Las fórmulas que armaron las respuestas |
| Respuestas | 97.200 tickets limpios | `gasto_mes_siguiente` (regresión), `vuelve` (clasificación), `segmento_real` (clustering) |

Las reglas de los clientes, que se repiten en varios temas:

- **Gasto** = 5000 + 1500 × visitas + 0,8 × ticket − 1500 × reclamos + 50 ×
  antigüedad + ruido (normal, desvío 2000). La edad no influye.
- **Vuelve** si (visitas ≥ 4 y reclamos ≤ 1) o antigüedad ≥ 36, con el 10 %
  de las respuestas dado vuelta al azar.
- **Segmentos**: ocasional (60 %, 1 a 3 visitas, ticket ~6.000), frecuente
  (30 %, 4 a 10 visitas, ticket ~9.000), mayorista (10 %, 1 a 6 visitas,
  ticket ~60.000).

[← Índice de ml](../README.md)
