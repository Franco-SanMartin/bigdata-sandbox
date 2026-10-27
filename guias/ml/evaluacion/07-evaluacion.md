# Evaluación 7. Evaluación de modelos

[← 6. Redes neuronales](06-redes-neuronales.md) · [Índice de evaluación](README.md) · Teoría: [7. Evaluación](../teoria/07-evaluacion.md) · Siguiente: [8. pandas contra Spark →](08-pandas-vs-spark.md)

## Multiple choice

**1.** ¿Por qué no se mide un modelo con los mismos datos con los que se
entrenó?

- a) Porque tarda más.
- b) Porque un modelo que memorizó los datos sacaría un resultado perfecto
  sin servir para casos nuevos.
- c) Porque scikit-learn no lo permite.
- d) Porque los datos de entrenamiento se borran al entrenar.

<details><summary>Respuesta</summary>

**b)**. Lo que importa es cómo le va con datos que no vio. El árbol sin
límite acierta 100 % en entrenamiento y 81,5 % en prueba.

- a) No: el tiempo no es el problema.
- c) No: lo permite (`modelo.score(X_ent, y_ent)`), solo que no sirve.
- d) No: los datos siguen ahí.

</details>

**2.** En la matriz de confusión del árbol, 223 clientes no volvieron pero el
modelo dijo que sí. ¿Cómo se llaman?

- a) Verdaderos positivos.
- b) Falsos negativos.
- c) Falsos positivos.
- d) Verdaderos negativos.

<details><summary>Respuesta</summary>

**c)**. Tomando "vuelve" como la clase positiva: el modelo dijo positivo y
era negativo.

- a) No: esos son los 2.152 que volvieron y el modelo acertó.
- b) No: esos son los 140 que volvieron y el modelo dijo que no.
- d) No: esos son los 1.485 que no volvieron y el modelo acertó.

</details>

**3.** Con la matriz `[[1485, 223], [140, 2152]]` (filas = real, columnas =
predicho), ¿cuál es el recall de la clase "vuelve"?

- a) 2152 / (2152 + 223) = 0,906.
- b) 2152 / (2152 + 140) = 0,939.
- c) (1485 + 2152) / 4000 = 0,909.
- d) 1485 / (1485 + 223) = 0,869.

<details><summary>Respuesta</summary>

**b)**. Recall: de los que **volvieron**, cuántos encontró.

- a) No: es la precision (de los que dijo que vuelven, cuántos volvieron).
- c) No: son los aciertos totales (accuracy).
- d) No: es el recall de la clase "no vuelve".

</details>

**4.** Un banco usa un modelo para detectar fraude: 1 de cada 1.000
transacciones es fraude. El modelo dice siempre "no es fraude". ¿Qué pasa?

- a) Acierta el 99,9 % y es un buen modelo.
- b) Acierta el 99,9 %, pero su recall del fraude es 0: no sirve.
- c) Acierta el 0,1 %.
- d) No se puede calcular nada.

<details><summary>Respuesta</summary>

**b)**. Con clases muy desparejas, los aciertos engañan: hay que mirar la
matriz de confusión y el recall de la clase que importa.

- a) No: no detecta ni un fraude.
- c) No: acierta todas las transacciones normales.
- d) No: se calculan todas las métricas; lo que dicen es que no sirve.

</details>

**5.** Una validación cruzada de 5 partes da 90,0 % ± 0,2 para el árbol. ¿Qué
dice el ± 0,2?

- a) Que el modelo se equivoca un 0,2 %.
- b) Que el resultado es estable: las 5 medidas dieron muy parecido.
- c) Que hay que sumarle 0,2 a los aciertos.
- d) Que el 0,2 % de los datos quedó afuera.

<details><summary>Respuesta</summary>

**b)**. Es el desvío entre las 5 medidas. Chico: no dependió de la suerte
de la separación.

- a) No: el error es el 10 % restante.
- c) No: es una dispersión, no una corrección.
- d) No: en la validación cruzada cada fila se usa para probar una vez.

</details>

**6.** Para elegir la profundidad de un árbol se usa validación cruzada
(`CrossValidator` en Spark, `GridSearchCV` en scikit-learn). ¿Por qué no se
elige mirando los aciertos en la prueba?

- a) Porque Spark no puede medir la prueba.
- b) Porque si se usa la prueba para elegir, ya no es un dato que el modelo
  "no vio": la medida final quedaría optimista.
- c) Porque la validación cruzada es más rápida.
- d) Da lo mismo una cosa que la otra.

<details><summary>Respuesta</summary>

**b)**. La prueba se usa una vez, al final. Para elegir, la validación
cruzada sobre el entrenamiento.

- a) No: la mide, con un Evaluator.
- c) No: es más lenta (entrena varias veces cada opción).
- d) No: elegir con la prueba es filtrar información.

</details>

**7.** Al cambiar el umbral del árbol de 0,5 a 0,3 o a 0,7, la matriz de
confusión **no cambia**. ¿Por qué?

- a) Porque los árboles no tienen umbral.
- b) Porque las hojas del árbol de profundidad 3 dan probabilidades bajas
  (0,05 a 0,11) o altas (0,77 a 0,96): entre 0,3 y 0,7 no cae ninguna, y
  ninguna predicción se da vuelta.
- c) Porque `predict_proba` no funciona en árboles.
- d) Porque el árbol está sobreajustado.

<details><summary>Respuesta</summary>

**b)**. La probabilidad de un árbol es la proporción de cada clase en la
hoja. Con hojas casi puras (alrededor de 90/10, por el ruido), mover el
umbral en el medio no cambia nada; recién con 0,95 casi todo pasa a "no
vuelve" (solo una hoja, con 0,958, queda arriba).

- a) No: `predict` usa 0,5 sobre `predict_proba`.
- c) No: funciona; da las proporciones de la hoja.
- d) No: con profundidad 3 está justo, no sobreajustado.

</details>

## Preguntas de desarrollo

**1.** Explicá la diferencia entre sobreajuste y subajuste usando la tabla
de profundidades del árbol, y cómo se reconoce cada uno.

<details><summary>Respuesta modelo</summary>

Subajuste: el modelo es demasiado simple para la regla; le va mal en
entrenamiento y en prueba. Profundidad 1 (0,753 / 0,761): una sola pregunta
no expresa "(visitas y reclamos) o antigüedad". Sobreajuste: el modelo es tan
flexible que memoriza, ruido incluido; le va muy bien en entrenamiento y peor
en prueba. Sin límite (1,000 / 0,815, 2.630 hojas). Se reconoce por la
**distancia** entre entrenamiento y prueba, y por un entrenamiento por encima
del techo posible (100 % cuando hay 10 % de ruido). El punto justo es
profundidad 3 (0,898 / 0,909).

</details>

**2.** Describí el orden correcto para comparar varios modelos y reportar un
resultado final, y qué error se comete si se altera.

<details><summary>Respuesta modelo</summary>

1. Separar la prueba y no tocarla.
2. Con el resto, comparar modelos y elegir hiperparámetros por validación
   cruzada (incluyendo la preparación, como el escalador, adentro del
   pipeline).
3. Entrenar el elegido con todo el resto.
4. Medir una vez con la prueba e informar ese número.

Si se elige mirando la prueba, o se escala con todos los datos, la prueba
deja de ser "datos nuevos" y el resultado informado es más optimista que lo
que va a pasar en la realidad (fuga de información).

</details>

**3.** Una empresa usa el modelo de clientes para mandar un cupón de
descuento a los que **no** van a volver. ¿Qué métrica mirarías y cómo la
mejorarías?

<details><summary>Respuesta modelo</summary>

El error caro es no detectar a uno que se va (no le llega el cupón y se
pierde el cliente); mandar un cupón de más cuesta poco. Interesa el
**recall de la clase "no vuelve"** (0,869 con el árbol). Para subirlo se
cambia el umbral: marcar "no vuelve" con una probabilidad de volver más alta
que 0,5. Con la logística, que da probabilidades más graduadas, se puede
mover fino; con el árbol de profundidad 3 casi no, porque sus hojas dan
probabilidades de 0,11 o menos, o de 0,77 o más, sin nada en el medio.

</details>

## Ejercicios prácticos

### Ejercicio 1. La logística por dentro

Hecha la [guía 4](../04-modelos-sklearn.md). Para la regresión logística de
la guía (con escalador y la separación de siempre):

1. Sacá la matriz de confusión en la prueba.
2. Calculá la precision y el recall de "vuelve".
3. Repetí con umbrales 0,3 y 0,7 (usando `predict_proba`) y explicá qué pasa.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["vuelve"], test_size=0.2, random_state=42)
modelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(X_ent, y_ent)
print(confusion_matrix(y_prueba, modelo.predict(X_prueba)))
probabilidad = modelo.predict_proba(X_prueba)[:, 1]
for umbral in [0.3, 0.5, 0.7]:
    prediccion = (probabilidad >= umbral).astype(int)
    print(umbral, precision_score(y_prueba, prediccion), recall_score(y_prueba, prediccion),
          accuracy_score(y_prueba, prediccion))
```

Matriz con umbral 0,5:

| | Dijo 0 | Dijo 1 |
|---|---:|---:|
| **Real 0** | 1298 | 410 |
| **Real 1** | 323 | 1969 |

| Umbral | Precision de "vuelve" | Recall de "vuelve" | Aciertos |
|---|---:|---:|---:|
| 0,3 | 0,719 | 0,942 | 75,6 % |
| 0,5 | 0,828 | 0,859 | 81,7 % |
| 0,7 | 0,889 | 0,671 | 76,3 % |

Bajar el umbral hace que diga "vuelve" más fácil: encuentra más de los que
vuelven (recall sube) pero se equivoca más cuando lo dice (precision baja).
Subirlo hace lo contrario. Los aciertos totales son máximos cerca de 0,5,
pero según para qué se use, otro umbral puede convenir más.

</details>

| Criterio | Puntos |
|---|---:|
| Matriz de confusión correcta, sabiendo qué es cada casillero | 3 |
| Precision y recall de "vuelve" con umbral 0,5 | 2 |
| Umbrales con `predict_proba` y no con `predict` | 2 |
| Explica el intercambio entre precision y recall | 3 |

### Ejercicio 2. Elegir la profundidad con validación cruzada

Hecha la guía 4. Con `GridSearchCV`, elegí la profundidad del árbol entre 2,
3, 5 y 10, con validación cruzada de 5 partes **solo sobre el
entrenamiento**. Mostrá el promedio de cada profundidad, la elegida y los
aciertos del elegido en la prueba.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.model_selection import GridSearchCV, train_test_split
from sklearn.tree import DecisionTreeClassifier

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["vuelve"], test_size=0.2, random_state=42)
busqueda = GridSearchCV(DecisionTreeClassifier(random_state=42), {"max_depth": [2, 3, 5, 10]}, cv=5)
busqueda.fit(X_ent, y_ent)
print(busqueda.cv_results_["mean_test_score"])
print(busqueda.best_params_, busqueda.score(X_prueba, y_prueba))
```

| `max_depth` | Promedio de la validación cruzada |
|---|---:|
| 2 | 0,876 |
| 3 | **0,898** |
| 5 | 0,897 |
| 10 | 0,886 |

Elige 3, y en la prueba acierta 0,909. Es lo mismo que hace `CrossValidator`
en `modelos_spark.py` (con 2, 3 y 5 y 3 partes), salvo que el script la corre
sobre todos los clientes y no mide el elegido en una prueba aparte. `GridSearchCV`, después de
elegir, vuelve a entrenar con todo el entrenamiento (`refit`), y por eso
`busqueda.score` usa el modelo final.

</details>

| Criterio | Puntos |
|---|---:|
| `GridSearchCV` sobre el entrenamiento, no sobre todo | 3 |
| Muestra los 4 promedios y elige 3 | 3 |
| Mide una sola vez en la prueba | 2 |
| Relaciona con `CrossValidator` de Spark | 2 |

[← 6. Redes neuronales](06-redes-neuronales.md) · [Índice de evaluación](README.md) · Teoría: [7. Evaluación](../teoria/07-evaluacion.md) · Siguiente: [8. pandas contra Spark →](08-pandas-vs-spark.md)
