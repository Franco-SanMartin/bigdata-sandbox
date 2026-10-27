# 7. Machine Learning: elegir, entrenar y mirar el modelo por dentro

Elegir qué predecir y con qué columnas, ver qué modelo conviene y por qué,
entrenarlo con scikit-learn o con Spark MLlib, comparar métricas, tiempo y
memoria, y abrir el modelo para ver qué aprendió. Es lo de la versión `ml`
(`ejemplos/ml/modelos_sklearn.py` y `modelos_spark.py`) puesto en una
pantalla.

[← 6. Pipeline](06-pipeline.md) · [Índice de full](README.md) · Siguiente: [8. Prácticas guiadas →](08-practicas.md)

La pantalla es **Machine Learning** (`G M`). Para entrenar necesita
`SERVICIOS=todo`; si no, el servidor contesta "Machine Learning necesita los
servicios completos (Spark y Python)". Con MLlib además tienen que estar
YARN y HDFS. Los datos y la recomendación se ven igual aunque no se pueda
entrenar: arriba aparece "Entrenar: *motivo*. Los datos y qué modelo conviene
se ven igual."

![Machine Learning: el dataset, qué modelo conviene, el panel para entrenar y los entrenamientos](../../docs/capturas/ml.png)

## Paso 1. El dataset y sus columnas

**Qué se ve.** El título *Machine Learning* con el subtítulo "Elegís qué
predecir, con qué columnas y con qué motor; entrenás y comparás métricas,
tiempo y memoria." El panel del dataset, **Clientes con señal (reglas
conocidas)**, con la cantidad de filas y dos vistas: *columnas* y *muestra*.
Si todavía no existe: "El dataset de clientes se genera al arrancar el
cluster."

| Columna | Qué es |
|---|---|
| `antiguedad_meses` | de 1 a 60 |
| `visitas_mes` | depende del segmento |
| `ticket_promedio` | depende del segmento, con ruido |
| `reclamos` | de 0 a 5 |
| `edad` | no influye en nada: el modelo tendría que darse cuenta |
| `segmento_real` | la respuesta del agrupamiento (*solo para comparar*) |
| `gasto_mes_siguiente` | 5000 + 1500·visitas + 0,8·ticket − 1500·reclamos + 50·antigüedad + ruido |
| `vuelve` | 1 si antigüedad ≥ 36, o visitas ≥ 4 y reclamos ≤ 1; 10 % dado vuelta |

En la vista *columnas*, las que se pueden predecir tienen el botón
**Predecir esta** y la marcada como *objetivo* queda resaltada; las demás
tienen una casilla para usarlas como variable ("N de M variables").

**Qué significa.** Es un dataset **sintético con reglas conocidas**: se sabe
exactamente cómo se calculó cada respuesta. Eso permite comparar lo que
aprendió el modelo con la regla real, cosa que con datos de verdad no se
puede. `edad` está de trampa: un buen modelo le tiene que dar poco peso.

**De dónde sale.** `clientes_senal.csv`, que se genera al arrancar con
`ejemplos/ml/generar_senal.py` (20.000 filas, menos de 1 MB). Si está en
HDFS, se lee de `/user/root/ml/clientes_senal.csv`.

<!-- prueba: no (genera el CSV y lo sube a HDFS; la imagen ya lo hace al arrancar) -->
```bash
python3 ejemplos/ml/generar_senal.py
hdfs dfs -mkdir -p /user/root/ml
hdfs dfs -put -f clientes_senal.csv /user/root/ml/
```

## Paso 2. El tipo de problema

**Qué hacer.** En **Tipo de problema** elegí *regresión*, *clasificación* o
*agrupamiento* (arranca en clasificación).

| Tipo | Qué predice | Objetivo | Métrica principal |
|---|---|---|---|
| regresión | Cuánto va a gastar el mes que viene | `gasto_mes_siguiente` | R² |
| clasificación | Si vuelve o no | `vuelve` | aciertos |
| agrupamiento | Qué grupos de clientes hay (sin decirle la respuesta) | ninguno | rand ajustado |

**Qué significa.** Regresión y clasificación son **supervisadas**: el modelo
aprende de filas donde ya se conoce la respuesta. Agrupamiento es **no
supervisado**: no hay respuesta; se buscan grupos parecidos y después se
comparan con `segmento_real`, que el modelo nunca ve. En agrupamiento las
variables arrancan en `visitas_mes` y `ticket_promedio`.

## Paso 3. Qué modelo conviene

**Qué se ve.** El panel **Qué modelo conviene** con una explicación del tipo
de problema y un consejo de motor: "Con 20.000 filas (menos de 1 MB) todo
entra en la memoria de una máquina: scikit-learn tarda milisegundos. Spark
MLlib conviene cuando los datos no entran en una sola máquina." Debajo, cada
opción con su etiqueta (*recomendado*, *sirve*, *línea base*), el porqué, lo
esperado (métrica · tiempo · memoria, marcado *referencia*) y el botón
**usar**.

| Problema | Modelo | Motor | Etiqueta | Por qué |
|---|---|---|---|---|
| regresión | Regresión lineal | scikit-learn | recomendado | La regla real es una suma de columnas por números fijos: una recta la encuentra casi exacta |
| clasificación | Árbol de decisión | scikit-learn | recomendado | La regla real son umbrales (antigüedad ≥ 36, visitas ≥ 4): es justo lo que aprende un árbol, y se puede leer |
| clasificación | Red neuronal (MLP) | scikit-learn | sirve | Acierta casi lo mismo que el árbol, pero tarda segundos y no se puede leer qué aprendió |
| clasificación | Regresión logística | scikit-learn | sirve | Separa con una sola recta: la regla real tiene un "o", por eso acierta menos |
| clasificación | Clasificador tonto | scikit-learn | línea base | Contesta siempre la clase más común: cualquier modelo que no le gane no sirve |
| agrupamiento | KMeans | scikit-learn | recomendado | Busca grupos de puntos cercanos. Hay que escalar las columnas antes: sin escalar, el ticket (miles) tapa todo lo demás |
| todos | el mismo | Spark MLlib | sirve | Mismo resultado, pero arranca una sesión de Spark en YARN y pide 3 GB: con 20.000 filas es mucho más lento |

Los valores esperados son los que se midieron en la imagen (16.000 filas para
entrenar y 4.000 para probar, todas las columnas, parámetros por defecto):

| Modelo | scikit-learn | Spark MLlib |
|---|---|---|
| Regresión lineal | R² 0,983 · 0,017 s · 1,5 MB | R² 0,983 · 19 s · 3072 MB |
| Clasificador tonto | 57,3 % · 0,002 s · 0,6 MB | no está |
| Árbol de decisión | 90,9 % · 0,051 s · 1,2 MB | 90,8 % · 23 s · 3072 MB |
| Regresión logística | 81,7 % · 0,044 s · 1,8 MB | 81,6 % · 22 s · 3072 MB |
| Red neuronal (MLP) | 90,6 % · 8,135 s · 2,1 MB | 90,3 % · 41 s · 3072 MB |
| KMeans | rand 0,827 · 0,197 s · 2,2 MB | rand 0,82 · 24 s · 3072 MB |

**Qué significa.** La recomendación no es magia: son reglas fijas que miran
la forma de la regla real. Lo que vale la pena notar es el orden de magnitud:
el mismo árbol tarda 51 ms en una máquina y 23 s en el cluster, porque Spark
paga el arranque de la sesión y los contenedores de YARN antes de leer una
fila.

## Paso 4. Entrenar

**Qué hacer.** En el panel **Entrenar** elegí el modelo, el motor
(*scikit-learn* o *Spark MLlib*; los que no existen en MLlib dicen "Este
modelo no está en MLlib para este problema"), cuánto usar **para entrenar**
(de 50 a 95 %, 80 por defecto) y los hiperparámetros. Después **Entrenar**.

| Modelo | Hiperparámetros (por defecto) |
|---|---|
| Árbol de decisión | `max_depth` de 1 a 20 (3) |
| Regresión logística | `C` (1) |
| Red neuronal (MLP) | `hidden_layer_sizes` (`16,8`), `max_iter` de 50 a 5000 (500) |
| KMeans | `n_clusters` de 2 a 10 (3), `n_init` de 1 a 50 (10) |
| Clasificador tonto | `strategy` (`most_frequent`) |
| Regresión lineal | "Sin hiperparámetros para tocar." |

En agrupamiento no hay porcentaje: "todas las filas (…): clustering no
separa prueba, se mide contra segmento_real".

El botón no se habilita si falta algo: "Esperá a que termine el entrenamiento
que está corriendo", "Marcá al menos una columna como variable" o "Elegí un
modelo de la lista". Se entrena uno por vez.

**Qué se ve.** El entrenamiento aparece en **Entrenamientos** (columnas #,
modelo, motor, estado, métrica, tiempo, memoria) y en **Detalle** con una
barra de avance y lo que está haciendo.

![El detalle de un entrenamiento: métricas, matriz de confusión y predicciones contra lo real](../../docs/capturas/ml-entrenamiento.png)

**En la terminal.** La interfaz corre un script que entrena solo el modelo
pedido, con la misma semilla (42) y los mismos modelos que los ejemplos de la
versión `ml`. Los ejemplos entrenan todos de una:

<!-- prueba: no (entrena todos los modelos; la guía de ml los corre) -->
```bash
python3 ejemplos/ml/modelos_sklearn.py
spark-submit ejemplos/ml/modelos_spark.py
```

**Qué significa.** Separar filas para **prueba** es la forma de saber si el
modelo generaliza: la métrica se mide sobre filas que no vio al entrenar. Con
95 % para entrenar quedan pocas filas de prueba y la métrica salta más de una
corrida a otra.

## Paso 5. Las métricas y la referencia

**Qué se ve.** En el **Detalle**, una fila de números, cada uno con su
explicación:

| Métrica | Qué dice |
|---|---|
| R² | 1 = predice perfecto, 0 = igual que decir siempre el promedio |
| error medio | cuánto se equivoca en promedio, en la unidad del objetivo |
| validación cruzada | la misma métrica repartiendo los datos en 5 partes |
| aciertos | filas de prueba bien clasificadas |
| rand ajustado | cuánto se parecen los grupos a los segmentos reales (1 = iguales) |
| rand sin escalar | lo mismo sin escalar las columnas antes |
| silhouette k=3 | qué tan separados quedan los grupos (−1 a 1) |
| tiempo | solo el `fit()` |
| memoria | pico del proceso (scikit-learn) o driver + executors (MLlib) |
| entrena / prueba | filas de cada lado |

Debajo: objetivo (o "ninguno (no supervisado)"), variables y parámetros. En
clasificación, la **matriz de confusión** ("N filas de prueba · X % en la
diagonal": filas = lo real, columnas = lo que predijo) y **predicciones
contra lo real**. Si el modelo tiene algo legible (coeficientes, reglas,
centros), aparece una tabla con lo que aprendió. Al final, plegado, el
**trace del entrenamiento**.

Si dice **Valores de referencia, no medidos en esta corrida.**, los números
son los esperados de la tabla del paso 3: con MLlib, "medilos con
modelos_spark.py en el cluster"; con scikit-learn, "con otra configuración el
número real puede cambiar".

**Qué significa.** Lo primero es comparar contra la **línea base**: el
clasificador tonto acierta 57,3 % sin mirar ninguna columna, así que un
modelo con 60 % casi no aprendió nada. Lo segundo, mirar `rand sin escalar`
contra `rand ajustado` en KMeans: es la prueba de por qué hay que escalar.

## Paso 6. El modelo por dentro

**Qué se ve.** Si el entrenamiento terminó, abajo del detalle se carga un
dibujo 3D ("Cargando el dibujo del modelo…"). Cada modelo tiene su título y
una explicación:

| Modelo | Título | Cómo se lee |
|---|---|---|
| Red neuronal | la red neuronal por dentro | Elegí una fila y mirá cómo el dato cruza la red: cada pulso es entrada × peso, las neuronas se encienden según lo que les llega y a la derecha sale la probabilidad. Pasá el mouse por una neurona o una conexión para ver la cuenta. |
| Árbol | el árbol por dentro | La fila baja por el árbol respondiendo una pregunta por nodo (sí a la izquierda) hasta una hoja, que decide por mayoría. |
| KMeans | los grupos por dentro | Los centros arrancan donde los pone k-means++ y en cada iteración se mudan al promedio de sus puntos; los puntos cambian de grupo cuando otro centro les queda más cerca. |
| Regresión lineal | el plano de la regresión | Lo que predice la regresión es una suma: una constante más cada columna por su coeficiente. |
| Regresión logística | la superficie de la regresión logística | La regresión logística suma como la lineal y pasa el resultado por una sigmoide: la superficie es la probabilidad. |
| Clasificador tonto | el clasificador tonto | El tonto no aprende de las columnas: su superficie es plana. |

**Qué hacer.**

- Elegí una **fila** de la muestra (con su valor real) o **mover valores**
  para probar valores a mano con controles deslizantes.
- Usá los controles: paso atrás, **reproducir** / **pausa**, paso adelante,
  la **Velocidad** (½×, 1×, 2×) y **reencuadrar**. El texto del medio dice dónde
  va: "pregunta 2 de 3" y "llegó a una hoja" en el árbol; "el dato está en la
  entrada", "pasó la capa oculta 1" y "llegó a la salida" en la red;
  "iteración N de M" en KMeans.
- En la red, **Qué pesos se ven**: *red final* o *cómo aprendió* (época por
  época, con la curva de pérdida).

![El árbol por dentro: la fila baja respondiendo una pregunta por nodo](../../docs/capturas/ml-arbol.gif)

![La red por dentro: el dato cruza las capas y sale la probabilidad](../../docs/capturas/ml-red.gif)

![KMeans por dentro: los centros se mudan al promedio de sus puntos](../../docs/capturas/ml-kmeans.gif)

**Qué significa.** La interfaz rehace la cuenta del modelo con los pesos,
umbrales o centros que guardó el entrenamiento: lo que se ve es exactamente
lo que calcula el modelo para esa fila, no una ilustración. En el árbol se
puede comparar cada pregunta con la regla real (antigüedad ≥ 36, visitas ≥
4); en la red no hay preguntas que leer, solo números. Ver
[teoría: interpretabilidad](teoria/interpretabilidad.md).

Casos especiales:

- Con más de 3 columnas, KMeans dibuja "las 3 direcciones principales (PCA);
  el grupo se calcula con todas".
- Si la red es muy grande: "pasa del tope de pesos que se mandan, así que se
  ve la forma sin las conexiones ni la pasada".
- Sin WebGL (o si el navegador corta el contexto 3D): "No se puede dibujar en
  3D." con el motivo y "La cuenta es la misma: abajo y al costado tenés la
  fila, lo que pasa en cada paso y lo que sale."
- Si el sistema pide menos movimiento: no hay **reproducir** ni velocidad,
  dice "sin animación (el sistema pide menos movimiento): de a un paso".
- Si el dibujo no se pudo armar al entrenar: "No se pudo armar el dibujo del
  modelo (el modelo vale igual)".

## Paso 7. Comparar scikit-learn y Spark MLlib

**Qué hacer.** Entrená el **Árbol de decisión** con scikit-learn y después
con Spark MLlib, con las mismas columnas y el mismo porcentaje. Ordená
**Entrenamientos** por tiempo.

**Qué se ve.** Aciertos casi iguales (90,9 % contra 90,8 % en la referencia);
el tiempo pasa de milisegundos a decenas de segundos y la memoria de 1 MB a
3 GB. Mientras corre el de MLlib, en **Trabajos en YARN** aparece la sesión
de Spark pidiendo contenedores.

**Qué significa.** Spark MLlib reparte el entrenamiento entre executors: vale
la pena cuando los datos no entran en una máquina. Con 20.000 filas, el costo
fijo (arrancar el driver, pedir contenedores, armar el `VectorAssembler`)
domina todo. Es la misma conclusión que pandas contra Spark en la
[guía 8 de la materia](../08-spark.md), ahora con modelos.

## Dónde se usa esto en la industria

Elegir modelo contra una **línea base**, separar entrenamiento y prueba y
comparar métricas es el trabajo diario de un equipo de datos, que suele
llevarlo con **MLflow** (registro de corridas, parámetros y métricas, como la
tabla de Entrenamientos) o con las consolas de **SageMaker**, **Vertex AI** o
**Azure ML**. scikit-learn es el estándar para datos que entran en memoria;
**Spark MLlib** (en Databricks, EMR o Dataproc) para los que no. Mirar el
modelo por dentro es lo que hacen herramientas de explicabilidad como
**SHAP**, `plot_tree` de scikit-learn o **TensorBoard** para redes, y en
industrias reguladas (crédito, seguros, salud) es un requisito: hay que poder
explicar por qué el modelo dijo lo que dijo.
