# La versión `ml`

`franki678/bigdata-sandbox:ml` es la versión `base` (Hadoop, Hive, Spark,
Pig, Sqoop, MySQL, ZooKeeper y MongoDB) **más Python para datos**: pandas,
numpy, scikit-learn, matplotlib, pymongo y JupyterLab. Sirve para hacer ETL
(limpiar datos) y machine learning de las dos formas que se usan en la
industria: en una sola compu (pandas + scikit-learn) y repartido en el
cluster (Spark + Spark MLlib), con los mismos datos, para comparar.

[← Índice de guías](../README.md) · [README del repo](../../README.md) · [Glosario](../glosario.md)

## Para quién es

- Para la parte de **ciencia de datos** de la materia: preparación de datos,
  modelos supervisados y no supervisados, evaluación.
- Para el que ya hizo las guías de `base` (o al menos la 2, la 3 y la 8) y
  quiere seguir con Python.
- Para el que quiere trabajar con **notebooks** (JupyterLab en el navegador)
  en vez de la terminal.

Todo lo de `base` **sigue valiendo** en `ml`: los mismos comandos, las mismas
páginas web, los mismos ejemplos. `ml` solo agrega cosas. La documentación de
`base` está en [../base/README.md](../base/README.md) y las guías de la
terminal, en el [índice de guías](../README.md).

## Qué agrega sobre `base`

Las librerías van con versión fija (`conf/requirements-ml.txt`): la imagen se
arma igual hoy y dentro de un año, y todos tienen exactamente lo mismo.

| Librería | Versión | Para qué |
|---|---|---|
| numpy | 1.26.4 | Arrays y cálculo numérico. La última 1.x a propósito: Spark 3.5 no anda con numpy 2 |
| pandas | 2.3.3 | Tablas (DataFrames) en memoria: el ETL en una sola compu |
| pyarrow | 25.0.0 | Formato Parquet y el pasaje rápido de datos entre Spark y pandas (`toPandas`) |
| scikit-learn | 1.9.1 | Modelos de machine learning en una sola compu |
| scipy | 1.17.1 | Cálculo científico; la necesita scikit-learn |
| matplotlib | 3.11.2 | Gráficos |
| pymongo | 4.19.0 | Conectarse a MongoDB desde Python |
| JupyterLab | 4.6.4 | Notebooks en el navegador, en el puerto 8888 |

Además:

- **PySpark desde cualquier `python3`**: la imagen deja puesto el
  `PYTHONPATH` de Spark, así que `import pyspark` anda en JupyterLab o en un
  script suelto, no solo con `spark-submit`. Spark MLlib (`pyspark.ml`) ya
  venía con Spark 3.5.9 en `base`.
- **Los ejemplos de `ml`** en `/datos/ejemplos/ml`: dos generadores de datos,
  dos ETL (pandas y Spark), dos juegos de modelos (scikit-learn y MLlib) y
  MongoDB → pandas. Se copian solos al arrancar, sin pisar los que ya tengas.
- `pip install <librería>` anda adentro sin opciones extra
  (`PIP_BREAK_SYSTEM_PACKAGES=1`), si tenés internet. Lo instalado así se
  pierde al borrar el contenedor.

Python es el mismo de `base` (3.12, el de Ubuntu 24.04).

## Requisitos

Los mismos de `base` con MongoDB, medidos por GitHub en cada versión nueva
(tabla completa en el [README del repo](../../README.md#requisitos)):

| | `ml` |
|---|---:|
| **RAM para Docker** | 7 GB |
| RAM en uso, en reposo | 2,2 GB |
| RAM en uso, pico con trabajos | 6,0 GB |
| Descarga | 1,58 GB |
| Disco, Linux | 2,93 GB |
| Disco, Docker Desktop (Windows/Mac) | ~4,5 GB |

- Docker instalado ([guía 1](../01-instalacion.md)).
- MongoDB (para la [guía 6](06-mongodb-pandas.md)) necesita un procesador
  con AVX ([guía 1](../01-instalacion.md#tu-procesador-tiene-avx-para-mongodb)).
- Un navegador para JupyterLab.

## Cómo arrancarla

El mismo `docker run` de la [guía 2](../02-arrancar-y-apagar.md) con dos
cambios: el tag `:ml` y un puerto más, el **8888** de JupyterLab. El detalle,
para PowerShell y CMD también, está en la
[guía 1 de ml](01-arrancar-y-jupyterlab.md).

<!-- prueba: no (es el mismo comando de la guía 01 de ml, que es la que se prueba) -->
```bash
docker run -d --name bigdata --stop-timeout 20 \
  -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si \
  -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 \
  -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 \
  -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 \
  -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 \
  -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 -p 127.0.0.1:8888:8888 \
  -v bigdata_hadoop:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:ml
```

Cuando `docker logs -f bigdata` diga *Cluster LISTO*, abrís
http://localhost:8888. **No pide token ni contraseña**: JupyterLab está
configurado sin ninguno de los dos (`conf/jupyter_server_config.py`), como el
resto del sandbox. Por eso el puerto va con `127.0.0.1:`: así solo lo ves vos.
Abierto a la red del aula, cualquiera podría correr programas en tu
contenedor.

JupyterLab se prende solo (`JUPYTER=si` es el valor por defecto). Con
`-e JUPYTER=no` no se prende y ahorra RAM.

## Mapa de la documentación

### Guía paso a paso (en este orden)

| # | Guía | Qué se hace |
|---|---|---|
| 1 | [Arrancar `ml` y entrar a JupyterLab](01-arrancar-y-jupyterlab.md) | Crear el contenedor con `:ml`, abrir JupyterLab, el primer notebook, la terminal de adentro |
| 2 | [Datos sucios y ETL con pandas](02-datos-sucios-pandas.md) | Generar ventas con errores conocidos y limpiarlas paso a paso |
| 3 | [El mismo ETL con Spark](03-etl-spark.md) | Subir a HDFS, limpiar con PySpark y comparar número por número con pandas |
| 4 | [Modelos con scikit-learn](04-modelos-sklearn.md) | Datos con reglas conocidas; regresión, árbol, logística, red neuronal y KMeans |
| 5 | [Los mismos modelos con Spark MLlib](05-modelos-spark-mllib.md) | VectorAssembler, Estimator/Model, Pipeline, validación cruzada en el cluster |
| 6 | [MongoDB + pandas](06-mongodb-pandas.md) | De documentos con campos variables a tablas |
| 7 | [Problemas de `ml`](07-problemas.md) | JupyterLab que no abre, Spark que no arranca desde un notebook, memoria |

### Para consultar

- [Referencia](referencia.md): qué es cada librería, dónde se usa en la
  industria, las funciones que usan los ejemplos y cada script de
  `ejemplos/ml` (qué hace, qué lee, qué deja y cómo se corre).
- [Teoría](teoria/README.md): machine learning supervisado y no supervisado,
  calidad de datos, regresión, clasificación, clustering, redes neuronales,
  evaluación, pandas contra Spark y ML distribuido, siempre con los ejemplos
  de la imagen.
- [Evaluación](evaluacion/README.md): multiple choice, preguntas de desarrollo
  y ejercicios prácticos sobre la imagen, con respuestas y rúbrica.

### Orden de estudio sugerido

1. Guías 1 y 2 y, en paralelo, [teoría 1](teoria/01-que-es-ml.md) y
   [teoría 2](teoria/02-preparacion-de-datos.md).
2. Guía 3 con [teoría 8](teoria/08-pandas-vs-spark.md).
3. Guía 4 con [teoría 3 a 7](teoria/README.md) (regresión, clasificación,
   clustering, redes, evaluación).
4. Guía 5 con [teoría 9](teoria/09-ml-distribuido-mllib.md).
5. Guía 6 (repasa la [guía 10 de MongoDB](../10-mongodb.md)).
6. Al final de cada bloque, el archivo de [evaluación](evaluacion/README.md)
   del tema.

## Dónde queda cada cosa

| Qué | Dónde |
|---|---|
| Ejemplos de `ml` | `/datos/ejemplos/ml` (en tu compu, `datos/ejemplos/ml`) |
| Lo que generan los ejemplos (CSV, Parquet, JSON, PNG) | `/datos`, la carpeta desde donde se corren |
| Lo que sube el ETL de Spark | HDFS, en `/user/root/ml` |
| Tus notebooks | Donde los guardes en JupyterLab: arranca en `/datos` |
| Log de JupyterLab | `/var/log/jupyter.log` (adentro) |
| Configuración de JupyterLab | `/etc/jupyter/jupyter_server_config.py` (en el repo, `conf/jupyter_server_config.py`) |
