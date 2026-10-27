# 1. Arrancar `ml` y entrar a JupyterLab

Crear el contenedor con la imagen `ml`, comprobar que JupyterLab está
prendido, abrirlo en el navegador y correr el primer notebook. Al final,
dónde está cada cosa y cómo se trabaja: notebook, terminal de JupyterLab o
`docker exec`.

[Índice de ml](README.md) · Siguiente: [2. Datos sucios y ETL con pandas →](02-datos-sucios-pandas.md)

## Antes de empezar

- Docker instalado y con **7 GB** de RAM ([guía 1](../01-instalacion.md)).
- Una carpeta de trabajo con una terminal parada ahí (la misma de la
  [guía 2](../02-arrancar-y-apagar.md#crear-el-cluster-una-sola-vez), si ya la
  tenés).
- La imagen: `docker pull franki678/bigdata-sandbox:ml` (1,58 GB). Si ya
  bajaste `base`, Docker reusa lo que tienen en común y baja solo lo que
  agrega `ml`.

<!-- prueba: no (en la prueba ya esta la imagen a probar: un pull la pisaria con la publicada) -->
```bash
docker pull franki678/bigdata-sandbox:ml
```

Instalar Docker y pasarse la imagen entre compañeros (`docker save` /
`docker load`) está en la [guía 1 de base](../01-instalacion.md): vale igual,
cambiando `:base` por `:ml`. El archivo del aula trae solo `:base`: `ml` se
baja de Docker Hub o de un compañero.

## Si ya tenías el contenedor de `base`

El contenedor se llama `bigdata` en las dos versiones. Para pasar a `ml`, se
borra el **contenedor** (no el volumen) y se crea de nuevo con la imagen
nueva: HDFS, las tablas de Hive y las bases de MySQL y MongoDB quedan, porque
viven en el volumen `bigdata_hadoop`. Es lo mismo que
[cambiar los parámetros](../02-arrancar-y-apagar.md#cambiar-los-parámetros).

<!-- prueba: no (solo hace falta si ya existía el contenedor de base) -->
```bash
docker rm -f bigdata
```

Si nunca creaste uno, salteá este paso.

## Crear el contenedor

Es el `docker run` de la guía 2 con dos cambios: un puerto más,
`-p 127.0.0.1:8888:8888` (JupyterLab), y el tag `:ml` al final. Elegí el de
**tu** consola.

Mac / Linux:

<!-- prueba: compu -->
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

Windows, PowerShell (una sola línea):

<!-- prueba: no (PowerShell; es el mismo comando que el de Mac/Linux) -->
```powershell
docker run -d --name bigdata --stop-timeout 20 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 -p 127.0.0.1:8888:8888 -v bigdata_hadoop:/hadoop -v "${PWD}/datos:/datos" franki678/bigdata-sandbox:ml
```

Windows, CMD (una sola línea):

<!-- prueba: no (CMD de Windows; es el mismo comando que el de Mac/Linux) -->
```bat
docker run -d --name bigdata --stop-timeout 20 -e DATANODES=3 -e REPLICATION=2 -e BLOCK_SIZE=1m -e MONGODB=si -p 127.0.0.1:9870:9870 -p 127.0.0.1:9868:9868 -p 127.0.0.1:9901-9909:9901-9909 -p 127.0.0.1:8088:8088 -p 127.0.0.1:8042:8042 -p 127.0.0.1:19888:19888 -p 127.0.0.1:10000:10000 -p 127.0.0.1:10002:10002 -p 127.0.0.1:18080:18080 -p 127.0.0.1:4040:4040 -p 127.0.0.1:3306:3306 -p 127.0.0.1:27017:27017 -p 127.0.0.1:8888:8888 -v bigdata_hadoop:/hadoop -v "%cd%\datos:/datos" franki678/bigdata-sandbox:ml
```

Lo que cambia respecto de `base`:

| Parte | Qué hace |
|---|---|
| `-p 127.0.0.1:8888:8888` | JupyterLab en http://localhost:8888, visible **solo** desde tu compu |
| `-e MONGODB=si` | Lo usa la [guía 6](06-mongodb-pandas.md). Si no vas a hacerla, sacalo y ahorrás ~1 GB de RAM |
| `franki678/bigdata-sandbox:ml` | La imagen `ml` |

Un parámetro más, que solo existe en `ml`:

| Parámetro | Qué elige | Por defecto | Valores |
|---|---|---|---|
| `JUPYTER` | Prender JupyterLab al arrancar | `si` | `si`, `no` |

Con `-e JUPYTER=no` no se prende (ahorra RAM; los scripts de
`ejemplos/ml` andan igual con `python3`). Si el valor está mal escrito, el
contenedor se apaga y `docker logs bigdata` dice
`[sandbox] ERROR: JUPYTER=...: tiene que ser si o no`.

## Esperar el cartel "Cluster LISTO"

Igual que en `base`: la primera vez tarda 2-3 minutos.

<!-- prueba: no (sigue el log hasta Ctrl+C; la prueba espera el cartel sola) -->
```bash
docker logs -f bigdata
```

Entre los pasos del arranque aparece `Arrancando JupyterLab...`. Si no
levantara, el log lo dice con un `AVISO: JupyterLab no levanto: revisar
/var/log/jupyter.log` (ver [problemas](07-problemas.md)). `Ctrl+C` sale del
log; el cluster sigue prendido.

<!-- prueba: esperar listo -->

## Comprobar que está todo

`estado` (adentro del contenedor, o desde tu compu con `docker exec`) tiene
en `ml` una parte más, **Python para datos**, con JupyterLab en el puerto
8888 y una línea para `python3` con los ejemplos en `/datos/ejemplos/ml`:

<!-- prueba: compu | espera: JupyterLab | espera: Version de la imagen: ml -->
```bash
docker exec bigdata estado
```

La última línea dice la versión de la imagen: `Version de la imagen: ml`. Si
dice `base`, el contenedor se creó con la otra imagen.

Ahora adentro. Los ejemplos de `ml` están al lado de los de `base`:

<!-- prueba: adentro | espera: generar_sucios.py | espera: modelos_spark.py -->
```bash
ls ejemplos/ml
```

Son siete: `generar_sucios.py`, `etl_pandas.py`, `etl_spark.py`,
`generar_senal.py`, `modelos_sklearn.py`, `modelos_spark.py` y
`mongo_pandas.py`. La [referencia](referencia.md#los-scripts-de-ejemplosml)
dice qué hace cada uno.

Las librerías y sus versiones, desde Python:

<!-- prueba: adentro | espera: numpy 1.26.4 | espera: scikit-learn 1.9.1 -->
```bash
python3 -c "import numpy, pandas, sklearn, pyspark; print('numpy', numpy.__version__); print('pandas', pandas.__version__); print('scikit-learn', sklearn.__version__); print('pyspark', pyspark.__version__)"
```

`import pyspark` anda con el `python3` común (no hace falta `spark-submit`)
porque la imagen deja puesto el `PYTHONPATH` de Spark.

Y que JupyterLab contesta (es lo mismo que comprueba la prueba de la imagen,
`pruebas/probar_ml.sh`):

<!-- prueba: adentro | espera: "version" -->
```bash
curl -s http://localhost:8888/api
```

Devuelve un JSON chico con la versión del servidor de Jupyter. Si contesta
sin pedir nada, es que está sin token, como tiene que estar.

## Abrir JupyterLab

En el navegador de tu compu: **http://localhost:8888**. Entra directo, sin
token ni contraseña.

- A la izquierda, el **explorador de archivos**: arranca en `/datos`, o sea tu
  carpeta `datos/`. Ahí están `ejemplos/` y ahí se guardan tus notebooks (y
  los ves también desde tu compu).
- En el centro, el **Launcher**: *Notebook → Python 3 (ipykernel)* crea un
  notebook nuevo; *Terminal* abre una consola bash **adentro** del contenedor
  (es lo mismo que `docker exec -it bigdata bash`).

Un notebook es una lista de **celdas**. Cada celda de código se corre con
`Shift+Enter` y lo que devuelve la última línea aparece abajo. Las variables
quedan vivas entre celdas mientras el notebook está abierto (lo que lleva eso
adentro es el **kernel**: un proceso de Python por notebook).

## El primer notebook

Creá un notebook (*Notebook → Python 3*), guardalo como `primero.ipynb` y
escribí en la primera celda:

<!-- prueba: no (celda de JupyterLab) -->
```python
import numpy as np
import pandas as pd

tabla = pd.DataFrame({"producto": ["yerba", "mate", "termo"],
                      "precio": [2500, 8000, 35000]})
tabla["con_iva"] = np.round(tabla["precio"] * 1.21)
tabla
```

`Shift+Enter`: abajo aparece la tabla con tres filas y la columna nueva
`con_iva`. Es un **DataFrame** de pandas: una tabla en la memoria del
contenedor.

Un gráfico, en la celda siguiente:

<!-- prueba: no (celda de JupyterLab) -->
```python
import matplotlib.pyplot as plt

tabla.plot(x="producto", y="precio", kind="bar", legend=False)
plt.ylabel("pesos")
plt.show()
```

El gráfico de barras aparece adentro del notebook.

Y Spark desde el mismo notebook. La sesión se pide a YARN igual que con
`spark-submit` (por eso tarda unos segundos):

<!-- prueba: no (celda de JupyterLab) -->
```python
from pyspark.sql import SparkSession

spark = SparkSession.builder.appName("primer notebook").getOrCreate()
print(spark.sparkContext.master, spark.version)
spark.range(1000).selectExpr("sum(id)").show()
```

Tiene que decir `yarn 3.5.9` y la suma, `499500`. Mientras la sesión está
abierta, el trabajo aparece en http://localhost:8088 como una aplicación
`SPARK` y su detalle en http://localhost:4040.

Al terminar, **cerrá la sesión**: ocupa memoria de YARN y, si queda abierta,
el próximo `spark-submit` puede quedarse en `ACCEPTED` esperando lugar.

<!-- prueba: no (celda de JupyterLab) -->
```python
spark.stop()
```

## Tres formas de trabajar, la misma máquina

| Forma | Cómo | Conviene para |
|---|---|---|
| Notebook | JupyterLab, celdas de Python | Explorar datos, gráficos, probar de a pasos |
| Terminal de JupyterLab | *Launcher → Terminal* | Comandos (`hdfs`, `spark-submit`, `python3 script.py`) sin salir del navegador |
| `docker exec -it bigdata bash` | Desde tu compu | Lo mismo que la terminal de JupyterLab |

Las guías que siguen corren los scripts de `ejemplos/ml` desde la terminal
(cualquiera de las dos), parados en `/datos`, y después miran los resultados
en un notebook. Si la terminal de JupyterLab no abre en `/datos`, `cd /datos`.

## Apagar y volver a prender

Igual que en `base`: `docker stop bigdata` al terminar y `docker start
bigdata` en la clase siguiente. JupyterLab vuelve a prenderse solo. Los
notebooks que guardaste en `/datos` quedan en tu carpeta `datos/`; lo que
tenía cargado cada kernel (las variables) se pierde: hay que volver a correr
las celdas.

## Qué hiciste

- Creaste el contenedor `bigdata` con la imagen `ml` y el puerto 8888.
- Comprobaste con `estado`, `ls ejemplos/ml`, las versiones de las librerías
  y la API de JupyterLab que está todo.
- Corriste pandas, matplotlib y Spark desde un notebook.

Siguiente: [2. Datos sucios y ETL con pandas →](02-datos-sucios-pandas.md)
