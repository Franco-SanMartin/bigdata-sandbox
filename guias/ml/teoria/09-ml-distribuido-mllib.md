# 9. ML distribuido con Spark MLlib

[← 8. pandas contra Spark](08-pandas-vs-spark.md) · [Índice de teoría](README.md)

## Por qué otra librería

scikit-learn necesita todos los datos de entrenamiento en la memoria de una
compu. Si los clientes fueran 500 millones, no entrarían. **Spark MLlib**
(`pyspark.ml`) entrena sobre DataFrames de Spark, repartidos en el cluster:
los datos se quedan donde están y el trabajo se reparte entre los executors.

## Cómo se reparte el entrenamiento

La mayoría de los algoritmos se pueden escribir como "cada executor calcula
algo sobre sus particiones, el driver junta y decide el próximo paso":

| Algoritmo | Qué calcula cada executor | Qué hace el driver |
|---|---|---|
| Regresión lineal | Sumas de productos de sus filas (lo que hace falta para la fórmula de mínimos cuadrados) | Suma lo de todos y resuelve |
| Regresión logística, red neuronal | El gradiente del error con sus filas y los pesos actuales | Suma los gradientes, mueve los pesos, manda los nuevos; repite |
| Árbol de decisión | Para cada columna y cada corte posible, cuántos de cada clase quedan de cada lado (histogramas) | Elige el mejor corte; repite por nivel |
| KMeans | A qué centro va cada una de sus filas, y la suma de las filas de cada centro | Promedia y mueve los centros; repite |

Por eso los algoritmos de MLlib a veces difieren de los de scikit-learn: un
árbol de MLlib no prueba **todos** los cortes, sino un máximo por columna
(`maxBins`, 32 por defecto), para que los histogramas sean chicos y viajen
poco. Con datos chicos, los resultados son parecidos pero no idénticos.

Y por eso es lento con pocos datos: cada iteración es al menos un job, con
su costo fijo. Con 20.000 clientes, scikit-learn entrena en milisegundos lo
que a MLlib le lleva segundos.

## Las piezas

### DataFrame con una columna `features`

MLlib quiere todas las entradas juntas en **una** columna de tipo vector, y la
respuesta en otra:

| antiguedad_meses | visitas_mes | ... | features | vuelve |
|---|---|---|---|---|
| 50 | 4 | ... | [50.0,4.0,9131.0,1.0,76.0] | 1 |

`VectorAssembler(inputCols=ENTRADAS, outputCol="features")` arma esa columna.

### Transformer

Algo que **transforma** un DataFrame en otro, sin aprender nada: tiene un
método `transform(df)` que agrega columnas. `VectorAssembler` es un
Transformer. Un modelo ya entrenado también: agrega `prediction`.

### Estimator

Algo que **aprende** de un DataFrame: tiene un método `fit(df)` que devuelve
un **Model**, que es un Transformer.

    DecisionTreeClassifier(...)  --fit(ent)-->  DecisionTreeClassificationModel  --transform(prueba)-->  DataFrame + prediction
         (Estimator)                                 (Model = Transformer)

A diferencia de scikit-learn, `fit` **no modifica** el estimador: devuelve
otro objeto. El estimador queda igual y se puede volver a entrenar con otros
datos (eso hace `CrossValidator` por dentro).

`StandardScaler` también es un Estimator: `fit` aprende promedios y desvíos,
y devuelve un `StandardScalerModel` que los aplica.

### Pipeline

Una lista de etapas (Transformers y Estimators) que se trata como un solo
Estimator:

    Pipeline(stages=[StandardScaler(...), LogisticRegression(...)])

`fit` recorre las etapas en orden: si es un Estimator, lo entrena y usa el
modelo para transformar los datos que pasan a la etapa siguiente. Devuelve un
**PipelineModel** con todas las etapas entrenadas. El clustering de
`modelos_spark.py` es un Pipeline de tres: `VectorAssembler` →
`StandardScaler` → `KMeans`.

Ventajas: la preparación y el modelo van juntos (el escalador aprende solo del
entrenamiento, sin fugas), y el PipelineModel se puede guardar y aplicar a
datos nuevos con un solo `transform`.

### Evaluator

Calcula una métrica sobre un DataFrame con predicciones:
`RegressionEvaluator` (`r2`, `mae`, `rmse`) y
`MulticlassClassificationEvaluator` (`accuracy`, entre otras).

### CrossValidator y ParamGridBuilder

`ParamGridBuilder().addGrid(arbol.maxDepth, [2, 3, 5]).build()` arma la lista
de combinaciones. `CrossValidator(estimator, estimatorParamMaps, evaluator,
numFolds=3)` es un Estimator: su `fit` hace la validación cruzada de cada
combinación (3 × 3 = 9 entrenamientos), elige la mejor y la vuelve a entrenar
con todos los datos. El modelo que devuelve tiene `bestModel` y `avgMetrics`
(el promedio de cada combinación). Ver [teoría 7](07-evaluacion.md).

## scikit-learn y MLlib, lado a lado

| | scikit-learn | Spark MLlib |
|---|---|---|
| Datos | `X` (tabla) e `y` (columna), en memoria | Un DataFrame repartido, con `features` y `labelCol` |
| Entrenar | `modelo.fit(X, y)` modifica el modelo | `estimator.fit(df)` devuelve un Model nuevo |
| Predecir | `predict(X)` → array | `transform(df)` → DataFrame con `prediction` (y `probability`) |
| Encadenar | `make_pipeline` | `Pipeline(stages=[...])` |
| Métricas | Funciones (`accuracy_score`) | Evaluators |
| Validación cruzada | `cross_val_score`, `GridSearchCV` | `CrossValidator` + `ParamGridBuilder` |
| Separar | `train_test_split` (exacto) | `randomSplit` (aproximado) |
| Datos repetidos en memoria | Siempre | `cache()` (lo pide el script para entrenamiento y prueba) |
| Modelos | Muchísimos | Menos, los que se pueden repartir bien |
| Con 20.000 filas | Milisegundos | Segundos |
| Con 500 millones | No entra | Escala con el cluster |

## `cache()`

Spark es perezoso: si un DataFrame se usa en 5 entrenamientos, sin `cache()`
se vuelve a leer y armar desde HDFS 5 veces (y los algoritmos iterativos lo
recorren muchas veces por entrenamiento). `ent.cache()` le dice a Spark que,
la primera vez que lo calcule, guarde las particiones en la memoria de los
executors. Se ve en http://localhost:4040, pestaña *Storage*. Ocupa memoria
de los executors (512 MB cada uno en la imagen): solo se cachea lo que se
reusa.

## Un camino intermedio

No todo es "todo en Spark" o "todo en pandas". Patrones comunes:

- **Spark prepara, scikit-learn entrena**: el ETL y la agregación en Spark
  reducen millones de filas de eventos a una tabla de clientes que sí entra
  en una compu; esa tabla se pasa a pandas (`toPandas`) y se modela con
  scikit-learn. Es lo más común.
- **Resultado chico de Spark a pandas** para calcular una métrica que MLlib no
  trae: lo que hace `modelos_spark.py` con el Rand ajustado.
- **Muchos modelos chicos en paralelo**: probar cientos de combinaciones de
  hiperparámetros, cada una en un executor.

## Para repasar

- MLlib reparte el entrenamiento: cada executor calcula sobre sus
  particiones, el driver junta, y se repite.
- Transformer (`transform`), Estimator (`fit` → Model), Pipeline (etapas en
  orden), Evaluator (métricas), CrossValidator (elegir hiperparámetros).
- Todo es un DataFrame, hasta las predicciones.
- `cache()` para lo que se reusa; con pocos datos, scikit-learn es más rápido.

[← 8. pandas contra Spark](08-pandas-vs-spark.md) · [Índice de teoría](README.md)
