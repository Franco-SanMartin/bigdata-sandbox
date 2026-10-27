"""sandbox_ml: el apoyo chico del estudio de ML de BigData Sandbox (versiones ml y full).

    catalogo   modelos con el esquema completo de sus hiperparámetros, métricas,
               preprocesamiento, particiones y búsquedas (solo datos)
    receta     el JSON que describe un experimento: normalizar y validar
    codigo     receta → script de scikit-learn o PySpark completo, y a notebook
    estudio    lo que llama el script al final: registra el experimento
    perfil     perfil de columnas de un CSV, Parquet o tabla de Hive
    predecir   predecir con un modelo guardado

Un ejemplo desde JupyterLab (versión ml):

    from sandbox_ml import receta, codigo
    r = receta.validar({
        "datos": {"origen": "local", "ruta": "/datos/clientes_senal.csv"},
        "tarea": "clasificacion", "objetivo": "vuelve",
        "columnas": {"antiguedad_meses": "numerica", "visitas_mes": "numerica", "reclamos": "numerica"},
        "modelo": {"id": "bosque_clf", "params": {"n_estimators": 200}},
    })
    print(codigo.generar(r))

Importar el paquete no carga scikit-learn ni Spark (el servidor de :full lo usa
solo para el catálogo, validar y generar el código).
"""
__version__ = "1.0.0"
