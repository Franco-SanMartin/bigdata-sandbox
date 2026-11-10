# 8. El estudio de ML desde JupyterLab (sandbox_ml)

Lo que hace la pantalla de ML de `full` también se puede hacer en `ml`, sin
interfaz, con el paquete `sandbox_ml` desde un notebook o la terminal:
- generar datos a escala en HDFS;
- describir el experimento como una receta y sacar su script de PySpark;
- correrlo en YARN;
- guardar el modelo en la biblioteca;
- predecir por lotes midiendo la deriva.

[← 7. Problemas de `ml`](07-problemas.md) · [Índice de ml](README.md)

## Antes de empezar

El contenedor `ml` con el cluster prendido (guía 1). `sandbox_ml` ya está en el
`PYTHONPATH` (`/opt/sandbox/ml`): no hay que instalar nada. Los bloques de
`python` van en un notebook de JupyterLab; los de `bash`, en su terminal.

## Paso 1. Datos a escala

<!-- prueba: no (corre en ml o full con el cluster arriba; lo prueba el humo de full) -->
```bash
spark-submit --master yarn /opt/sandbox/ml/sandbox_ml/generar.py clientes \
  --filas 1000000 --salida /user/root/ml/generado/clientes_1m --suciedad 0.05
```

**Qué significa.** El trabajo de Spark escribe un millón de clientes con las
reglas de `generar_senal.py` (guía 4): se sabe qué tiene que aprender el modelo.
La suciedad agrega nulos, extremos, texto desprolijo y filas repetidas. Cada
executor genera su parte: no pasa nada por una sola máquina.

## Paso 2. La receta y su código

<!-- prueba: no (bloque de un notebook de JupyterLab) -->
```python
from sandbox_ml import codigo, receta

r = receta.validar({
    "datos": {"origen": "hdfs", "ruta": "/user/root/ml/generado/clientes_1m", "formato": "parquet"},
    "tarea": "clasificacion", "objetivo": "vuelve",
    "columnas": {"cliente_id": "id", "antiguedad_meses": "numerica", "visitas_mes": "numerica",
                 "ticket_promedio": "numerica", "reclamos": "numerica", "edad": "numerica",
                 "segmento_real": "categorica", "gasto_mes_siguiente": "ignorar", "anio": "ignorar", "mes": "ignorar"},
    "modelo": {"id": "logistica_spark"},
    "limpieza": {"pasos": [{"tipo": "nulos", "columna": "edad", "estrategia": "mediana"},
                           {"tipo": "texto", "columna": "segmento_real", "ops": ["recortar", "minusculas"]}]},
})
open("/datos/churn.py", "w").write(codigo.generar(r))
```

**Qué significa.** La receta es el mismo JSON que arma la pantalla.
`receta.validar` completa lo que falta con los valores de fábrica:
- entrenamiento, validación y prueba 70 / 15 / 15;
- el umbral por F1;
- los recursos de YARN.

Si algo no cierra, avisa: una fuga del objetivo, una columna id o clases
desbalanceadas. `codigo.generar` devuelve el script de PySpark completo, para
leerlo y correrlo.

## Paso 3. Correrlo en YARN y ver los experimentos

<!-- prueba: no (necesita el script del paso 2) -->
```bash
spark-submit --master yarn --num-executors 2 --executor-memory 1g /datos/churn.py
```

<!-- prueba: no (bloque de un notebook de JupyterLab) -->
```python
from sandbox_ml import estudio
estudio.tabla("clasificacion")       # la tabla de posiciones, como DataFrame
```

**Qué significa.** El script registra la corrida en `/hadoop/ml/experimentos`
con sus métricas, su informe y `referencia.json`: cómo se distribuye cada
variable en el entrenamiento, para medir la deriva después. Es la misma
carpeta que lee la pantalla *Experimentos* de `full`.

## Paso 4. La biblioteca

<!-- prueba: no (bloque de un notebook de JupyterLab; necesita el experimento del paso 3) -->
```python
from sandbox_ml import biblioteca

exp = estudio.experimentos()[0]["id"]          # el más nuevo
biblioteca.registrar("churn", f"/hadoop/ml/experimentos/{exp}", nota="logística con 1 millón de clientes")
biblioteca.promover("churn", 1, nota="primera en producción")
biblioteca.listar()
```

**Qué significa.** Una versión copia lo que hace falta para usarla después (el
modelo, el código, la referencia de la deriva) y anota su linaje. Promover
archiva la versión que estaba en producción, y `volver_atras` promueve la
anterior.

Fuera de `full`, el modelo de Spark se copia a mano a la carpeta de la
biblioteca en HDFS: `registrar(..., modelo_hdfs=...)`. La pantalla lo hace sola.

## Paso 5. Predecir por lotes con la deriva

<!-- prueba: no (bloque de un notebook de JupyterLab; necesita la biblioteca del paso 4) -->
```python
from pathlib import Path
from sandbox_ml import lote

m, x = biblioteca.elegir("churn")              # la versión en producción
datos = {"origen": "hdfs", "ruta": "/user/root/ml/generado/clientes_1m", "formato": "parquet"}
salida, _ = lote.normalizar_salida({"ruta": "/user/root/ml/predicciones/churn"}, "churn", x["version"])
Path("/datos/lote.py").write_text(lote.generar(x, biblioteca.carpeta_version("churn", x["version"]), datos, salida, nombre="churn"))
```

<!-- prueba: no (necesita el script de arriba) -->
```bash
spark-submit --master yarn /datos/lote.py | grep -E "deriva de|predicciones en"
```

**Qué significa.** El script hace todo en el cluster:
1. Revisa que vengan las columnas que el modelo usa.
2. Mide la deriva de cada variable con el PSI.
3. Predice con el `PipelineModel`, que trae la limpieza adentro.
4. Escribe las columnas originales más la predicción.

El PSI de cada variable dice cuánto se parecen los datos nuevos a los del
entrenamiento:
- menos de 0,1 es estable;
- más de 0,25, el modelo está prediciendo sobre otra población.

## Dónde se usa esto en la industria

Es el ciclo de MLOps con las piezas a la vista:
- datos sintéticos para probar a escala;
- un pipeline reproducible (la receta);
- un registro de modelos (MLflow, en la industria);
- monitoreo de deriva (Evidently, WhyLabs);
- predicción por lotes con Spark sobre el data lake.

La [guía 13 de `full`](../full/13-estudio-ml.md) hace lo mismo con la pantalla.
