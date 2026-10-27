# Evaluación 6. Redes neuronales básicas

[← 5. Clustering](05-clustering.md) · [Índice de evaluación](README.md) · Teoría: [6. Redes neuronales](../teoria/06-redes-neuronales.md) · Siguiente: [7. Evaluación de modelos →](07-evaluacion.md)

## Multiple choice

**1.** Una sola neurona con activación sigmoide es equivalente a:

- a) Un árbol de decisión de profundidad 1.
- b) Una regresión logística.
- c) KMeans con k = 2.
- d) Una regresión lineal sin constante.

<details><summary>Respuesta</summary>

**b)**. Suma con pesos más una constante, pasada por la sigmoide: es la
fórmula de la logística. Por eso, sola, tampoco puede con la regla en L.

- a) No: un árbol hace una pregunta sobre **una** columna; la neurona suma
  todas.
- c) No: KMeans no es supervisado ni tiene pesos.
- d) No: le falta la sigmoide, y tiene constante (el sesgo).

</details>

**2.** ¿Para qué sirve la función de activación entre capas?

- a) Para que la red entrene más rápido.
- b) Para que la red pueda armar fronteras curvas: sin ella, capas de sumas
  sobre sumas siguen siendo una suma (una recta).
- c) Para escalar los datos.
- d) Para evitar el sobreajuste.

<details><summary>Respuesta</summary>

**b)**. La activación "dobla" la salida de cada neurona; apiladas, las
neuronas pueden aproximar fronteras complicadas, como la L de la regla.

- a) No: no es su función.
- c) No: el escalado se hace antes, con `StandardScaler`.
- d) No: contra el sobreajuste están `early_stopping` y limitar el tamaño.

</details>

**3.** La red de scikit-learn es `MLPClassifier(hidden_layer_sizes=(16, 8))`
con 5 entradas. ¿Cuántos números aprende?

- a) 24 (16 + 8).
- b) 29.
- c) 241.
- d) 5.

<details><summary>Respuesta</summary>

**c)**. Pesos más sesgos de cada capa: 5 × 16 + 16 = 96; 16 × 8 + 8 = 136; 8 ×
1 + 1 = 9 (una neurona de salida). Total 241.

- a) No: eso son neuronas, no parámetros.
- b) No: 29 es la red de una capa de 4 neuronas (ejercicio 1).
- d) No: 5 son las entradas.

</details>

**4.** En Spark, la misma red se escribe `layers=[5, 16, 8, 2]`. ¿Por qué hay
un 5 y un 2?

- a) Porque Spark agrega dos capas ocultas más.
- b) Porque Spark cuenta también la capa de entrada (5 columnas) y la de
  salida (2 clases).
- c) Porque son los hiperparámetros de la tasa de aprendizaje.
- d) Es un error de los ejemplos.

<details><summary>Respuesta</summary>

**b)**. scikit-learn pide solo las capas ocultas; Spark, todas.

- a) No: las ocultas son las mismas, 16 y 8.
- c) No: son tamaños de capas.
- d) No: es la convención de `MultilayerPerceptronClassifier`.

</details>

**5.** ¿Qué hace `early_stopping=True`?

- a) Corta el entrenamiento a los 10 segundos.
- b) Aparta una parte del entrenamiento (10 %) y para cuando el resultado ahí
  deja de mejorar varias épocas seguidas.
- c) Usa los datos de prueba para decidir cuándo parar.
- d) Saca las neuronas que no sirven.

<details><summary>Respuesta</summary>

**b)**. Es una defensa contra el sobreajuste: la red no sigue aprendiéndose
el ruido.

- a) No: no mira el tiempo.
- c) No: la prueba no se toca; aparta una parte **del entrenamiento**.
- d) No: no cambia la forma de la red.

</details>

**6.** Con los clientes, la red acierta 90,6 % y el árbol 90,9 %. ¿Cuál
conviene usar?

- a) La red, porque es más moderna.
- b) El árbol: acierta lo mismo, entrena en ~17 ms contra ~7,7 s, no necesita
  escalar y se puede leer.
- c) La red, porque tiene más parámetros.
- d) Da igual: son el mismo modelo.

<details><summary>Respuesta</summary>

**b)**. Para una regla simple sobre una tabla, la red es más cara y más
difícil de explicar sin ganar nada.

- a) No: lo moderno no es un criterio.
- c) No: más parámetros no es mejor; acá no se aprovechan.
- d) No: son modelos muy distintos que llegan al mismo techo.

</details>

**7.** ¿Dónde sí brillan las redes neuronales frente a los modelos clásicos?

- a) En tablas chicas con reglas simples.
- b) En imágenes, sonido y texto, con muchísimos datos y redes mucho más
  grandes.
- c) Cuando hay que explicar cada decisión.
- d) Cuando no hay compu con placa de video.

<details><summary>Respuesta</summary>

**b)**. Es el *deep learning*, con librerías como PyTorch o TensorFlow y
placas de video, que esta imagen no trae.

- a) No: ahí un árbol o una logística suelen alcanzar.
- c) No: una red es difícil de explicar.
- d) No: al revés, las grandes necesitan placa de video.

</details>

## Preguntas de desarrollo

**1.** Explicá con tus palabras cómo aprende una red (hacia adelante, error,
hacia atrás, actualizar) y qué es una época.

<details><summary>Respuesta modelo</summary>

Arranca con pesos al azar (fijos con `random_state`). Para un grupo de
ejemplos: calcula la predicción con los pesos actuales (hacia adelante);
mide el error con la pérdida; calcula cuánto contribuyó cada peso a ese
error (*backpropagation*, hacia atrás); y mueve cada peso un poquito en la
dirección que baja el error (descenso por gradiente; Adam en scikit-learn,
L-BFGS en Spark). Una época es una pasada por todos los datos de
entrenamiento. Se repite hasta el tope de épocas (`max_iter`) o hasta que
`early_stopping` corta.

</details>

**2.** ¿Por qué la red va en un pipeline con `StandardScaler` y el árbol no?

<details><summary>Respuesta modelo</summary>

La red suma entradas multiplicadas por pesos y se entrena con pasos de
gradiente: si el ticket vale miles y los reclamos de 0 a 5, los gradientes
quedan desparejos y aprende mal o lento (el ejercicio 2 lo muestra: sin
escalar baja a ~74 %). El árbol compara una columna por vez contra un corte;
la escala no cambia qué corte separa mejor.

</details>

## Ejercicios prácticos

### Ejercicio 1. Una red más chica

Hecha la [guía 4](../04-modelos-sklearn.md). Entrená una red con **una**
capa oculta de 4 neuronas (`hidden_layer_sizes=(4,)`), el resto igual que la
de la guía (escalador, `max_iter=500`, `early_stopping=True`,
`random_state=42`) y la misma separación. Medí los aciertos en la prueba y
contá los parámetros a mano y con el modelo.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["vuelve"], test_size=0.2, random_state=42)
red = MLPClassifier(hidden_layer_sizes=(4,), max_iter=500, early_stopping=True, random_state=42)
modelo = make_pipeline(StandardScaler(), red).fit(X_ent, y_ent)
print(accuracy_score(y_prueba, modelo.predict(X_prueba)))
print(sum(w.size for w in red.coefs_) + sum(b.size for b in red.intercepts_))
```

- Parámetros a mano: 5 × 4 + 4 = 24 en la capa oculta, 4 × 1 + 1 = 5 en la
  salida: 29. El código da lo mismo.
- Aciertos: 86,9 %. Más que la logística (81,7 %), porque con 4 neuronas ya
  puede doblar la frontera; menos que el techo (90,6 % con la red de 241
  parámetros), porque 4 neuronas no alcanzan para armar bien la L.

</details>

| Criterio | Puntos |
|---|---:|
| Red con una capa de 4 y el resto igual | 2 |
| Cuenta los 29 parámetros a mano | 3 |
| Llega a ~87 % | 2 |
| Explica por qué queda entre la logística y la red grande | 3 |

### Ejercicio 2. La red sin escalar

Hecha la guía 4. Entrená la red de la guía (`(16, 8)`, mismos
hiperparámetros) **sin** el `StandardScaler` y medí los aciertos.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.neural_network import MLPClassifier

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["vuelve"], test_size=0.2, random_state=42)
red = MLPClassifier(hidden_layer_sizes=(16, 8), max_iter=500, early_stopping=True, random_state=42)
red.fit(X_ent, y_ent)
print(accuracy_score(y_prueba, red.predict(X_prueba)))
```

Da ~74 %: peor que la logística escalada, y 16 puntos menos que la misma red
escalada (90,6 %). El ticket (miles) domina las sumas de la primera capa y
los pasos de gradiente; `early_stopping` corta cuando ya no mejora, lejos
del techo. Mismo modelo, misma cantidad de parámetros: la diferencia es solo
la preparación.

</details>

| Criterio | Puntos |
|---|---:|
| Misma red, sin escalador | 2 |
| Llega a ~74 % | 3 |
| Explica el efecto de las escalas en el entrenamiento por gradiente | 3 |
| Compara con la red escalada y con la logística | 2 |

[← 5. Clustering](05-clustering.md) · [Índice de evaluación](README.md) · Teoría: [6. Redes neuronales](../teoria/06-redes-neuronales.md) · Siguiente: [7. Evaluación de modelos →](07-evaluacion.md)
