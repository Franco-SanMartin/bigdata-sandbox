# Evaluación 4. Clasificación: regresión logística y árboles

[← 3. Regresión lineal](03-regresion.md) · [Índice de evaluación](README.md) · Teoría: [4. Clasificación](../teoria/04-clasificacion.md) · Siguiente: [5. Clustering →](05-clustering.md)

## Multiple choice

**1.** El `DummyClassifier(strategy="most_frequent")` acierta el 57,3 % de los
clientes de prueba. ¿Para qué se lo entrena?

- a) Para usarlo en producción cuando los otros fallan.
- b) Como vara: es lo que se acierta sin mirar ninguna columna; un modelo
  tiene que ganarle para valer algo.
- c) Para calcular las probabilidades de los otros modelos.
- d) Porque scikit-learn lo exige antes de entrenar otros modelos.

<details><summary>Respuesta</summary>

**b)**. Siempre dice lo más común ("vuelve"). Un 57 % de aciertos suena a
algo, pero sale solo de contar.

- a) No: no sirve para nada en la práctica, no distingue clientes.
- c) No: cada modelo calcula sus probabilidades.
- d) No: no es obligatorio; es una buena práctica.

</details>

**2.** La regresión logística queda en 81,7 % y el árbol llega a 90,9 %. ¿Por
qué?

- a) Porque la logística necesita más datos.
- b) Porque la frontera de la logística es una recta (un plano), y la zona de
  "vuelve" tiene forma de L: un "o" de dos condiciones.
- c) Porque la logística no se escaló.
- d) Porque el árbol hace trampa mirando la respuesta.

<details><summary>Respuesta</summary>

**b)**. La regla es "(visitas ≥ 4 y reclamos ≤ 1) o antigüedad ≥ 36". Una
sola recta no separa una L; un árbol la arma con preguntas.

- a) No: con 16.000 clientes le sobran datos; el límite es la forma de la
  frontera.
- c) No: en la imagen va en un pipeline con `StandardScaler`.
- d) No: el árbol solo ve las mismas cinco entradas.

</details>

**3.** ¿Qué significa `antiguedad_meses <= 35.50` en el árbol de la guía 4?

- a) Que el árbol redondeó mal.
- b) Es lo mismo que "antigüedad < 36": el árbol corta en el medio entre dos
  valores que existen en los datos (35 y 36).
- c) Que los clientes con 35,5 meses no se clasifican.
- d) Que encontró una regla distinta a la real.

<details><summary>Respuesta</summary>

**b)**. Como las antigüedades son enteras, cualquier corte entre 35 y 36
separa igual; scikit-learn usa el punto medio.

- a) No: es intencional.
- c) No: no hay clientes con 35,5; y si hubiera, irían a la izquierda.
- d) No: es la regla real (antigüedad ≥ 36).

</details>

**4.** ¿Cómo elige un árbol de decisión cada pregunta?

- a) Al azar, y después se queda con la que mejor anda.
- b) Prueba todas las columnas y todos los cortes, y se queda con el que deja
  los dos grupos más puros (Gini o entropía).
- c) Usa la columna con el número más grande.
- d) Pregunta por las columnas en el orden en que están en la tabla.

<details><summary>Respuesta</summary>

**b)**. Es un algoritmo goloso: el mejor corte de ese paso, sin mirar
adelante.

- a) No: el árbol de scikit-learn no sortea cortes (el `random_state` solo
  desempata).
- c) No: el tamaño de los números no importa, por eso no hace falta escalar.
- d) No: el orden de las columnas no importa; empezó por antigüedad, que es
  la primera, pero porque es la que más separa.

</details>

**5.** Las importancias del árbol dan antigüedad 0,477, visitas 0,423,
reclamos 0,100, ticket 0,001 y edad 0,000. ¿Qué **no** se puede concluir?

- a) Que el árbol casi no usó el ticket ni la edad.
- b) Que antigüedad y visitas son las que más separan a los que vuelven.
- c) Que bajar los reclamos **causaría** que los clientes vuelvan más.
- d) Que las importancias suman 1.

<details><summary>Respuesta</summary>

**c)**. La importancia dice cuánto ayudó cada columna a separar en **estos
datos**, no qué pasaría si se cambia algo en el mundo (eso es causalidad).

- a) Sí se puede: importancia casi 0.
- b) Sí se puede: es lo que mide.
- d) Sí: scikit-learn las normaliza para que sumen 1.

</details>

**6.** Si se entrena la regresión logística **sin** `StandardScaler`, acierta
el 76 % y avisa que no terminó de converger. ¿Por qué?

- a) Porque la logística no funciona con números grandes.
- b) Porque el ticket vale miles y los reclamos de 0 a 5: los pasos del
  entrenamiento quedan desparejos y en las iteraciones que tiene no llega a
  los mejores pesos.
- c) Porque sin escalar se pierden filas.
- d) Porque el escalador agrega columnas nuevas.

<details><summary>Respuesta</summary>

**b)**. La logística se entrena por pasos (iteraciones); con columnas en
escalas muy distintas, avanza mal. Escalada llega a 81,7 %.

- a) No: funciona, pero se entrena peor.
- c) No: no se pierde ninguna fila.
- d) No: `StandardScaler` transforma las mismas columnas, no agrega.

</details>

**7.** Un árbol sin límite de profundidad acierta 100 % en entrenamiento y
81,5 % en prueba. ¿Cómo se llama eso?

- a) Subajuste.
- b) Sobreajuste: aprendió el ruido de los datos de entrenamiento.
- c) Validación cruzada.
- d) Regularización.

<details><summary>Respuesta</summary>

**b)**. 2.630 hojas para memorizar cada cliente, incluidos los del 10 % dado
vuelta.

- a) No: subajuste es ir mal en las dos.
- c) No: es una forma de medir.
- d) No: regularizar es lo que lo **evita** (limitar la profundidad, por
  ejemplo).

</details>

## Preguntas de desarrollo

**1.** Compará la regresión logística y el árbol de decisión: cómo deciden,
qué frontera pueden armar, si necesitan escalar y cuándo usarías cada uno.

<details><summary>Respuesta modelo</summary>

| | Logística | Árbol |
|---|---|---|
| Cómo decide | Suma con pesos → sigmoide → probabilidad; ≥ 0,5 es 1 | Preguntas de sí/no, una columna por vez, hasta una hoja |
| Frontera | Una recta (un plano) | Escalones paralelos a los ejes; arma "y" y "o" |
| Escalar | Sí | No |
| Se explica | Por los pesos | Por las preguntas |
| Riesgo | Subajuste si la regla no es lineal | Sobreajuste si no se limita |

La logística cuando hacen falta probabilidades bien calibradas y una
relación más o menos lineal (crédito, medicina). El árbol cuando la regla
tiene condiciones combinadas y se quiere leer (o, mejor, conjuntos de árboles
cuando se quiere el máximo de aciertos).

</details>

**2.** Con los clientes nuevos de la guía 4, el de 40 meses y 1 visita: el
árbol le da 0,9 de probabilidad de volver y la logística 0,56. Explicá la
diferencia usando la regla real.

<details><summary>Respuesta modelo</summary>

Según la regla, con 36 meses o más vuelve, sin importar las visitas. El
árbol aprendió exactamente eso: la primera pregunta es la antigüedad, y en la
rama de más de 35,5 meses todas las hojas dicen 1, y a este cliente le toca
una con 0,9 de probabilidad (el techo, por el 10 % de ruido). La logística suma: la antigüedad alta suma
mucho, pero 1 visita resta (su peso para visitas es positivo, y 1 está muy
abajo del promedio). No puede expresar "con antigüedad alta, las visitas no
importan", porque su frontera es una recta. Termina apenas arriba de 0,5.

</details>

## Ejercicios prácticos

### Ejercicio 1. Ayudar a la logística

Hecha la [guía 4](../04-modelos-sklearn.md). La logística no puede armar una
L, pero se le puede dar una mano: agregá a las entradas dos columnas nuevas,
`fiel` = (visitas ≥ 4 y reclamos ≤ 1) y `antiguo` = (antigüedad ≥ 36), como
0 y 1. Entrená la misma logística con escalador y la misma separación, y
medí los aciertos en la prueba. Explicá el resultado y por qué en la vida
real esto es más difícil.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X = clientes[ENTRADAS].copy()
X["fiel"] = ((X["visitas_mes"] >= 4) & (X["reclamos"] <= 1)).astype(int)
X["antiguo"] = (X["antiguedad_meses"] >= 36).astype(int)
X_ent, X_prueba, y_ent, y_prueba = train_test_split(X, clientes["vuelve"], test_size=0.2, random_state=42)
modelo = make_pipeline(StandardScaler(), LogisticRegression()).fit(X_ent, y_ent)
print(accuracy_score(y_prueba, modelo.predict(X_prueba)))
```

Da 0,909: lo mismo que el árbol, el techo. Con esas dos columnas, la regla
se vuelve "vuelve si `fiel` o `antiguo`", que sí es casi lineal en las
columnas nuevas. Esto se llama **ingeniería de variables** (*feature
engineering*): transformar las entradas para que el modelo pueda usarlas.

En la vida real no se conoce la regla: hay que adivinar qué combinaciones
sirven (con conocimiento del negocio, mirando los datos, o mirando qué
preguntas encontró un árbol). Acá se puede porque los datos se generaron con
una regla conocida.

</details>

| Criterio | Puntos |
|---|---:|
| Arma bien las dos columnas (con `&` y paréntesis, como 0/1) | 3 |
| Misma separación y pipeline con escalador | 2 |
| Llega a ~90,9 % | 2 |
| Explica por qué mejora y que en la vida real la regla no se conoce | 3 |

### Ejercicio 2. Árboles distintos

Hecha la guía 4. Con la separación de siempre, entrená tres árboles de
profundidad 3 y medí los aciertos en la prueba:

1. Con `criterion="entropy"` en vez de Gini.
2. Con Gini, pero usando solo `antiguedad_meses` y `visitas_mes`.
3. Con Gini y `max_depth=4`.

Explicá cada resultado.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["vuelve"], test_size=0.2, random_state=42)
pruebas = {
    "entropia": (ENTRADAS, DecisionTreeClassifier(max_depth=3, criterion="entropy", random_state=42)),
    "dos columnas": (["antiguedad_meses", "visitas_mes"], DecisionTreeClassifier(max_depth=3, random_state=42)),
    "profundidad 4": (ENTRADAS, DecisionTreeClassifier(max_depth=4, random_state=42)),
}
for nombre, (columnas, arbol) in pruebas.items():
    arbol.fit(X_ent[columnas], y_ent)
    print(nombre, accuracy_score(y_prueba, arbol.predict(X_prueba[columnas])))
```

| Árbol | Aciertos en prueba | Por qué |
|---|---:|---|
| Entropía | 90,9 % | Gini y entropía miden la pureza parecido; con una regla tan clara, eligen los mismos cortes |
| Solo antigüedad y visitas | 88,5 % | Le falta `reclamos`: no puede expresar "y reclamos ≤ 1", y se equivoca con los clientes con 4 visitas o más y 2 reclamos o más |
| Profundidad 4 | 90,85 % | Ya estaba en el techo: la pregunta extra no ayuda y empieza a cortar ruido |

</details>

| Criterio | Puntos |
|---|---:|
| Los tres árboles con la misma separación | 3 |
| Números correctos | 3 |
| Explica que faltan los reclamos en el 2 | 2 |
| Explica que en el 1 y el 3 no hay nada más que ganar (techo) | 2 |

[← 3. Regresión lineal](03-regresion.md) · [Índice de evaluación](README.md) · Teoría: [4. Clasificación](../teoria/04-clasificacion.md) · Siguiente: [5. Clustering →](05-clustering.md)
