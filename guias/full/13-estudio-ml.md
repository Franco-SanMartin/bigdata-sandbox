# 13. Estudio de ML: de los datos en HDFS a un modelo en producción

El recorrido completo de un modelo, como se hace en un equipo de datos:
1. Datos grandes en HDFS.
2. Limpieza que viaja con el modelo.
3. Entrenamiento en YARN con una evaluación honesta.
4. Una biblioteca con versiones.
5. Predicción por lotes que avisa cuando los datos nuevos ya no se parecen a
   los del entrenamiento.

La [guía 7](07-machine-learning.md) es la pantalla *Guiado*, para la clase.
Esta guía es la pestaña **Estudio** y sus compañeras **Experimentos** y
**Biblioteca**.

[← 12. Formatos](12-formatos.md) · [Índice de full](README.md)

La pantalla es **Machine Learning** (`G M`). Para entrenar necesita
`SERVICIOS=todo` y el cluster prendido. Los comandos van **adentro** del
contenedor (`docker exec -it bigdata-full bash`), parado en `/datos`.

## Paso 1. Datos a escala

**Qué hacer.** En *Estudio → Datos*, abajo de la lista de fuentes, tocá **Datos
a escala en HDFS…**. Dejá *clientes*, 1 millón de filas, 5 % de suciedad,
Parquet y las carpetas `anio=/mes=`. Después, **Generar en YARN**.

**Qué se ve.** El avance del trabajo de Spark y, al terminar, las filas, lo que
ocupa en HDFS y en cuántos archivos quedó. La fuente nueva aparece en la
pestaña *HDFS* de la lista y queda elegida.

**Qué significa.** El generador (`sandbox_ml/generar.py`) no arma un archivo en
una máquina y lo sube: cada executor genera su parte con `spark.range` y
`rand(semilla)`, y escribe directo en HDFS. Por eso escala a cientos de
millones de filas.

Los datos tienen **señal**: las reglas de `clientes_senal.csv` (segmentos 60 /
30 / 10 %, el gasto como fórmula lineal y "vuelve" con el 10 % dado vuelta). Así
se sabe qué tendría que aprender el modelo: un 90 % de acierto es el techo.

La **suciedad** agrega:
- nulos en la edad y en el ticket;
- tickets 50 veces más grandes;
- segmentos con mayúsculas y espacios;
- filas repetidas.

**En la terminal.** Lo mismo, sin la pantalla:

<!-- prueba: no (corre en full o ml con el cluster arriba; lo prueba el humo de full) -->
```bash
spark-submit --master yarn /opt/sandbox/ml/sandbox_ml/generar.py clientes \
  --filas 1000000 --salida /user/root/ml/generado/clientes_1m --suciedad 0.05 --particionar
hdfs dfs -du -s -h /user/root/ml/generado/clientes_1m
```

Con `calificaciones` en vez de `clientes` sale usuario, ítem y nota (de 1 a 5).
Es lo que necesita ALS, el modelo de recomendación.

## Paso 2. Perfil y limpieza

**Qué hacer.** Con la fuente elegida, mirá el perfil (motor *Spark*, sobre una
muestra) y pasá a **Limpieza**. Sumá dos pasos:
- *nulos* en `edad`, con la mediana;
- *texto* en `segmento_real`, para recortar y pasar a minúsculas.

**Qué se ve.** El perfil marca los nulos de `edad` y los extremos de
`ticket_promedio`. La vista previa muestra cada paso antes y después, con las
filas afectadas y lo que aprendió (la mediana).

**Qué significa.** Lo que aprende la limpieza sale **solo del entrenamiento**.
Va adentro del modelo, en el paso `Limpiar` del `PipelineModel`, así los datos
nuevos se limpian igual al predecir. Los duplicados y los filtros son solo de
entrenamiento: al predecir no se sacan filas.

## Paso 3. Entrenar en YARN con evaluación honesta

**Qué hacer.** En **Objetivo**:
- `vuelve` como objetivo;
- `cliente_id` como id;
- `gasto_mes_siguiente`, `anio` y `mes` como ignorar.

En **Modelo**, *Regresión logística* de Spark MLlib. En **Validación**, dejá lo
de fábrica: entrenamiento, validación y prueba (70 / 15 / 15), el umbral por F1
y los recursos de YARN. **Entrenar**.

**Qué se ve.** En *Resultados*:
- la métrica de prueba, al lado de la de validación;
- la nota "el modelo quedó guardado con umbral …";
- las curvas ROC y PR, la calibración y la matriz de confusión;
- en *Costo*, lo que se le pidió a YARN (executors, memoria) y la app.

**Qué significa.** La prueba se usa **una sola vez, al final**. El umbral se
elige mirando la validación, nunca la prueba, y queda guardado en el modelo
(`setThreshold`).

Las curvas se cuentan en los executors con 200 cubetas: al driver llegan
resúmenes, no millones de filas. Con 1 millón de clientes el AUC anda por 0,87 y
la exactitud no pasa del 90 % (el ruido de las reglas).

## Paso 4. La biblioteca: versiones y estados

**Qué hacer.** En *Experimentos*, abrí la corrida y tocá **Guardar en la
biblioteca**, con el nombre `churn` y una nota. En *Biblioteca → churn*,
**Promover** la versión.

Entrená otra (por ejemplo, un bosque de Spark), guardala en `churn` y comparalas
marcando las dos.

**Qué se ve.**
- **Versiones**: cada una con su estado (candidato, en producción o archivado),
  su métrica y su nota.
- **Linaje**: de dónde salió la versión (los datos y sus filas, la limpieza, la
  huella de la receta, la validación, la app de YARN, los recursos y las
  versiones de las librerías).
- **Lo que espera**: las columnas que tienen que venir en los datos nuevos, con
  su tipo.
- **Comparar**: cada métrica con la mejor en verde y solo los hiperparámetros
  que cambian.

**Qué significa.**
- Un **experimento** es una corrida. Un **modelo** de la biblioteca es un nombre
  con versiones, y una de ellas es la que se usa (en producción).
- Promover archiva la versión anterior.
- **Volver atrás** promueve la que estuvo antes, y queda en el historial con la
  fecha y la nota.
- La versión se **copia** (el modelo de Spark va a
  `hdfs:///user/root/ml/biblioteca/churn/v1`): borrar el experimento no la
  rompe.
- Es lo mismo que hace el Model Registry de MLflow, con archivos en el volumen
  ([D-08](../../DECISIONES.md)).

**En la terminal.**

<!-- prueba: no (necesita un modelo guardado en la biblioteca) -->
```bash
cat /hadoop/ml/biblioteca/churn/modelo.json | head -40
hdfs dfs -ls /user/root/ml/biblioteca/churn
```

## Paso 5. Predecir por lotes y la deriva

**Qué hacer.** Generá otro dataset (paso 1) en
`/user/root/ml/generado/clientes_nuevos`. En *Biblioteca → churn → predecir →
por lotes*, elegí esa carpeta como datos nuevos y
`/user/root/ml/predicciones/churn` como salida. Probá **Ver el PySpark** y
después **Predecir en YARN**.

**Qué se ve.** Al terminar:
- las predicciones escritas y cuánto tardó;
- el **esquema**: qué columnas se convirtieron y cuántos valores no se pudieron
  convertir, y cuáles sobran (pasan a la salida tal cual);
- la **deriva**: el PSI de cada variable contra el entrenamiento. Tocando una
  variable se ven sus tramos, la proporción en el entrenamiento contra la de los
  datos nuevos.

**Qué significa.** El modelo se midió con datos parecidos a los del
entrenamiento. Si los datos nuevos son otra población, esa métrica ya no vale.

El **PSI** (índice de estabilidad de la población) compara cuántas filas caen en
cada tramo:
- menos de 0,1 es estable;
- de 0,1 a 0,25, cambió algo;
- más de 0,25, es otra población. Conviene reentrenar con datos recientes.

Con datos generados con la misma semilla y la misma suciedad da *estable*. Si
los nuevos salen limpios y el entrenamiento tenía 5 % de suciedad, el ticket ya
da *moderada*: le faltan los nulos y los extremos que vio el modelo. Para ver una
deriva fuerte, generá los nuevos y súmales meses de antigüedad (el humo de
`full` lo hace con 30 meses).

El lote corre con el mismo lanzador que el entrenamiento: avance, límite de
tiempo y memoria, y se puede cancelar. Un modelo de scikit-learn también predice
a escala: el `modelo.joblib` viaja a cada executor y predice con `mapInPandas`.

## Paso 6. Al instante y exportar

**Qué hacer.** En *predecir → al instante*, completá una fila y **Predecir**.
Después tocá **Exportar** arriba a la derecha.

**Qué se ve.** La predicción con las probabilidades de cada clase. El `.zip`
trae:
- el modelo y la ficha (`modelo.json`: métricas, columnas y linaje);
- `servir.py`, `requirements.txt` con las versiones del entrenamiento, un
  `Dockerfile` y un `LEEME.md`.

**Qué significa.** `servir.py` es un servicio HTTP de la librería estándar de
Python (`POST /predecir`, `GET /`, `GET /salud`). Se levanta en otra compu, sin
el sandbox, y contesta lo mismo que la biblioteca.

<!-- prueba: no (en tu compu, con el .zip exportado y Python instalado) -->
```bash
unzip churn-v1.zip && cd churn-v1
pip install -r requirements.txt
python servir.py
curl -s localhost:8000/predecir -H 'Content-Type: application/json' \
  -d '{"filas": [{"antiguedad_meses": 40, "visitas_mes": 6, "ticket_promedio": 9000, "reclamos": 0, "edad": 35, "segmento_real": "frecuente"}]}'
```

## Dónde se usa esto en la industria

Lo que hacen las plataformas de ML de los bancos, las telcos o el retail:
- **MLflow** o el Model Registry de Databricks (versiones, estados y linaje);
- **Evidently** o **WhyLabs** (deriva con PSI, KS o Jensen-Shannon);
- **Spark** para predecir por lotes sobre el data lake cada noche;
- **BentoML** o **KServe** para servir el modelo.

El orden es el mismo de esta guía: entrenar con evaluación honesta, guardar con
linaje, promover con una nota, vigilar la deriva y volver atrás cuando un modelo
nuevo anda peor.
