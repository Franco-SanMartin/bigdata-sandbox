# 7. Problemas de `ml`

Lo que suele fallar en la versión `ml` y cómo se arregla. Los problemas de
Hadoop, Hive, Spark o MongoDB en general están en la
[guía 11 de base](../11-problemas.md): todo eso vale igual acá.

[← 6. MongoDB + pandas](06-mongodb-pandas.md) · [Índice de ml](README.md)

## Primero, mirar

Desde tu compu:

<!-- prueba: compu | espera: Version de la imagen: ml -->
```bash
docker exec bigdata estado
```

En `ml`, `estado` tiene una parte **Python para datos**: la fila de
JupyterLab (puerto 8888, *notebooks en /datos*) o el aviso *JupyterLab:
apagado (JUPYTER=no)*, y la línea de pandas y scikit-learn. La última línea
dice qué versión de la imagen tenés: si dice `base`, el contenedor no es `ml`.

El log de JupyterLab está adentro, en `/var/log/jupyter.log`:

<!-- prueba: compu -->
```bash
docker exec bigdata tail -20 /var/log/jupyter.log
```

Si anda, al principio dice en qué dirección escucha (el puerto 8888) y
después va anotando lo que pasa: kernels que arrancan, notebooks que se
guardan. Si no levantó, el error está al final.

## JupyterLab no abre en el navegador

| Qué pasa | Por qué | Qué hacer |
|---|---|---|
| `estado` dice *JupyterLab: apagado (JUPYTER=no)* | El contenedor se creó con `-e JUPYTER=no`, o es un nodo del aula (`ROL=maestro` o `trabajador`), donde JupyterLab viene apagado si no se pide: cada PC tiene la RAM justa | Recrear el contenedor con `-e JUPYTER=si` ([guía 1](01-arrancar-y-jupyterlab.md)) |
| `estado` no muestra la parte *Python para datos*, o dice `Version de la imagen: base` | El contenedor es de la imagen `base` | Recrearlo con `franki678/bigdata-sandbox:ml` |
| `estado` dice que JupyterLab está arriba, pero el navegador no conecta | Falta `-p 127.0.0.1:8888:8888` en el `docker run` | Recrear el contenedor con ese puerto. Para ver cuáles están publicados: `docker port bigdata` |
| El navegador dice que el puerto está ocupado o abre otra cosa | Otro programa de tu compu (otro Jupyter, por ejemplo) ya usa el 8888 | Cerrarlo, o publicar en otro puerto de tu compu: `-p 127.0.0.1:8889:8888` y abrir http://localhost:8889 |
| `docker logs bigdata` dice *AVISO: JupyterLab no levanto: revisar /var/log/jupyter.log* | Jupyter arrancó con error | Mirar el log (arriba). Lo más común: el contenedor se quedó sin memoria |
| `docker logs bigdata` dice *ERROR: JUPYTER=...: tiene que ser si o no* | Valor mal escrito | `-e JUPYTER=si` o `-e JUPYTER=no` (también vale `sí` o `SI`) |
| `docker logs bigdata` dice *AVISO: JUPYTER=si, pero esta version de la imagen (base) no trae JupyterLab* | Pediste Jupyter con la imagen `base` | Usar `:ml` |
| JupyterLab abre y pide un token o una contraseña | No es la configuración de la imagen, que no pide ninguno de los dos: estás entrando a **otro** Jupyter (uno instalado en tu compu) | Cerrar el otro, o publicar el del contenedor en otro puerto |

Para recrear el contenedor sin perder nada: `docker rm -f bigdata` y el
`docker run` de la guía 1. HDFS está en el volumen `bigdata_hadoop` y tus
notebooks en la carpeta `datos` de tu compu: los dos quedan.

## Spark desde un notebook

| Qué pasa | Por qué | Qué hacer |
|---|---|---|
| La celda de `getOrCreate()` se queda pensando mucho y nunca termina | YARN no tiene lugar: otra sesión de Spark (otro notebook, una consola `pyspark`, un `spark-submit`) está ocupando la memoria. En http://localhost:8088 la tuya figura en `ACCEPTED` | Cerrar las otras: `spark.stop()` en cada notebook, o *Kernel → Shut Down Kernel*. Desde la terminal, `yarn application -list` y `yarn application -kill <id>` |
| `ModuleNotFoundError: No module named 'pyspark'` | El `python3` que usás no es el de la imagen (o se pisó el `PYTHONPATH`) | Usar el kernel *Python 3* de JupyterLab o el `python3` de adentro. Si hace falta a mano: `export PYTHONPATH=/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip` |
| Un notebook con Spark abierto y http://localhost:4040 muestra otra aplicación | Cada sesión de Spark abierta toma un puerto: la primera el 4040, la segunda el 4041, y así. Solo el 4040 está publicado | Cerrar las sesiones que no uses. Las terminadas quedan en http://localhost:18080 |
| `Path does not exist: hdfs://...` | El archivo no está en HDFS (o está en `/datos`, que es local) | `hdfs dfs -put -f archivo.csv /user/root/ml/`. Para leer de `/datos` sin HDFS: no se puede con YARN, porque los executors no ven tu carpeta |
| `java.lang.OutOfMemoryError` o un executor que se muere | Cada executor tiene 512 MB (`conf/spark-defaults.conf`) | Para la práctica, achicar los datos o usar `.limit()`. Se puede pedir más al crear la sesión: `.config("spark.executor.memory", "1g")`, si YARN tiene lugar |
| `toPandas()` tarda una eternidad o tira el kernel | Trae **todo** al notebook | Agregar y filtrar en Spark primero; pasar a pandas solo el resultado chico |
| Un error con `numpy` al usar MLlib | Se instaló numpy 2 encima (`pip install -U ...`): Spark 3.5 no anda con numpy 2 | Recrear el contenedor (vuelve a la 1.26.4 de la imagen) |

Regla para el notebook: **una sola sesión de Spark a la vez, y
`spark.stop()` cuando terminás**. Mientras está abierta, ocupa memoria en YARN
aunque no esté haciendo nada.

## Python y JupyterLab

| Qué pasa | Por qué | Qué hacer |
|---|---|---|
| Instalé una librería con `pip install` y desapareció | Se instaló en el contenedor; `docker rm` lo borra | Volver a instalarla después de recrearlo. Para no repetirlo, anotá las que usás en un `requirements.txt` en `/datos` y `pip install -r requirements.txt` |
| `pip install` dice que no encuentra la librería o no conecta | El contenedor no tiene internet, o la versión no existe para Python 3.12 | Revisar la conexión. Lo de la imagen (tabla del [README de ml](README.md)) anda sin internet |
| Un notebook dice *Kernel Restarting* o *The kernel appears to have died* | Casi siempre, falta de memoria: una tabla muy grande, o Spark y pandas con mucho a la vez | Liberar (cerrar notebooks que no usás: *Kernel → Shut Down All Kernels*), achicar los datos o darle más RAM a Docker. Después de reiniciar el kernel, las variables se pierden: correr las celdas de nuevo desde arriba |
| `FileNotFoundError: clientes_senal.csv` | El notebook no está en `/datos`, o no corriste el generador | Los ejemplos se corren en `/datos`. En el notebook: `import os; os.getcwd()`. Generar con `python3 ejemplos/ml/generar_senal.py` |
| Se perdieron los ejemplos de `ejemplos/ml` o los modifiqué | Los ejemplos se copian a `/datos/ejemplos` al arrancar, **sin pisar** los que ya están | Borrar el archivo y reiniciar el contenedor (`docker restart bigdata`): vuelve el original |
| `ServerSelectionTimeoutError` al conectar a MongoDB | MongoDB está apagado | Recrear con `-e MONGODB=si` ([guía 6](06-mongodb-pandas.md)) |
| Un gráfico de matplotlib no aparece | En un script suelto no hay pantalla | En JupyterLab aparece solo. En un script, guardarlo: `plt.savefig("grafico.png")`, como hace `modelos_sklearn.py` |

## Memoria

`ml` pide **7 GB** de RAM para Docker (tabla del [README de ml](README.md)):
JupyterLab y cada kernel abierto se suman a lo de `base`. Si tu compu no da:

- `-e JUPYTER=no` y trabajar con scripts por la terminal: ahorra lo de
  JupyterLab.
- Cerrar los kernels que no usás (cada notebook abierto es un proceso
  Python con sus datos en memoria).
- Para las guías 2, 4 y 6, que no usan Hadoop, alcanza con
  `-e SERVICIOS=hdfs`: no prende YARN ni Spark. Para la 3 y la 5 hace falta
  `SERVICIOS=todo`.

## Volver a empezar

Lo que generan los ejemplos de `ml` está en `/datos` (CSV, Parquet, JSON,
PNG) y en HDFS, en `/user/root/ml`. Para borrar solo eso:

<!-- prueba: adentro -->
```bash
hdfs dfs -rm -r -f /user/root/ml
rm -f ventas_sucias.csv ventas_limpias.parquet clientes_senal.csv \
      metricas_sklearn.json metricas_spark.json clusters_sklearn.png
```

Para empezar de cero todo el cluster, ver la
[guía 11 de base](../11-problemas.md).

[← 6. MongoDB + pandas](06-mongodb-pandas.md) · [Índice de ml](README.md)
