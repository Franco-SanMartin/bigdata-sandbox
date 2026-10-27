# 6. Redes neuronales básicas: el perceptrón multicapa

[← 5. Clustering con k-means](05-clustering.md) · [Índice de teoría](README.md) · Siguiente: [7. Evaluación →](07-evaluacion.md)

## La neurona

Una **neurona** artificial hace lo mismo que la regresión logística:

1. Una suma con pesos de sus entradas, más una constante (el *sesgo*):
   `z = b + w1 × x1 + w2 × x2 + ...`
2. Pasa `z` por una **función de activación**, que la "dobla".

Una sola neurona con activación sigmoide **es** una regresión logística: su
frontera es una recta, y por eso no puede con la regla con forma de L de los
clientes ([teoría 4](04-clasificacion.md)).

## La red: capas de neuronas

Un **perceptrón multicapa** (MLP, *multilayer perceptron*) pone neuronas en
capas: las salidas de una capa son las entradas de la siguiente.

    entrada (5 columnas) → capa oculta (16 neuronas) → capa oculta (8) → salida

Es la red de los ejemplos: `MLPClassifier(hidden_layer_sizes=(16, 8))` en
scikit-learn y `layers=[5, 16, 8, 2]` en Spark (que cuenta también la
entrada y la salida: 5 columnas, 2 clases).

- **Capas ocultas**: las del medio. Cada neurona de la primera mira las 5
  columnas; cada una de la segunda mira las 16 salidas de la primera.
- **Pesos**: cada flecha entre neuronas es un peso, y cada neurona tiene su
  sesgo. En la red de scikit-learn: 5 × 16 + 16 = 96 en la primera capa, 16 ×
  8 + 8 = 136 en la segunda y 8 + 1 = 9 en la salida (una neurona, la
  probabilidad de que vuelva): 241 números que aprender. Una regresión
  logística aprende 6.
- **Activación**: sin ella, una capa de sumas sobre otra capa de sumas sigue
  siendo una suma: toda la red sería una recta. La activación es lo que
  permite **doblar** la frontera. scikit-learn usa por defecto **ReLU** (deja
  pasar los positivos, pone 0 a los negativos); el perceptrón de Spark usa
  la sigmoide en las capas ocultas.

Con suficientes neuronas, una red puede aproximar casi cualquier frontera, la
L de la regla incluida. Por eso llega al techo: 90,6 % de aciertos.

## Cómo aprende

Empieza con pesos al azar (por eso `random_state=42`: siempre el mismo
comienzo) y repite:

1. **Hacia adelante**: con los pesos actuales, calcula la predicción de un
   grupo de clientes.
2. Mide el **error** (la *pérdida*: qué tan lejos quedó la probabilidad de la
   respuesta real).
3. **Hacia atrás** (*backpropagation*): calcula cuánto contribuyó cada peso
   al error.
4. Mueve cada peso un poquito en la dirección que baja el error (**descenso
   por gradiente**; scikit-learn usa una variante llamada Adam, Spark otra,
   L-BFGS).

Cada pasada por todos los datos es una **época**. `max_iter=500` es el tope
de épocas en scikit-learn (200 iteraciones en Spark, `maxIter=200`).

### early_stopping

Con muchos pesos y muchas épocas, la red puede terminar aprendiéndose el
ruido. `early_stopping=True` aparta una parte de los datos de entrenamiento
(el 10 %, por defecto) y, en cada época, mira cómo le va ahí. Cuando deja de
mejorar por varias épocas seguidas, para. Es una defensa contra el
sobreajuste ([teoría 7](07-evaluacion.md)).

### Escalar

Las redes se entrenan de a pasitos con gradientes: si una columna vale miles
(el ticket) y otra de 0 a 5 (los reclamos), los pasos quedan desparejos y
aprende mal o lento. Por eso en los dos scripts va en un pipeline con
`StandardScaler`.

## Árbol o red

En estos datos, la red acierta lo mismo que un árbol de 3 preguntas:

| | Árbol (profundidad 3) | Red (16, 8) |
|---|---|---|
| Aciertos en prueba | 90,9 % | 90,6 % |
| Entrenar (scikit-learn, lo que mide el script con `perf_counter`) | ~17 ms | ~7.700 ms |
| Qué aprendió | 3 preguntas que se leen | 241 números que no se leen |
| Necesita escalar | No | Sí |

Para una regla simple sobre una tabla, una red es demasiado: más lenta, más
difícil de ajustar y de explicar, sin ganar nada. Las redes brillan donde los
modelos clásicos no llegan: **imágenes, sonido, texto**, con muchísimos datos
y redes mucho más grandes (lo que se llama *deep learning*, aprendizaje
profundo). Para eso se usan otras librerías (PyTorch, TensorFlow) y placas de
video, que esta imagen no trae: el MLP de scikit-learn y de Spark es para
aprender cómo funciona.

Que el árbol se pueda leer no es un detalle: si un banco rechaza un crédito,
tiene que poder explicar por qué.

## Para repasar

- Una neurona = suma con pesos + activación; una sola es una logística.
- Un MLP apila capas; la activación permite fronteras curvas, y por eso
  puede con la regla en L.
- Aprende con backpropagation y descenso por gradiente, época por época;
  `early_stopping` corta cuando deja de mejorar.
- Hay que escalar. En tablas simples, un árbol suele alcanzar y se explica.

[← 5. Clustering con k-means](05-clustering.md) · [Índice de teoría](README.md) · Siguiente: [7. Evaluación →](07-evaluacion.md)
