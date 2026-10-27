# 7. Evaluación: entrenamiento y prueba, métricas, sobreajuste y validación cruzada

[← 6. Redes neuronales básicas](06-redes-neuronales.md) · [Índice de teoría](README.md) · Siguiente: [8. pandas contra Spark →](08-pandas-vs-spark.md)

## La pregunta

Un modelo sirve si acierta con **datos que no vio**: los clientes del mes que
viene, no los que se usaron para entrenar. Todo lo de este tema es para
estimar eso bien.

## Entrenamiento y prueba

Si se mide con los mismos datos con los que se entrenó, es como tomar un
examen con los mismos ejercicios de la práctica: el que se los memorizó
saca 10 sin haber entendido nada. Por eso se separa:

- **Entrenamiento** (80 %): el modelo aprende con esto.
- **Prueba** (20 %): se guarda, y se usa **solo** para medir al final.

En scikit-learn, `train_test_split(X, y, test_size=0.2, random_state=42)`:
16.000 y 4.000 clientes, sorteados (si los datos vienen ordenados, sin
sortear la prueba sería toda de un tipo). En Spark, `randomSplit([0.8, 0.2],
seed=42)`, que sortea cada fila por separado y da **alrededor** de 16.000 y
4.000.

Reglas:

- Nada de la prueba puede influir en el entrenamiento: ni para elegir
  hiperparámetros, ni para escalar (el `StandardScaler` aprende promedios y
  desvíos solo del entrenamiento; el pipeline se encarga).
- Si se usa la prueba muchas veces para elegir entre modelos, se termina
  "entrenando" con ella. Para elegir, validación cruzada (abajo); la prueba,
  al final.
- Con datos en el tiempo (ventas, por ejemplo), la prueba tiene que ser lo
  **más nuevo**: no se entrena con el futuro para predecir el pasado.

## Métricas de clasificación

### Aciertos (accuracy)

El porcentaje de predicciones correctas. Fácil de entender, pero engaña
cuando una clase es mucho más común: el modelo tonto acierta 57,3 % sin mirar
nada. Con un fraude cada mil transacciones, decir siempre "no es fraude"
acierta el 99,9 % y no sirve para nada.

### Matriz de confusión

Para el árbol de profundidad 3, con los 4.000 de prueba:

| | Dijo "no vuelve" (0) | Dijo "vuelve" (1) |
|---|---:|---:|
| **No volvió (0)** | 1485 (verdadero negativo) | 223 (falso positivo) |
| **Volvió (1)** | 140 (falso negativo) | 2152 (verdadero positivo) |

Los aciertos son la diagonal: (1485 + 2152) / 4000 = 90,9 %. Pero la matriz
dice además **cómo** se equivoca: 223 veces dijo que volvía y no; 140 veces
dijo que no y volvió.

### Precision y recall

Para la clase "vuelve":

- **Precision** = de los que **dijo** que vuelven, cuántos volvieron:
  2152 / (2152 + 223) = 0,906.
- **Recall** (sensibilidad) = de los que **volvieron**, cuántos encontró:
  2152 / (2152 + 140) = 0,939.
- **F1** = un promedio de las dos (armónico): 0,922.

Cuál importa más depende del costo de cada error:

| Si el modelo se usa para... | Error caro | Conviene subir |
|---|---|---|
| Mandar un descuento a los que **no** van a volver, para retenerlos | No detectar a uno que se va | Recall de la clase 0 |
| Detectar fraude | Dejar pasar un fraude | Recall del fraude |
| Marcar mails como spam | Mandar a spam uno importante | Precision del spam |

Se mueve cambiando el **umbral**: en vez de "vuelve si la probabilidad es ≥
0,5", usar 0,3 o 0,7. Sube una y baja la otra.

## Métricas de regresión

- **MAE**: el error promedio, en las unidades de la respuesta (~1.617 pesos).
- **RMSE**: parecido, pero castiga más los errores grandes.
- **R²**: qué parte de la variación explica (0,983).

Detalle en la [teoría 3](03-regresion.md).

## Sobreajuste y subajuste

El árbol de la [guía 4](../04-modelos-sklearn.md), con distintas
profundidades:

| `max_depth` | Entrenamiento | Prueba | Hojas | |
|---|---:|---:|---:|---|
| 1 | 0,753 | 0,761 | 2 | Subajuste |
| 2 | 0,876 | 0,885 | 4 | Subajuste |
| 3 | 0,898 | 0,909 | 8 | Justo |
| 5 | 0,899 | 0,907 | 30 | Bien, más complicado sin ganar nada |
| 10 | 0,905 | 0,900 | 225 | Empieza a aprender ruido |
| sin límite | 1,000 | 0,815 | 2630 | Sobreajuste |

- **Subajuste** (*underfitting*): el modelo es demasiado simple para la
  regla. Le va mal en entrenamiento **y** en prueba. Con una pregunta sola no
  se puede expresar "(visitas ≥ 4 y reclamos ≤ 1) o antigüedad ≥ 36".
- **Sobreajuste** (*overfitting*): el modelo es tan flexible que se aprende
  los datos de entrenamiento, ruido incluido. Le va perfecto en entrenamiento
  y peor en prueba. Sin límite, el árbol armó 2.630 hojas para memorizar a cada
  cliente, incluidos los del 10 % dado vuelta: aprendió excepciones que no se
  repiten.

La señal es la **distancia** entre entrenamiento y prueba. Y el techo ayuda:
un 100 % en entrenamiento, cuando el ruido es del 10 %, es imposible sin
memorizar.

Defensas: limitar la complejidad (profundidad, cantidad de neuronas),
`early_stopping` en las redes, más datos y elegir con validación cruzada.

## Validación cruzada

Una sola separación puede salir con suerte o con mala suerte. La
**validación cruzada** con *k* partes (*k-fold*):

1. Parte los datos en *k* partes iguales.
2. Entrena *k* veces: cada vez deja una parte afuera, entrena con el resto y
   mide con la que dejó.
3. Promedia las *k* medidas.

Cada fila se usa para probar exactamente una vez. Además del promedio da el
**desvío**: si es chico, el resultado es estable. En `modelos_sklearn.py`,
`cross_val_score(modelo, X, y, cv=5)`:

| Modelo | Aciertos en prueba | Validación cruzada (5 partes) |
|---|---:|---:|
| Árbol | 90,9 % | 90,0 % ± 0,2 |
| Logística | 81,7 % | 81,0 % ± 0,5 |
| Red | 90,6 % | 89,8 % ± 0,1 |

Coinciden con la prueba, con desvíos chicos: los resultados son confiables.

### Para elegir hiperparámetros

El uso más importante: **elegir** sin tocar la prueba. `modelos_spark.py`
muestra la herramienta con `CrossValidator`: prueba profundidades 2, 3 y 5
(`ParamGridBuilder`) con 3 partes cada una, 9 entrenamientos, y se queda con
la de mejor promedio. Tiene que elegir 3 o más. El script la corre sobre
**todos** los clientes, porque solo informa la profundidad elegida y su
promedio; en un trabajo real se corre sobre el entrenamiento y el elegido se
mide al final con la prueba (es un ejercicio de la
[evaluación 9](../evaluacion/09-ml-distribuido-mllib.md)). En scikit-learn lo
mismo es `GridSearchCV`.

El costo: entrena *k* veces por cada combinación. Con una grilla grande y
datos grandes, es mucho; ahí ayuda repartir el trabajo en un cluster.

## El orden correcto

1. Separar la prueba y no tocarla.
2. Con el resto, comparar modelos y elegir hiperparámetros por validación
   cruzada.
3. Entrenar el elegido con todo el resto.
4. Medir **una vez** con la prueba. Ese es el número que se informa.

## Para repasar

- Se mide con datos que el modelo no vio; nada de la prueba influye en el
  entrenamiento.
- Aciertos engaña con clases desparejas: matriz de confusión, precision y
  recall, y siempre comparar con el tonto.
- Sobreajuste: perfecto en entrenamiento, peor en prueba. Subajuste: mal en
  los dos.
- Validación cruzada: k entrenamientos, promedio y desvío; sirve para elegir
  hiperparámetros.

[← 6. Redes neuronales básicas](06-redes-neuronales.md) · [Índice de teoría](README.md) · Siguiente: [8. pandas contra Spark →](08-pandas-vs-spark.md)
