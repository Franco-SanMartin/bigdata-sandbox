# Evaluación: Machine Learning desde la interfaz

Sobre la [guía 7](../07-machine-learning.md) y la teoría de
[interpretabilidad](../teoria/interpretabilidad.md).

[← Evaluación](README.md) · [Índice de full](../README.md)

## Opción múltiple

### 1. Un modelo de clasificación acierta 60 % en `clientes_senal.csv`. ¿Qué tan bueno es?

- a) Bueno: acierta más de la mitad.
- b) Casi no aprendió nada: el clasificador tonto acierta 57,3 % sin mirar ninguna columna.
- c) Excelente para datos con ruido.
- d) No se puede saber sin la matriz de confusión.

<details><summary>Respuesta</summary>

**b).** La comparación es contra la **línea base**: contestar siempre la
clase más común ya da 57,3 %. Un 60 % le gana por muy poco.

- a) "Más de la mitad" no dice nada si las clases no están parejas.
- c) Con la regla conocida, el árbol llega a 90,9 %: hay mucho más para
  aprender.
- d) La matriz ayuda, pero la línea base ya alcanza para ver que es flojo.
</details>

### 2. Para predecir `vuelve`, ¿qué modelo recomienda la pantalla y por qué?

- a) Regresión lineal, porque es la más simple.
- b) Red neuronal, porque es la que más acierta.
- c) Árbol de decisión, porque la regla real son umbrales y un árbol se puede leer.
- d) KMeans, porque arma grupos.

<details><summary>Respuesta</summary>

**c).** La regla es "antigüedad ≥ 36, o visitas ≥ 4 y reclamos ≤ 1": son
preguntas de umbral, justo lo que aprende un árbol.

- a) La regresión lineal es para predecir un número (regresión), no una clase.
- b) La red acierta casi lo mismo (90,6 % contra 90,9 %), tarda segundos y
  no se puede leer: figura como *sirve*.
- d) KMeans es agrupamiento: no usa la respuesta.
</details>

### 3. ¿Por qué la regresión logística acierta menos (81,7 %) que el árbol?

- a) Porque tiene pocos hiperparámetros.
- b) Porque separa con una sola recta y la regla real tiene un "o".
- c) Porque no escala las columnas.
- d) Porque usa menos filas.

<details><summary>Respuesta</summary>

**b).** Una frontera recta no puede dibujar "esto **o** aquello" con dos
umbrales distintos; el árbol sí.

- a) La cantidad de hiperparámetros no limita la forma de la frontera.
- c), d) No es el motivo: las dos se entrenan con las mismas filas.
</details>

### 4. En KMeans, `rand sin escalar` da mucho más bajo que `rand ajustado`. ¿Qué muestra?

- a) Que KMeans no sirve para estos datos.
- b) Que sin escalar, `ticket_promedio` (miles) tapa a las otras columnas en la distancia.
- c) Que hay que usar más grupos.
- d) Que el modelo está sobreajustado.

<details><summary>Respuesta</summary>

**b).** KMeans agrupa por distancia; una columna en miles pesa mucho más que
una en unidades si no se escalan. Es la prueba en números de por qué hay que
escalar.

- a) Escalado llega a rand 0,827.
- c) La cantidad de grupos no explica la diferencia entre las dos métricas.
- d) El sobreajuste se ve en la diferencia entre entrenamiento y prueba, y
  KMeans acá no separa prueba.
</details>

### 5. El mismo árbol tarda 0,051 s con scikit-learn y 23 s con Spark MLlib. ¿Por qué?

- a) Porque MLlib entrena un árbol más grande.
- b) Porque Spark paga el arranque de la sesión y los contenedores de YARN antes de leer una fila.
- c) Porque MLlib no usa la memoria.
- d) Porque el cluster está mal configurado.

<details><summary>Respuesta</summary>

**b).** Con 20.000 filas, el costo fijo (arrancar el driver, pedir 3 GB a
YARN, armar el `VectorAssembler`) domina todo. Los aciertos son casi iguales
(90,9 % contra 90,8 %).

- a) Es el mismo modelo con los mismos parámetros.
- c) Usa 3072 MB entre driver y executors.
- d) Es el comportamiento esperado de una herramienta distribuida con datos
  chicos.
</details>

### 6. ¿Qué es `segmento_real` para el agrupamiento?

- a) Una variable más para agrupar.
- b) La respuesta, que el modelo nunca ve y se usa solo para comparar.
- c) El objetivo del modelo.
- d) Una columna con ruido.

<details><summary>Respuesta</summary>

**b).** El agrupamiento es **no supervisado**: busca grupos sin la
respuesta, y después se comparan con `segmento_real` con el rand ajustado.

- a), c) Si el modelo la viera, no sería no supervisado.
- d) La columna trampa es `edad`.
</details>

### 7. Entrenás con 95 % para entrenar. ¿Qué pasa con la métrica?

- a) Mejora siempre.
- b) Queda medida sobre pocas filas de prueba y salta más de una corrida a otra.
- c) No cambia.
- d) Se mide sobre las filas de entrenamiento.

<details><summary>Respuesta</summary>

**b).** La métrica se mide sobre las filas de prueba; con 5 % son 1.000
filas y cada error pesa más.

- a) Más filas para entrenar pueden ayudar algo, pero la medida es menos
  confiable.
- c) Cambia su variabilidad.
- d) Nunca: medir sobre lo que vio al entrenar no dice si generaliza.
</details>

### 8. El dibujo 3D del árbol, para una fila, ¿qué muestra?

- a) Una animación ilustrativa, parecida a lo que hace el modelo.
- b) La cuenta exacta del modelo para esa fila, con los umbrales que guardó el entrenamiento.
- c) El promedio de todas las filas.
- d) Cómo se entrenó el árbol, paso a paso.

<details><summary>Respuesta</summary>

**b).** La interfaz rehace la cuenta con lo que guardó el entrenamiento: lo
que se ve es exactamente lo que calcula el modelo para esa fila.

- a) No es una ilustración.
- c) Es una explicación **local**: una fila.
- d) Eso lo hace la vista *cómo aprendió* de la red, no el árbol.
</details>

## Desarrollo

### 1. ¿Por qué el sandbox usa un dataset sintético con reglas conocidas? ¿Qué se puede hacer con él que con datos reales no?

<details><summary>Respuesta modelo</summary>

Porque se sabe exactamente cómo se calculó cada respuesta (`vuelve` por
umbrales de antigüedad, visitas y reclamos; `gasto_mes_siguiente` como una
suma; `edad` sin efecto). Eso permite comparar **lo que aprendió** el modelo
con **lo que tendría que haber aprendido**: si el árbol pregunta por
antigüedad cerca de 36 y visitas cerca de 4, aprendió la regla; si un modelo
se apoya en `edad`, está aprendiendo ruido. Con datos reales la regla no se
conoce y solo se puede mirar la métrica.

Rúbrica: qué es "reglas conocidas" (1), la comparación con lo aprendido (2),
el papel de `edad` (1), el límite con datos reales (1).
</details>

### 2. La red neuronal acierta casi lo mismo que el árbol. ¿Cuál elegirías para este problema y por qué?

<details><summary>Respuesta modelo</summary>

El árbol. Acierta igual o un poco más (90,9 % contra 90,6 %), tarda
milisegundos contra segundos y **se puede leer**: sus preguntas se pueden
comparar con la regla y explicar a quien use el modelo. La red no tiene una
pregunta ni un coeficiente que signifique algo por sí solo; para explicarla
harían falta técnicas aparte (SHAP, LIME). La red conviene cuando el
problema no tiene esa forma de umbrales (imágenes, texto, audio).

Rúbrica: elección con métrica y tiempo (2), interpretabilidad (2), cuándo
convendría la red (1).
</details>

### 3. ¿Qué significa que la métrica se mida sobre filas de prueba? ¿Qué pasaría si se midiera sobre las de entrenamiento?

<details><summary>Respuesta modelo</summary>

El modelo se entrena con una parte de las filas (80 % por defecto) y se
mide con las otras, que no vio. Así se estima cómo va a andar con datos
nuevos (si **generaliza**). Medido sobre las de entrenamiento, un modelo que
memoriza (un árbol muy profundo, por ejemplo) daría casi 100 % y parecería
perfecto, pero fallaría con datos nuevos: es el **sobreajuste**. La
validación cruzada repite la medida repartiendo los datos en 5 partes para
que no dependa de un solo corte.

Rúbrica: qué es la prueba (2), qué pasa sin ella (2), validación cruzada (1).
</details>

## Ejercicios sobre la interfaz

### Ejercicio 1. Contra la línea base

En clasificación, entrená el **Clasificador tonto**, el **Árbol de
decisión** y la **Regresión logística** con scikit-learn, con las
columnas y el porcentaje por defecto. Armá una tabla con aciertos y tiempo, y
explicá el orden.

<details><summary>Solución</summary>

Con la configuración de la imagen, los valores de referencia son: tonto
57,3 %, árbol 90,9 %, logística 81,7 % (los medidos pueden cambiar un poco).
El tonto marca el piso; el árbol aprende la regla de umbrales; la logística
queda en el medio porque separa con una recta y la regla tiene un "o".

Rúbrica: tabla con los tres (3), explicación del orden (2).
</details>

### Ejercicio 2. Leer el árbol

Entrená el árbol con `max_depth` 3, abrí el dibujo, elegí una fila con
`vuelve` = 1 y seguí la fila hasta la hoja. Anotá cada pregunta que
responde. ¿Se parecen a la regla real? ¿Aparece `edad`?

<details><summary>Solución</summary>

Las preguntas se leen en el texto del medio ("pregunta 1 de 3"...) y en
la tabla de lo que aprendió. Lo esperable es ver umbrales sobre
`antiguedad_meses` cerca de 36 y sobre `visitas_mes` cerca de 4 (y
`reclamos`), que son la regla real. `edad` no debería aparecer: no influye.

Rúbrica: anota las preguntas (2), las compara con la regla (2), comenta
`edad` (1). Como el árbol puede elegir otros cortes, vale cualquier
respuesta que salga del dibujo y esté bien comparada.
</details>

### Ejercicio 3. Escalar o no escalar

Pasá a **agrupamiento**, entrená KMeans con `visitas_mes` y
`ticket_promedio` y `n_clusters` 3. Anotá `rand ajustado` y `rand sin
escalar`, abrí el dibujo y explicá qué ves.

<details><summary>Solución</summary>

Lo esperable es `rand ajustado` alto (la referencia, con todas las columnas,
es 0,827) y `rand sin escalar` más bajo. En el dibujo, los centros arrancan donde los
pone k-means++ y se mudan al promedio de sus puntos en cada iteración. La
diferencia entre los dos rand es la prueba de que sin escalar el ticket, en
miles, decide casi solo los grupos.

Rúbrica: los dos números (2), la explicación del escalado (2), qué muestra
el dibujo (1).
</details>

### Ejercicio 4. Una máquina contra el cluster

Entrená el árbol con scikit-learn y después con Spark MLlib. Ordená
**Entrenamientos** por tiempo y mirá **Trabajos en YARN** mientras corre el
de MLlib. ¿Qué cambió y qué no?

<details><summary>Solución</summary>

Los aciertos casi no cambian (90,9 % contra 90,8 % en la referencia); el
tiempo pasa de milisegundos a decenas de segundos y la memoria de cerca de 1
MB a 3 GB. En Trabajos aparece la sesión de Spark pidiendo contenedores. Si
el detalle dice "Valores de referencia, no medidos en esta corrida.", los
números son los esperados y no los medidos.

Rúbrica: qué cambia (2), qué no (1), lo que se ve en YARN (1), conclusión
sobre cuándo conviene MLlib (1).
</details>
