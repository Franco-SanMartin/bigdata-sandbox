# Interpretabilidad: mirar un modelo por dentro

Por qué algunos modelos se pueden leer y otros no, qué se aprende al
mirarlos y por qué eso importa tanto como la métrica. Es la teoría detrás
del dibujo 3D de [Machine Learning](../07-machine-learning.md) (paso 6, "el
modelo por dentro").

[← Teoría](README.md) · [Índice de full](../README.md)

## Acertar no alcanza

Un modelo con 90 % de aciertos puede estar bien o puede estar acertando por
la razón equivocada: usando una columna que no debería (un dato que se
filtra del futuro, una variable que discrimina), o aprendiendo una
casualidad de los datos de entrenamiento. La métrica dice **cuánto** acierta;
la interpretabilidad, **por qué**. Sin el porqué no se puede:

- **confiar**: saber que va a seguir andando con datos nuevos;
- **explicar**: decirle a un cliente por qué le negaron un crédito (en
  muchos países es obligatorio);
- **corregir**: encontrar el error cuando el modelo falla.

## Un dataset con la respuesta conocida

El sandbox usa `clientes_senal.csv`, un dataset **sintético con reglas
conocidas**. Se sabe exactamente cómo se calculó cada respuesta:

- `vuelve` = 1 si `antiguedad_meses` ≥ 36, o `visitas_mes` ≥ 4 y
  `reclamos` ≤ 1 (con un 10 % dado vuelta, para que haya ruido).
- `gasto_mes_siguiente` = 5000 + 1500·visitas + 0,8·ticket − 1500·reclamos
  + 50·antigüedad + ruido.
- `edad` no influye en nada.

Con datos reales nunca se sabe la regla. Acá sí, y por eso se puede comparar
**lo que aprendió el modelo** con **lo que tendría que haber aprendido**.

## Modelos que se leen y modelos que no

| Modelo | Qué aprende | ¿Se lee? | Qué se ve en el dibujo |
|---|---|---|---|
| Regresión lineal | Un número por columna (coeficiente) y una constante | Sí: cada coeficiente dice cuánto suma esa columna | El plano: "una constante más cada columna por su coeficiente" |
| Árbol de decisión | Preguntas de umbral, una por nodo | Sí: es una lista de reglas "si… entonces" | La fila baja respondiendo una pregunta por nodo hasta una hoja |
| Regresión logística | Coeficientes, como la lineal, pasados por una sigmoide | Más o menos: los coeficientes dicen hacia dónde empuja cada columna | La superficie de probabilidad |
| KMeans | La posición de k centros | Sí: cada centro es un "cliente típico" de su grupo | Los centros mudándose al promedio de sus puntos |
| Red neuronal (MLP) | Cientos de pesos entre neuronas | No: no hay una pregunta ni un coeficiente que signifique algo solo | El dato cruzando las capas, pulso por pulso |
| Clasificador tonto | Nada: la clase más común | Trivial | Una superficie plana |

En el árbol se puede comparar cada pregunta con la regla real: si el árbol
pregunta por antigüedad cerca de 36 y por visitas cerca de 4, aprendió la
regla. En la red no hay preguntas que leer, solo números: acierta casi lo
mismo que el árbol (90,6 % contra 90,9 % en la referencia de scikit-learn)
pero no se puede saber **por qué** sin herramientas extra.

![El árbol por dentro: la fila baja respondiendo una pregunta por nodo](../../../docs/capturas/ml-arbol.gif)

![La red por dentro: el dato cruza las capas y sale la probabilidad](../../../docs/capturas/ml-red.gif)

## Lo que el dibujo es y lo que no es

La interfaz rehace la cuenta del modelo con los pesos, umbrales o centros
que guardó el entrenamiento: lo que se ve para una fila es **exactamente** lo
que calcula el modelo, no una ilustración. Por eso se puede elegir una fila
real o **mover valores** a mano y ver cómo cambia la salida: es una forma de
preguntarle al modelo "¿y si…?" (lo que en la literatura se llama análisis
**contrafáctico**: qué habría que cambiar para que la predicción cambie).

Límites:

- Con más de 3 columnas, KMeans dibuja "las 3 direcciones principales (PCA);
  el grupo se calcula con todas": lo que se ve es una **proyección**, y dos
  puntos que parecen cerca pueden no estarlo.
- En una red grande se ve la forma sin las conexiones: hay demasiados pesos
  para mandarlos.
- Ver la cuenta de una fila explica **esa** predicción (una explicación
  *local*), no el modelo entero (*global*).

## La línea base y las columnas trampa

Dos controles que se hacen siempre, con o sin dibujo:

- **Contra la línea base.** El clasificador tonto acierta 57,3 % sin mirar
  ninguna columna (contesta siempre la clase más común). Un modelo con 60 %
  casi no aprendió nada, aunque "60 %" suene bien.
- **Las columnas que no deberían importar.** `edad` está de trampa: un buen
  modelo le da poco peso. En la regresión lineal se ve en su coeficiente; en
  el árbol, en que no aparece en ninguna pregunta. Si un modelo se apoya en
  `edad`, está aprendiendo ruido.

## Escalar: una lección que el dibujo hace visible

KMeans agrupa por **distancia**. Sin escalar, `ticket_promedio` (miles) tapa
a `visitas_mes` (unidades): los grupos se arman casi solo por ticket. La
pantalla muestra `rand sin escalar` al lado de `rand ajustado` para que se
vea la diferencia: es la prueba en números de por qué hay que escalar.

![KMeans por dentro: los centros se mudan al promedio de sus puntos](../../../docs/capturas/ml-kmeans.gif)

## Interpretable o preciso

No siempre hay que elegir, pero a veces sí. Con datos de tabla y reglas de
umbral, un árbol chico suele ser tan preciso como una red y además se lee:
conviene el árbol. Cuando el problema es de imágenes, audio o texto, los
modelos que mejor andan (redes profundas) no se leen, y se recurre a
**explicaciones a posteriori**:

| Técnica | Qué hace |
|---|---|
| Importancia de variables | Cuánto empeora el modelo si se mezcla al azar una columna |
| **SHAP** | Reparte la predicción de una fila entre las columnas (cuánto aportó cada una) |
| **LIME** | Ajusta un modelo simple alrededor de una fila para explicar esa predicción |
| Dependencia parcial | Cómo cambia la predicción al mover una columna, con las otras fijas |

## En la industria

La interpretabilidad es obligatoria en crédito, seguros y salud, y está en
las regulaciones (el derecho a una explicación en el RGPD europeo, la Ley de
IA de la Unión Europea). Las plataformas la traen integrada: **SHAP** y
**LIME** como librerías, **SageMaker Clarify**, **Vertex Explainable AI**,
**Azure ML Responsible AI dashboard**, y **TensorBoard** para mirar cómo
aprende una red (la vista *cómo aprendió* de la pantalla, época por época,
es la misma idea).

## Para pensar

- Si el árbol con `max_depth` 1 acierta casi lo mismo que con 3, ¿qué dice
  eso de la regla?
- ¿Por qué no alcanza con la matriz de confusión para saber si el modelo
  aprendió la regla correcta?
- ¿Qué le dirías a alguien que quiere usar la red porque "es más moderna"?

Hay preguntas sobre esto en la
[evaluación de Machine Learning](../evaluacion/machine-learning.md).
