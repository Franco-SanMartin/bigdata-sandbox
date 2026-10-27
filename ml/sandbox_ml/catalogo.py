"""Catálogo del estudio de ML: modelos con el esquema COMPLETO de sus
hiperparámetros, métricas, preprocesamiento, particiones, validación cruzada y
búsquedas. Es solo datos (sin importar scikit-learn ni Spark): lo lee el
servidor de :full para armar la pantalla y validar, y lo usan los scripts de
:ml con sandbox_ml.catalogo.

Cada hiperparámetro dice:

    nombre      el de la librería (scikit-learn o Spark MLlib), tal cual
    tipo        int, float, choice, bool, layers (capas de una red: "64,32") o str
    defecto     el valor por defecto que usa el estudio (casi siempre el de la librería)
    min / max   el rango permitido; log=True si conviene recorrerlo en escala logarítmica
    nulo        si acepta None (sin límite, automático...) y cómo se llama eso
    opciones    para choice: [{valor, etiqueta}]
    ayuda       qué hace, qué efecto tiene al subirlo/bajarlo y el rango sugerido
    grupo       para ordenar el formulario (Arquitectura, Optimizador...)
    si          se usa solo cuando otro parámetro vale algo: {"solver": ["sgd"]}
    buscar      valores sugeridos para una búsqueda en grilla
"""
from __future__ import annotations

import copy

VERSION = 1

TAREAS = {
    "regresion": {"etiqueta": "Regresión", "que": "Predecir un número (el gasto, un precio, una temperatura)"},
    "clasificacion": {"etiqueta": "Clasificación", "que": "Predecir una categoría (vuelve o no, el tipo de cliente)"},
    "clustering": {"etiqueta": "Agrupamiento", "que": "Encontrar grupos parecidos sin una columna objetivo"},
    "reduccion": {"etiqueta": "Reducción de dimensión", "que": "Resumir muchas columnas en pocas (PCA)"},
}

ROLES = {
    "numerica": "Número que se usa como variable (se imputa, se recorta y se escala)",
    "categorica": "Categoría: se codifica (one-hot u ordinal)",
    "fecha": "Fecha u hora: se separa en año, mes, día de la semana y hora",
    "texto": "Texto libre: se pasa a TF-IDF (palabras más informativas)",
    "id": "Identificador: no se usa para entrenar (memorizarlo no generaliza)",
    "ignorar": "No se usa",
}


def _p(nombre, tipo, defecto, que, efecto, rango, **kw):
    p = {"nombre": nombre, "tipo": tipo, "defecto": defecto,
         "ayuda": {"que": que, "efecto": efecto, "rango": rango}}
    p.update({k: v for k, v in kw.items() if v is not None})
    return p


def entero(nombre, defecto, minimo, maximo, que, efecto, rango, **kw):
    return _p(nombre, "int", defecto, que, efecto, rango, min=minimo, max=maximo, **kw)


def real(nombre, defecto, minimo, maximo, que, efecto, rango, **kw):
    return _p(nombre, "float", defecto, que, efecto, rango, min=minimo, max=maximo, **kw)


def opcion(nombre, defecto, opciones, que, efecto, rango, **kw):
    ops = [{"valor": o[0], "etiqueta": o[1]} if isinstance(o, tuple) else {"valor": o, "etiqueta": str(o)}
           for o in opciones]
    return _p(nombre, "choice", defecto, que, efecto, rango, opciones=ops, **kw)


def booleano(nombre, defecto, que, efecto, rango, **kw):
    return _p(nombre, "bool", defecto, que, efecto, rango, **kw)


def capas(nombre, defecto, que, efecto, rango, **kw):
    return _p(nombre, "layers", defecto, que, efecto, rango, **kw)


# ---------------------------------------------------------------- piezas que se repiten

def _arbol(criterios, defecto_criterio, clasif):
    return [
        opcion("criterion", defecto_criterio, criterios,
               "Cómo mide qué tan buena es una división en cada nodo.",
               "Cambia poco el resultado; " + ("entropy y log_loss tienden a árboles un poco más equilibrados."
                                               if clasif else "absolute_error es más robusto a outliers pero mucho más lento."),
               "El de por defecto anda bien casi siempre.", grupo="Árbol"),
        entero("max_depth", None, 1, 100, "Profundidad máxima: cuántas preguntas seguidas puede hacer el árbol.",
               "Más profundo = aprende más detalle y se sobreajusta más; menos profundo = más simple y estable.",
               "3 a 12 para leerlo; sin límite si lo controlan min_samples_leaf o la poda.",
               nulo="sin límite", grupo="Árbol", buscar=[3, 5, 8, 12, None]),
        entero("min_samples_split", 2, 2, 1000, "Filas mínimas que tiene que tener un nodo para dividirse.",
               "Más alto = menos divisiones, árbol más chico y menos sobreajuste.", "2 a 50.",
               grupo="Árbol", buscar=[2, 10, 50]),
        entero("min_samples_leaf", 1, 1, 1000, "Filas mínimas en cada hoja.",
               "Es el freno más efectivo contra el sobreajuste: hojas con pocas filas memorizan ruido.",
               "1 a 50; con datos ruidosos, 5 a 20.", grupo="Árbol", buscar=[1, 5, 20]),
        opcion("max_features", None,
               [(None, "todas"), ("sqrt", "raíz cuadrada"), ("log2", "log2")],
               "Cuántas columnas mira en cada división (elegidas al azar).",
               "Menos columnas = árboles más distintos entre sí y más rápidos; en un árbol solo, más azar.",
               "todas en un árbol solo; sqrt en bosques.", grupo="Árbol"),
        real("ccp_alpha", 0.0, 0.0, 1.0, "Poda por costo-complejidad: saca ramas que mejoran poco.",
             "Más alto = árbol más podado y simple.", "0 (sin poda) a 0,02; probá en escala log.",
             grupo="Regularización", buscar=[0.0, 0.001, 0.01]),
    ]


def _bosque(clasif, defecto_feats):
    crit = ([("gini", "Gini"), ("entropy", "entropía"), ("log_loss", "log loss")] if clasif else
            [("squared_error", "error cuadrático"), ("absolute_error", "error absoluto"), ("friedman_mse", "Friedman MSE"),
             ("poisson", "Poisson")])
    return [
        entero("n_estimators", 100, 1, 2000, "Cuántos árboles tiene el bosque.",
               "Más árboles = predicción más estable (nunca sobreajusta por esto) pero tarda y pesa más.",
               "100 a 500.", grupo="Ensamble", buscar=[100, 200, 400]),
        opcion("criterion", crit[0][0], crit, "Cómo mide la calidad de cada división.", "Cambia poco el resultado.",
               "El de por defecto.", grupo="Árbol"),
        entero("max_depth", None, 1, 100, "Profundidad máxima de cada árbol.",
               "Sin límite los árboles memorizan, pero el promedio del bosque lo compensa; limitarla ahorra memoria.",
               "sin límite, o 8 a 20 para un modelo más liviano.", nulo="sin límite", grupo="Árbol",
               buscar=[None, 8, 16]),
        entero("min_samples_leaf", 1, 1, 1000, "Filas mínimas en cada hoja.",
               "Más alto = árboles más simples, menos memoria y menos sobreajuste.", "1 a 10.", grupo="Árbol",
               buscar=[1, 3, 10]),
        entero("min_samples_split", 2, 2, 1000, "Filas mínimas para dividir un nodo.", "Más alto = árboles más chicos.",
               "2 a 20.", grupo="Árbol"),
        opcion("max_features", defecto_feats, [("sqrt", "raíz cuadrada"), ("log2", "log2"), (1.0, "todas"), (0.5, "la mitad")],
               "Cuántas columnas al azar mira cada división.",
               "Menos columnas = árboles más distintos (el bosque mejora) y más rápidos; demasiado pocas pierde señal.",
               "sqrt en clasificación; 1,0 o 0,5 en regresión.", grupo="Árbol", buscar=["sqrt", 0.5, 1.0]),
        booleano("bootstrap", True,
                 "Cada árbol entrena con una muestra con reemplazo de las filas.",
                 "Sin bootstrap cada árbol ve todo: menos variedad entre árboles.", "Dejalo prendido.", grupo="Ensamble"),
        real("ccp_alpha", 0.0, 0.0, 1.0, "Poda por costo-complejidad de cada árbol.", "Más alto = árboles más simples.",
             "0 a 0,01.", grupo="Regularización"),
    ]


def _boosting(clasif):
    return [
        entero("n_estimators", 100, 1, 5000, "Cuántos árboles chicos se suman, uno corrigiendo al anterior.",
               "Más árboles = aprende más; demasiados con learning_rate alto sobreajusta.",
               "100 a 1000 (con learning_rate más chico, más árboles).", grupo="Ensamble", buscar=[100, 300]),
        real("learning_rate", 0.1, 0.001, 1.0, "Cuánto pesa cada árbol nuevo (el paso del descenso de gradiente).",
             "Más chico = aprende más despacio y generaliza mejor, pero necesita más árboles.", "0,01 a 0,2.",
             log=True, grupo="Optimizador", buscar=[0.03, 0.1, 0.3]),
        entero("max_depth", 3, 1, 32, "Profundidad de cada árbol.",
               "Árboles chicos (3 a 5) combinan bien; más profundos capturan interacciones y sobreajustan antes.",
               "2 a 6.", nulo="sin límite", grupo="Árbol", buscar=[2, 3, 5]),
        real("subsample", 1.0, 0.1, 1.0, "Fracción de filas al azar para cada árbol (stochastic gradient boosting).",
             "Menos de 1 agrega azar: suele generalizar mejor y es más rápido.", "0,5 a 1.", grupo="Ensamble"),
        entero("min_samples_leaf", 1, 1, 1000, "Filas mínimas en cada hoja.", "Más alto = menos sobreajuste.", "1 a 20.",
               grupo="Árbol"),
        opcion("max_features", None, [(None, "todas"), ("sqrt", "raíz cuadrada"), ("log2", "log2")],
               "Columnas al azar que mira cada división.", "Menos columnas = más rápido y más azar.", "todas.",
               grupo="Árbol"),
        entero("n_iter_no_change", None, 1, 100, "Parada temprana: corta si no mejora en este número de rondas (usa validation_fraction).",
               "Ahorra tiempo y evita sobreajuste.", "10 a 20, o apagado.", nulo="apagado", grupo="Parada"),
        real("validation_fraction", 0.1, 0.05, 0.5, "Fracción del entrenamiento que se aparta para la parada temprana.",
             "Más grande = parada más confiable, menos datos para aprender.", "0,1 a 0,2.", grupo="Parada",
             si={"n_iter_no_change": "no_nulo"}),
    ]


def _hist(clasif):
    ps = [
        real("learning_rate", 0.1, 0.001, 1.0, "Cuánto pesa cada árbol nuevo.",
             "Más chico = más estable, necesita más iteraciones.", "0,03 a 0,3.", log=True, grupo="Optimizador",
             buscar=[0.05, 0.1, 0.2]),
        entero("max_iter", 100, 1, 5000, "Cantidad máxima de árboles (rondas de boosting).",
               "Más rondas = aprende más; con parada temprana corta solo.", "100 a 1000.", grupo="Ensamble",
               buscar=[100, 300]),
        entero("max_leaf_nodes", 31, 2, 1024, "Hojas máximas por árbol (crece hoja por hoja).",
               "Más hojas = árboles más complejos.", "15 a 63.", nulo="sin límite", grupo="Árbol", buscar=[15, 31, 63]),
        entero("max_depth", None, 1, 100, "Profundidad máxima de cada árbol.", "Limitarla simplifica.", "sin límite o 3 a 10.",
               nulo="sin límite", grupo="Árbol"),
        entero("min_samples_leaf", 20, 1, 1000, "Filas mínimas por hoja.", "Más alto = menos sobreajuste.", "10 a 100.",
               grupo="Árbol", buscar=[10, 20, 50]),
        real("l2_regularization", 0.0, 0.0, 100.0, "Penalización L2 de los valores de las hojas.",
             "Más alta = predicciones más suaves y menos sobreajuste.", "0 a 10.", grupo="Regularización",
             buscar=[0.0, 0.1, 1.0]),
        entero("max_bins", 255, 2, 255, "En cuántos rangos parte cada columna numérica antes de entrenar (histogramas).",
               "Menos rangos = más rápido y más grueso.", "63 a 255.", grupo="Árbol"),
        opcion("early_stopping", "auto", [("auto", "automática (con más de 10.000 filas)"), (True, "sí"), (False, "no")],
               "Parada temprana con una parte del entrenamiento como validación.", "Ahorra tiempo y evita sobreajuste.",
               "auto.", grupo="Parada"),
        entero("n_iter_no_change", 10, 1, 100, "Rondas sin mejorar antes de cortar.", "Más alto = más paciencia.",
               "10 a 20.", grupo="Parada"),
    ]
    if clasif:
        ps.append(opcion("class_weight", None, [(None, "iguales"), ("balanced", "balanceadas")],
                         "Peso de cada clase al entrenar.",
                         "balanced le da más peso a las clases con pocas filas: sube el recall de la minoritaria.",
                         "balanced si una clase tiene menos del 20 %.", grupo="Clases"))
    return ps


def _mlp(clasif):
    return [
        capas("hidden_layer_sizes", "100",
              "Neuronas de cada capa oculta, separadas por coma: '64,32' son dos capas.",
              "Más neuronas o capas = puede aprender relaciones más complejas, tarda más y sobreajusta más fácil.",
              "Una o dos capas de 16 a 128; con pocos datos, chico.", grupo="Arquitectura",
              buscar=["32", "64,32", "100"]),
        opcion("activation", "relu", [("relu", "ReLU"), ("tanh", "tanh"), ("logistic", "sigmoide"), ("identity", "identidad")],
               "La función que aplica cada neurona a su suma.",
               "relu entrena rápido y es la de uso general; tanh y sigmoide se saturan; identidad hace la red lineal.",
               "relu.", grupo="Arquitectura", buscar=["relu", "tanh"]),
        opcion("solver", "adam", [("adam", "adam"), ("sgd", "SGD (descenso de gradiente)"), ("lbfgs", "L-BFGS")],
               "El optimizador que ajusta los pesos.",
               "adam anda bien con miles de filas; lbfgs converge mejor con pocos datos (menos de ~5.000); sgd necesita "
               "afinar learning_rate y momentum pero enseña bien cómo funciona.",
               "adam; lbfgs con datos chicos.", grupo="Optimizador", buscar=["adam", "lbfgs"]),
        real("alpha", 0.0001, 0.0, 10.0, "Regularización L2 de los pesos (weight decay).",
             "Más alto = pesos más chicos, red más simple, menos sobreajuste.", "1e-5 a 1e-1, en escala log.",
             log=True, grupo="Regularización", buscar=[0.0001, 0.001, 0.01]),
        opcion("batch_size", "auto", [("auto", "auto (min(200, filas))"), (32, "32"), (64, "64"), (128, "128"), (256, "256"),
                                      (512, "512")],
               "Filas por actualización de los pesos (mini-lote). No se usa con lbfgs.",
               "Lotes chicos = más ruido (a veces ayuda a generalizar) y más pasos por época; grandes = más estable.",
               "32 a 256.", grupo="Optimizador", si={"solver": ["adam", "sgd"]}),
        opcion("learning_rate", "constant", [("constant", "constante"), ("invscaling", "decreciente (invscaling)"),
                                             ("adaptive", "adaptativa")],
               "Cómo cambia el paso del aprendizaje con las épocas (solo SGD).",
               "adaptive lo divide por 5 cuando deja de mejorar: más estable que constante.",
               "constant o adaptive.", grupo="Optimizador", si={"solver": ["sgd"]}),
        real("learning_rate_init", 0.001, 0.00001, 1.0, "Tamaño del paso inicial al mover los pesos.",
             "Muy alto = la pérdida salta o diverge; muy bajo = aprende lentísimo.", "1e-4 a 1e-2 (adam); 0,01 a 0,1 (sgd).",
             log=True, grupo="Optimizador", si={"solver": ["adam", "sgd"]}, buscar=[0.0003, 0.001, 0.003]),
        real("momentum", 0.9, 0.0, 1.0, "Inercia de SGD: arrastra parte del paso anterior.",
             "Acelera y suaviza el descenso; 0 es SGD puro.", "0,8 a 0,99.", grupo="Optimizador", si={"solver": ["sgd"]}),
        booleano("nesterovs_momentum", True, "Momento de Nesterov: mira un paso adelante antes de corregir.",
                 "Suele converger algo más rápido que el momento clásico.", "Prendido.", grupo="Optimizador",
                 si={"solver": ["sgd"]}),
        real("beta_1", 0.9, 0.0, 0.999, "Adam: cuánto recuerda la dirección de los gradientes (primer momento).",
             "Más alto = más inercia.", "0,9.", grupo="Optimizador", si={"solver": ["adam"]}),
        real("beta_2", 0.999, 0.0, 0.99999, "Adam: cuánto recuerda el tamaño de los gradientes (segundo momento).",
             "Más alto = pasos más estables.", "0,999.", grupo="Optimizador", si={"solver": ["adam"]}),
        entero("max_iter", 200, 10, 10000, "Épocas máximas (lbfgs: iteraciones).",
               "Si avisa que no convergió, subilo o subí learning_rate_init.", "200 a 1000.", grupo="Parada",
               buscar=[200, 500]),
        real("tol", 0.0001, 0.0, 0.1, "Mejora mínima de la pérdida para seguir.", "Más alto = corta antes.",
             "1e-4.", log=True, grupo="Parada"),
        booleano("early_stopping", False,
                 "Parada temprana: aparta validation_fraction de las filas y corta cuando el puntaje no mejora.",
                 "Evita sobreajuste y ahorra épocas; con pocos datos le saca filas al entrenamiento.",
                 "Prendido con más de ~2.000 filas.", grupo="Parada", si={"solver": ["adam", "sgd"]}),
        real("validation_fraction", 0.1, 0.05, 0.5, "Fracción que se aparta para la parada temprana.",
             "Más grande = parada más confiable.", "0,1 a 0,2.", grupo="Parada", si={"early_stopping": [True]}),
        entero("n_iter_no_change", 10, 1, 200, "Épocas sin mejorar antes de cortar.", "Más alto = más paciencia.",
               "10 a 30.", grupo="Parada"),
    ]


def _xgb(clasif):
    ps = [
        entero("n_estimators", 200, 1, 5000, "Cuántos árboles (rondas de boosting).",
               "Más rondas = aprende más; con learning_rate chico hacen falta más.", "100 a 1000.", grupo="Ensamble",
               buscar=[100, 200, 400]),
        real("learning_rate", 0.1, 0.001, 1.0, "Cuánto pesa cada árbol nuevo (eta).",
             "Más chico = más estable y necesita más árboles.", "0,01 a 0,3.", log=True, grupo="Optimizador",
             buscar=[0.03, 0.1, 0.3]),
        entero("max_depth", 6, 1, 20, "Profundidad máxima de cada árbol.",
               "Más profundo = más interacciones y más sobreajuste.", "3 a 8.", grupo="Árbol", buscar=[3, 6, 8]),
        real("min_child_weight", 1.0, 0.0, 100.0, "Peso mínimo (≈ filas) en cada hoja.",
             "Más alto = árboles más conservadores.", "1 a 10.", grupo="Árbol"),
        real("subsample", 1.0, 0.1, 1.0, "Fracción de filas al azar por árbol.", "Menos de 1 agrega azar y suele generalizar mejor.",
             "0,6 a 1.", grupo="Ensamble", buscar=[0.7, 1.0]),
        real("colsample_bytree", 1.0, 0.1, 1.0, "Fracción de columnas al azar por árbol.", "Menos = árboles más distintos.",
             "0,5 a 1.", grupo="Ensamble", buscar=[0.7, 1.0]),
        real("gamma", 0.0, 0.0, 100.0, "Mejora mínima de la pérdida para dividir un nodo.", "Más alto = menos divisiones.",
             "0 a 5.", grupo="Regularización"),
        real("reg_alpha", 0.0, 0.0, 100.0, "Regularización L1 de los pesos de las hojas.", "Más alto = modelo más simple.",
             "0 a 1.", grupo="Regularización"),
        real("reg_lambda", 1.0, 0.0, 100.0, "Regularización L2 de los pesos de las hojas.", "Más alto = predicciones más suaves.",
             "1 a 10.", grupo="Regularización"),
        opcion("tree_method", "hist", [("hist", "histogramas"), ("exact", "exacto"), ("approx", "aproximado")],
               "Cómo busca los cortes.", "hist es el rápido; exact solo con pocos datos.", "hist.", grupo="Avanzado"),
    ]
    if clasif:
        ps.append(real("scale_pos_weight", 1.0, 0.01, 1000.0,
                       "Peso de la clase positiva (binaria): negativos / positivos compensa el desbalance.",
                       "Más alto = más recall de la clase positiva.", "1, o negativos/positivos si hay desbalance.",
                       log=True, grupo="Clases"))
    return ps


_KNN = [
    entero("n_neighbors", 5, 1, 500, "Cuántos vecinos más cercanos miran para predecir.",
           "Pocos = sigue el ruido (sobreajusta); muchos = predicción más suave (subajusta).",
           "3 a 50; probá impares en clasificación binaria.", grupo="Vecinos", buscar=[3, 5, 11, 25]),
    opcion("weights", "uniform", [("uniform", "iguales"), ("distance", "por distancia")],
           "Cuánto pesa cada vecino.", "distance hace pesar más a los más cercanos.", "Probá las dos.",
           grupo="Vecinos", buscar=["uniform", "distance"]),
    entero("p", 2, 1, 5, "Distancia de Minkowski: 1 = Manhattan, 2 = euclídea.",
           "Manhattan es menos sensible a una columna con diferencias grandes.", "1 o 2.", grupo="Vecinos"),
    opcion("algorithm", "auto", ["auto", "ball_tree", "kd_tree", "brute"],
           "Cómo busca los vecinos (no cambia el resultado, solo la velocidad).", "auto elige solo.", "auto.",
           grupo="Avanzado"),
    entero("leaf_size", 30, 1, 500, "Tamaño de hoja de los árboles de búsqueda.", "Solo cambia velocidad y memoria.", "30.",
           grupo="Avanzado"),
]


def _svm(clasif):
    ps = [
        real("C", 1.0, 0.0001, 10000.0, "Cuánto castiga los errores: el inverso de la regularización.",
             "Más alto = ajusta más a los datos (puede sobreajustar); más bajo = margen más ancho y simple.",
             "0,1 a 100, en escala log.", log=True, grupo="Regularización", buscar=[0.1, 1, 10]),
        opcion("kernel", "rbf", [("rbf", "RBF (gaussiano)"), ("linear", "lineal"), ("poly", "polinomial"),
                                 ("sigmoid", "sigmoide")],
               "La forma de la frontera: el truco del kernel.",
               "rbf hace fronteras curvas; linear es rápido con muchas columnas; poly según degree.", "rbf o linear.",
               grupo="Kernel", buscar=["rbf", "linear"]),
        opcion("gamma", "scale", [("scale", "scale (1 / (columnas · varianza))"), ("auto", "auto (1 / columnas)"),
                                  (0.01, "0,01"), (0.1, "0,1"), (1.0, "1")],
               "Alcance de cada punto en el kernel RBF/poly/sigmoide.",
               "Alto = cada punto influye poco lejos (fronteras muy curvas, sobreajusta); bajo = fronteras suaves.",
               "scale; buscá 0,001 a 1.", grupo="Kernel", si={"kernel": ["rbf", "poly", "sigmoid"]},
               buscar=["scale", 0.01, 0.1]),
        entero("degree", 3, 1, 10, "Grado del polinomio (kernel poly).", "Más alto = fronteras más retorcidas.", "2 o 3.",
               grupo="Kernel", si={"kernel": ["poly"]}),
        real("coef0", 0.0, -10.0, 10.0, "Término independiente de los kernels poly y sigmoide.", "Ajuste fino.", "0 a 1.",
             grupo="Kernel", si={"kernel": ["poly", "sigmoid"]}),
        real("tol", 0.001, 0.000001, 0.1, "Tolerancia para dar por terminado.", "Más alto = termina antes.", "1e-3.",
             log=True, grupo="Avanzado"),
        entero("max_iter", -1, -1, 1000000, "Iteraciones máximas (-1 = sin límite).",
               "Con muchos datos SVC tarda en cuadrado de las filas: limitalo para cortar.", "-1.", grupo="Avanzado"),
    ]
    if clasif:
        ps.append(opcion("class_weight", None, [(None, "iguales"), ("balanced", "balanceadas")],
                         "Peso de cada clase.", "balanced ayuda a la clase minoritaria.", "balanced si hay desbalance.",
                         grupo="Clases"))
    else:
        ps.insert(1, real("epsilon", 0.1, 0.0, 100.0, "Ancho del tubo sin penalización: errores menores no cuentan.",
                          "Más ancho = menos vectores de soporte y modelo más simple. Está en la unidad del objetivo.",
                          "Del orden del ruido del objetivo.", grupo="Regularización"))
    return ps


_CLASS_WEIGHT = opcion("class_weight", None, [(None, "iguales"), ("balanced", "balanceadas")],
                       "Peso de cada clase al entrenar.",
                       "balanced compensa clases con pocas filas: sube el recall de la minoritaria a costa de la precisión.",
                       "balanced si una clase tiene menos del 20 %.", grupo="Clases", buscar=[None, "balanced"])


def _m(id_, motor, tarea, clase, etiqueta, familia, que, params, **kw):
    d = {"id": id_, "motor": motor, "tarea": tarea, "clase": clase, "etiqueta": etiqueta, "familia": familia,
         "que": que, "params": params}
    d.update(kw)
    return d


# ---------------------------------------------------------------- scikit-learn

SKLEARN = [
    # ------------------------------------------------ regresión
    _m("base_reg", "sklearn", "regresion", "sklearn.dummy.DummyRegressor", "Línea base (siempre el promedio)", "Línea base",
       "Predice siempre el promedio (o la mediana): cualquier modelo que no le gane no sirve.",
       [opcion("strategy", "mean", [("mean", "promedio"), ("median", "mediana")], "Qué número devuelve siempre.",
               "La mediana resiste outliers.", "mean.")],
       escala=False, importancia=None, costo="mínimo"),
    _m("lineal", "sklearn", "regresion", "sklearn.linear_model.LinearRegression", "Regresión lineal", "Lineal",
       "Suma de columnas por coeficientes (mínimos cuadrados). Rápida y se puede leer; no ve curvas ni interacciones.",
       [booleano("fit_intercept", True, "Agrega el término constante (la ordenada al origen).",
                 "Sin él la recta pasa por cero: casi siempre conviene dejarlo.", "Prendido."),
        booleano("positive", False, "Obliga a que todos los coeficientes sean positivos.",
                 "Útil si sabés que ninguna variable puede restar.", "Apagado.")],
       escala=False, importancia="coef", costo="mínimo"),
    _m("ridge", "sklearn", "regresion", "sklearn.linear_model.Ridge", "Ridge (lineal con L2)", "Lineal",
       "Regresión lineal que achica los coeficientes: más estable con columnas correlacionadas.",
       [real("alpha", 1.0, 0.0, 100000.0, "Fuerza de la regularización L2.",
             "Más alto = coeficientes más chicos, menos varianza y más sesgo. 0 es la lineal común.",
             "0,01 a 100, en escala log.", log=True, grupo="Regularización", buscar=[0.1, 1, 10, 100]),
        opcion("solver", "auto", ["auto", "svd", "cholesky", "lsqr", "sparse_cg", "sag", "saga"],
               "Algoritmo que resuelve el ajuste.", "No cambia el resultado (salvo por tolerancia), sí la velocidad.",
               "auto.", grupo="Avanzado"),
        booleano("fit_intercept", True, "Término constante.", "Dejalo prendido.", "Prendido.")],
       escala=True, importancia="coef", costo="mínimo"),
    _m("lasso", "sklearn", "regresion", "sklearn.linear_model.Lasso", "Lasso (lineal con L1)", "Lineal",
       "Regresión lineal que lleva a cero los coeficientes de columnas que no aportan: selecciona variables.",
       [real("alpha", 1.0, 0.00001, 100000.0, "Fuerza de la regularización L1.",
             "Más alto = más coeficientes en cero (modelo más simple). Depende de la escala del objetivo.",
             "0,001 a 10, en escala log.", log=True, grupo="Regularización", buscar=[0.01, 0.1, 1, 10]),
        entero("max_iter", 1000, 10, 100000, "Iteraciones máximas del descenso por coordenadas.",
               "Subilo si avisa que no convergió.", "1000 a 10000.", grupo="Avanzado"),
        opcion("selection", "cyclic", [("cyclic", "en orden"), ("random", "al azar")],
               "Orden en que actualiza los coeficientes.", "random a veces converge más rápido.", "cyclic.",
               grupo="Avanzado"),
        booleano("fit_intercept", True, "Término constante.", "Dejalo prendido.", "Prendido.")],
       escala=True, importancia="coef", costo="mínimo", semilla="random_state"),
    _m("elasticnet", "sklearn", "regresion", "sklearn.linear_model.ElasticNet", "ElasticNet (L1 + L2)", "Lineal",
       "Mezcla Ridge y Lasso: selecciona variables sin descartar al azar una de dos columnas parecidas.",
       [real("alpha", 1.0, 0.00001, 100000.0, "Fuerza total de la regularización.", "Más alto = modelo más simple.",
             "0,001 a 10, en escala log.", log=True, grupo="Regularización", buscar=[0.01, 0.1, 1]),
        real("l1_ratio", 0.5, 0.0, 1.0, "Cuánto es L1 (Lasso) y cuánto L2 (Ridge): 1 = Lasso, 0 = Ridge.",
             "Más cerca de 1 = más coeficientes en cero.", "0,1 a 0,9.", grupo="Regularización", buscar=[0.2, 0.5, 0.8]),
        entero("max_iter", 1000, 10, 100000, "Iteraciones máximas.", "Subilo si no converge.", "1000 a 10000.",
               grupo="Avanzado"),
        booleano("fit_intercept", True, "Término constante.", "Dejalo prendido.", "Prendido.")],
       escala=True, importancia="coef", costo="mínimo", semilla="random_state"),
    _m("knn_reg", "sklearn", "regresion", "sklearn.neighbors.KNeighborsRegressor", "K vecinos más cercanos", "Distancia",
       "Promedia el objetivo de las filas más parecidas. No entrena: guarda todo y busca al predecir (lento con muchos datos).",
       copy.deepcopy(_KNN), escala=True, importancia=None, costo="bajo al entrenar, alto al predecir"),
    _m("svr", "sklearn", "regresion", "sklearn.svm.SVR", "Máquina de vectores de soporte (SVR)", "Kernel",
       "Ajusta una función dentro de un tubo de ancho epsilon; con kernel RBF sigue curvas. Tarda mucho con más de ~20.000 filas.",
       _svm(False), escala=True, importancia=None, costo="alto (cuadrático en filas)"),
    _m("arbol_reg", "sklearn", "regresion", "sklearn.tree.DecisionTreeRegressor", "Árbol de decisión", "Árboles",
       "Preguntas de sí o no sobre las columnas hasta una hoja con un valor. Se puede leer; solo es inestable.",
       _arbol([("squared_error", "error cuadrático"), ("friedman_mse", "Friedman MSE"), ("absolute_error", "error absoluto"),
               ("poisson", "Poisson")], "squared_error", False),
       escala=False, importancia="arbol", costo="bajo", semilla="random_state"),
    _m("bosque_reg", "sklearn", "regresion", "sklearn.ensemble.RandomForestRegressor", "Bosque aleatorio", "Ensambles",
       "Promedio de muchos árboles entrenados con filas y columnas al azar: robusto y casi sin tocar nada.",
       _bosque(False, 1.0), escala=False, importancia="arbol", costo="medio", semilla="random_state", paralelo=True),
    _m("extra_reg", "sklearn", "regresion", "sklearn.ensemble.ExtraTreesRegressor", "Árboles extremadamente aleatorios",
       "Ensambles", "Como el bosque, pero los cortes también son al azar: más rápido y a veces generaliza mejor.",
       [p if p["nombre"] != "bootstrap" else {**p, "defecto": False} for p in _bosque(False, 1.0)],
       escala=False, importancia="arbol", costo="medio", semilla="random_state", paralelo=True),
    _m("gb_reg", "sklearn", "regresion", "sklearn.ensemble.GradientBoostingRegressor", "Gradient boosting", "Ensambles",
       "Árboles chicos en secuencia, cada uno corrigiendo el error del anterior. Muy preciso; secuencial y más lento.",
       [opcion("loss", "squared_error", [("squared_error", "error cuadrático"), ("absolute_error", "error absoluto"),
                                         ("huber", "Huber"), ("quantile", "cuantil")],
               "La pérdida que minimiza.", "absolute_error y huber resisten outliers; quantile predice un cuantil (alpha).",
               "squared_error.", grupo="Pérdida"),
        real("alpha", 0.9, 0.01, 0.99, "Cuantil (loss=quantile) o umbral de Huber.", "0,9 predice el percentil 90.",
             "0,5 a 0,95.", grupo="Pérdida", si={"loss": ["huber", "quantile"]})] + _boosting(False),
       escala=False, importancia="arbol", costo="medio-alto", semilla="random_state"),
    _m("hgb_reg", "sklearn", "regresion", "sklearn.ensemble.HistGradientBoostingRegressor",
       "Gradient boosting con histogramas", "Ensambles",
       "El boosting rápido de scikit-learn (estilo LightGBM): agrupa los valores en rangos. Acepta nulos sin imputar.",
       [opcion("loss", "squared_error", [("squared_error", "error cuadrático"), ("absolute_error", "error absoluto"),
                                         ("poisson", "Poisson"), ("gamma", "gamma")],
               "La pérdida que minimiza.", "absolute_error resiste outliers; poisson para conteos.", "squared_error.",
               grupo="Pérdida")] + _hist(False),
       escala=False, importancia="permutacion", costo="bajo-medio", semilla="random_state", nulos=True),
    _m("xgb_reg", "sklearn", "regresion", "xgboost.XGBRegressor", "XGBoost", "Ensambles",
       "Gradient boosting de XGBoost (CPU, con la API de scikit-learn): el clásico de las competencias. Acepta nulos.",
       _xgb(False), escala=False, importancia="arbol", costo="bajo-medio", semilla="random_state", nulos=True,
       paralelo=True, extra="xgboost"),
    _m("mlp_reg", "sklearn", "regresion", "sklearn.neural_network.MLPRegressor", "Red neuronal (MLP)", "Redes neuronales",
       "Perceptrón multicapa: capas de neuronas entrenadas con retropropagación. Necesita columnas escaladas.",
       _mlp(False), escala=True, importancia="permutacion", costo="medio-alto", semilla="random_state", perdida=True),

    # ------------------------------------------------ clasificación
    _m("base_clf", "sklearn", "clasificacion", "sklearn.dummy.DummyClassifier", "Línea base (siempre la clase más común)",
       "Línea base", "Contesta siempre la clase más común: cualquier modelo que no le gane no sirve.",
       [opcion("strategy", "most_frequent", [("most_frequent", "la más común"), ("prior", "proporciones"),
                                             ("stratified", "al azar con proporciones"), ("uniform", "al azar parejo")],
               "Qué contesta siempre.", "most_frequent da la exactitud mínima a superar.", "most_frequent.")],
       escala=False, importancia=None, costo="mínimo", semilla="random_state", proba=True),
    _m("logistica", "sklearn", "clasificacion", "sklearn.linear_model.LogisticRegression", "Regresión logística", "Lineal",
       "Una frontera lineal con probabilidades calibradas. Rápida, interpretable y una gran línea base.",
       [real("C", 1.0, 0.0001, 10000.0, "Inverso de la regularización.",
             "Más alto = menos regularización, ajusta más a los datos; más bajo = coeficientes chicos.",
             "0,01 a 100, en escala log.", log=True, grupo="Regularización", buscar=[0.01, 0.1, 1, 10]),
        real("l1_ratio", 0.0, 0.0, 1.0, "Tipo de penalización: 0 = L2 (Ridge), 1 = L1 (Lasso), en el medio ElasticNet.",
             "L1 lleva coeficientes a cero (selecciona variables). Con l1_ratio mayor a 0 usá solver saga.",
             "0 (L2) casi siempre.", grupo="Regularización"),
        opcion("solver", "lbfgs", [("lbfgs", "L-BFGS"), ("liblinear", "liblinear"), ("newton-cg", "Newton-CG"),
                                   ("newton-cholesky", "Newton-Cholesky"), ("sag", "SAG"), ("saga", "SAGA")],
               "El optimizador.", "lbfgs anda bien en general; saga admite L1 y escala a muchos datos; liblinear para datos chicos.",
               "lbfgs; saga si l1_ratio > 0.", grupo="Optimizador"),
        entero("max_iter", 100, 10, 100000, "Iteraciones máximas del optimizador.",
               "Si avisa que no convergió, subilo (o escalá las columnas).", "100 a 1000.", grupo="Optimizador"),
        real("tol", 0.0001, 0.0000001, 0.1, "Tolerancia para dar por convergido.", "Más alto = termina antes.", "1e-4.",
             log=True, grupo="Optimizador"),
        copy.deepcopy(_CLASS_WEIGHT),
        booleano("fit_intercept", True, "Término constante.", "Dejalo prendido.", "Prendido.")],
       escala=True, importancia="coef", costo="mínimo", semilla="random_state", proba=True),
    _m("knn_clf", "sklearn", "clasificacion", "sklearn.neighbors.KNeighborsClassifier", "K vecinos más cercanos", "Distancia",
       "Vota la clase de las filas más parecidas. Simple y sin entrenamiento; lento al predecir con muchos datos.",
       copy.deepcopy(_KNN), escala=True, importancia=None, costo="bajo al entrenar, alto al predecir", proba=True),
    _m("svc", "sklearn", "clasificacion", "sklearn.svm.SVC", "Máquina de vectores de soporte (SVC)", "Kernel",
       "Busca la frontera con el margen más ancho; con kernel RBF separa clases con formas curvas. Tarda con muchas filas.",
       _svm(True), escala=True, importancia=None, costo="alto (cuadrático en filas)", semilla="random_state", proba=False),
    _m("naive_bayes", "sklearn", "clasificacion", "sklearn.naive_bayes.GaussianNB", "Naive Bayes gaussiano", "Probabilístico",
       "Supone columnas independientes y normales dentro de cada clase. Rapidísimo; buena línea base.",
       [real("var_smoothing", 1e-9, 1e-15, 1.0, "Varianza que se suma a todas para estabilizar.",
             "Más alto = probabilidades más suaves.", "1e-9 a 1e-3, en escala log.", log=True, grupo="Regularización",
             buscar=[1e-9, 1e-6, 1e-3])],
       escala=False, importancia=None, costo="mínimo", proba=True),
    _m("arbol_clf", "sklearn", "clasificacion", "sklearn.tree.DecisionTreeClassifier", "Árbol de decisión", "Árboles",
       "Preguntas de sí o no hasta una hoja con la clase. Se lee como reglas; uno solo es inestable.",
       _arbol([("gini", "Gini"), ("entropy", "entropía"), ("log_loss", "log loss")], "gini", True) + [copy.deepcopy(_CLASS_WEIGHT)],
       escala=False, importancia="arbol", costo="bajo", semilla="random_state", proba=True),
    _m("bosque_clf", "sklearn", "clasificacion", "sklearn.ensemble.RandomForestClassifier", "Bosque aleatorio", "Ensambles",
       "Votación de muchos árboles con filas y columnas al azar: robusto, preciso y casi sin tocar nada.",
       _bosque(True, "sqrt") + [opcion("class_weight", None, [(None, "iguales"), ("balanced", "balanceadas"),
                                                              ("balanced_subsample", "balanceadas por árbol")],
                                       "Peso de cada clase.", "balanced ayuda a la clase minoritaria.",
                                       "balanced si hay desbalance.", grupo="Clases")],
       escala=False, importancia="arbol", costo="medio", semilla="random_state", proba=True, paralelo=True),
    _m("extra_clf", "sklearn", "clasificacion", "sklearn.ensemble.ExtraTreesClassifier", "Árboles extremadamente aleatorios",
       "Ensambles", "Como el bosque, con cortes al azar: más rápido y con menos varianza.",
       [p if p["nombre"] != "bootstrap" else {**p, "defecto": False} for p in _bosque(True, "sqrt")] +
       [copy.deepcopy(_CLASS_WEIGHT)],
       escala=False, importancia="arbol", costo="medio", semilla="random_state", proba=True, paralelo=True),
    _m("gb_clf", "sklearn", "clasificacion", "sklearn.ensemble.GradientBoostingClassifier", "Gradient boosting", "Ensambles",
       "Árboles chicos en secuencia, cada uno corrige al anterior. Muy preciso; más lento que el de histogramas.",
       [opcion("loss", "log_loss", [("log_loss", "log loss"), ("exponential", "exponencial (AdaBoost, solo binaria)")],
               "La pérdida que minimiza.", "exponential equivale a AdaBoost.", "log_loss.", grupo="Pérdida")] +
       _boosting(True), escala=False, importancia="arbol", costo="medio-alto", semilla="random_state", proba=True),
    _m("hgb_clf", "sklearn", "clasificacion", "sklearn.ensemble.HistGradientBoostingClassifier",
       "Gradient boosting con histogramas", "Ensambles",
       "El boosting rápido de scikit-learn (estilo LightGBM). Acepta nulos sin imputar; ideal desde ~10.000 filas.",
       _hist(True), escala=False, importancia="permutacion", costo="bajo-medio", semilla="random_state", proba=True,
       nulos=True),
    _m("adaboost", "sklearn", "clasificacion", "sklearn.ensemble.AdaBoostClassifier", "AdaBoost", "Ensambles",
       "Suma árboles de un solo corte; cada uno le da más peso a las filas que el anterior clasificó mal.",
       [entero("n_estimators", 50, 1, 5000, "Cuántos clasificadores débiles suma.",
               "Más = aprende más; con ruido puede sobreajustar.", "50 a 500.", grupo="Ensamble", buscar=[50, 100, 300]),
        real("learning_rate", 1.0, 0.001, 10.0, "Cuánto pesa cada clasificador nuevo.",
             "Más chico = necesita más estimadores pero suele generalizar mejor.", "0,1 a 1.", log=True,
             grupo="Optimizador", buscar=[0.1, 0.5, 1.0])],
       escala=False, importancia="arbol", costo="medio", semilla="random_state", proba=True),
    _m("xgb_clf", "sklearn", "clasificacion", "xgboost.XGBClassifier", "XGBoost", "Ensambles",
       "Gradient boosting de XGBoost (CPU, con la API de scikit-learn). Acepta nulos; las clases se codifican 0..n−1.",
       _xgb(True), escala=False, importancia="arbol", costo="bajo-medio", semilla="random_state", proba=True, nulos=True,
       paralelo=True, extra="xgboost"),
    _m("mlp_clf", "sklearn", "clasificacion", "sklearn.neural_network.MLPClassifier", "Red neuronal (MLP)",
       "Redes neuronales",
       "Perceptrón multicapa con retropropagación: elegís capas, activación, optimizador (adam, sgd, lbfgs) y parada.",
       _mlp(True), escala=True, importancia="permutacion", costo="medio-alto", semilla="random_state", proba=True,
       perdida=True),

    # ------------------------------------------------ clustering
    _m("kmeans", "sklearn", "clustering", "sklearn.cluster.KMeans", "KMeans", "Centroides",
       "Parte los datos en k grupos alrededor de k centros. Rápido; supone grupos redondos y de tamaño parecido.",
       [entero("n_clusters", 3, 2, 50, "Cuántos grupos (k).",
               "Hay que elegirlo: mirá la silhouette y el codo de la inercia en la curva de validación.", "2 a 10.",
               grupo="Grupos", buscar=[2, 3, 4, 5, 6]),
        opcion("init", "k-means++", [("k-means++", "k-means++"), ("random", "al azar")],
               "Cómo elige los centros iniciales.", "k-means++ los separa: converge mejor.", "k-means++.", grupo="Inicio"),
        entero("n_init", 10, 1, 100, "Cuántas veces arranca de cero (se queda con la mejor).",
               "Más arranques = menos chances de un mal mínimo local; tarda más.", "10.", grupo="Inicio"),
        entero("max_iter", 300, 10, 10000, "Iteraciones máximas por arranque.", "Casi nunca hace falta tocarlo.", "300.",
               grupo="Inicio"),
        opcion("algorithm", "lloyd", [("lloyd", "Lloyd"), ("elkan", "Elkan")], "Variante del algoritmo.",
               "Elkan es más rápido con grupos bien separados.", "lloyd.", grupo="Avanzado")],
       escala=True, costo="bajo", semilla="random_state", centros=True),
    _m("minibatch_kmeans", "sklearn", "clustering", "sklearn.cluster.MiniBatchKMeans", "KMeans por lotes", "Centroides",
       "KMeans con mini-lotes: mucho más rápido con cientos de miles de filas, apenas menos preciso.",
       [entero("n_clusters", 3, 2, 50, "Cuántos grupos (k).", "Elegilo con silhouette e inercia.", "2 a 10.",
               grupo="Grupos", buscar=[2, 3, 4, 5, 6]),
        entero("batch_size", 1024, 16, 100000, "Filas por mini-lote.", "Más grande = más preciso y más lento.",
               "256 a 4096.", grupo="Lotes"),
        entero("max_iter", 100, 10, 10000, "Pasadas máximas por los datos.", "Más = mejor convergencia.", "100.",
               grupo="Lotes"),
        entero("n_init", 3, 1, 100, "Arranques desde cero.", "Más = más estable.", "3 a 10.", grupo="Inicio")],
       escala=True, costo="mínimo", semilla="random_state", centros=True),
    _m("dbscan", "sklearn", "clustering", "sklearn.cluster.DBSCAN", "DBSCAN (por densidad)", "Densidad",
       "Grupos = zonas densas de puntos; encuentra formas raras y marca el ruido (grupo −1). No pide k.",
       [real("eps", 0.5, 0.001, 100.0, "Radio del vecindario (en las columnas escaladas).",
             "Más grande = grupos más grandes y menos ruido; demasiado = todo un solo grupo.",
             "0,2 a 2 con columnas escaladas.", grupo="Densidad", buscar=[0.3, 0.5, 1.0]),
        entero("min_samples", 5, 1, 1000, "Puntos mínimos en el radio para ser núcleo de un grupo.",
               "Más alto = solo zonas muy densas son grupos; más puntos quedan como ruido.", "5 a 20.",
               grupo="Densidad", buscar=[5, 10, 20]),
        opcion("metric", "euclidean", ["euclidean", "manhattan", "chebyshev"], "Cómo se mide la distancia.",
               "manhattan es menos sensible a una columna con diferencias grandes.", "euclidean.", grupo="Densidad")],
       escala=True, costo="medio (memoria con muchas filas)", predice=False),
    _m("aglomerativo", "sklearn", "clustering", "sklearn.cluster.AgglomerativeClustering", "Jerárquico aglomerativo",
       "Jerárquico", "Arranca con cada fila sola y va uniendo los grupos más parecidos. Memoria cuadrática: hasta ~20.000 filas.",
       [entero("n_clusters", 3, 2, 50, "En cuántos grupos corta el árbol.", "Elegilo con silhouette.", "2 a 10.",
               grupo="Grupos", buscar=[2, 3, 4, 5]),
        opcion("linkage", "ward", [("ward", "Ward (varianza mínima)"), ("complete", "completo (el más lejano)"),
                                   ("average", "promedio"), ("single", "simple (el más cercano)")],
               "Cómo mide la distancia entre dos grupos.",
               "ward da grupos parejos; single encadena puntos (formas alargadas).", "ward.", grupo="Grupos",
               buscar=["ward", "average", "complete"]),
        opcion("metric", "euclidean", ["euclidean", "manhattan", "cosine"], "Distancia entre filas (ward solo euclídea).",
               "cosine compara direcciones.", "euclidean.", grupo="Grupos", si={"linkage": ["complete", "average", "single"]})],
       escala=True, costo="alto (cuadrático en filas)", predice=False, max_filas=20000),
    _m("mezcla_gaussiana", "sklearn", "clustering", "sklearn.mixture.GaussianMixture", "Mezcla gaussiana (GMM)",
       "Probabilístico", "Grupos como campanas de Gauss con forma propia: grupos elípticos y probabilidad de pertenecer.",
       [entero("n_components", 3, 1, 50, "Cuántas campanas (grupos).", "Elegilo con BIC o silhouette.", "2 a 10.",
               grupo="Grupos", buscar=[2, 3, 4, 5]),
        opcion("covariance_type", "full", [("full", "completa"), ("tied", "compartida"), ("diag", "diagonal"),
                                           ("spherical", "esférica")],
               "La forma que puede tener cada grupo.", "full = elipses libres; spherical = círculos (como KMeans).",
               "full o diag.", grupo="Grupos"),
        entero("max_iter", 100, 10, 10000, "Iteraciones máximas del algoritmo EM.", "Subilo si no converge.", "100.",
               grupo="Inicio"),
        entero("n_init", 1, 1, 50, "Arranques desde cero.", "Más = más estable.", "1 a 5.", grupo="Inicio"),
        real("reg_covar", 1e-6, 0.0, 1.0, "Lo que se suma a la diagonal de las covarianzas.", "Evita covarianzas degeneradas.",
             "1e-6.", log=True, grupo="Avanzado")],
       escala=True, costo="medio", semilla="random_state", proba=True),

    # ------------------------------------------------ reducción
    _m("pca", "sklearn", "reduccion", "sklearn.decomposition.PCA", "PCA (componentes principales)", "Reducción",
       "Rota los datos para que las primeras componentes junten la mayor varianza posible. Sirve para ver y para comprimir.",
       [entero("n_components", 2, 1, 200, "Cuántas componentes deja.",
               "Más = conserva más varianza. Mirá la varianza explicada acumulada.", "2 para ver; las que junten ~90 %.",
               grupo="Componentes"),
        booleano("whiten", False, "Escala cada componente para que tenga varianza 1.",
                 "Útil antes de modelos que asumen columnas parejas.", "Apagado.", grupo="Componentes"),
        opcion("svd_solver", "auto", ["auto", "full", "covariance_eigh", "arpack", "randomized"],
               "Algoritmo de la descomposición.", "Solo cambia velocidad.", "auto.", grupo="Avanzado")],
       escala=True, costo="bajo", semilla="random_state"),
]


# ---------------------------------------------------------------- Spark MLlib

def _sp_arbol(clasif):
    return [
        entero("maxDepth", 5, 0, 30, "Profundidad máxima (Spark no acepta sin límite: máximo 30).",
               "Más profundo = más detalle y más sobreajuste.", "3 a 10.", grupo="Árbol", buscar=[3, 5, 8]),
        entero("maxBins", 32, 2, 1024, "En cuántos rangos parte cada columna continua para buscar cortes.",
               "Más = cortes más finos y más memoria; tiene que ser ≥ a las categorías de una columna indexada.",
               "32 a 128.", grupo="Árbol"),
        entero("minInstancesPerNode", 1, 1, 10000, "Filas mínimas en cada hijo de una división.",
               "Más alto = menos sobreajuste.", "1 a 20.", grupo="Árbol", buscar=[1, 5, 20]),
        real("minInfoGain", 0.0, 0.0, 1.0, "Ganancia mínima para aceptar una división.", "Más alto = árbol más chico.",
             "0 a 0,01.", grupo="Regularización"),
        opcion("impurity", "gini" if clasif else "variance",
               [("gini", "Gini"), ("entropy", "entropía")] if clasif else [("variance", "varianza")],
               "Cómo mide la calidad de una división.", "Cambia poco.", "El de por defecto.", grupo="Árbol"),
    ]


SPARK = [
    _m("lineal_spark", "spark", "regresion", "pyspark.ml.regression.LinearRegression", "Regresión lineal", "Lineal",
       "Mínimos cuadrados en los executors de YARN; con regParam y elasticNetParam es Ridge, Lasso o ElasticNet.",
       [real("regParam", 0.0, 0.0, 1000.0, "Fuerza de la regularización (como alpha de scikit-learn).",
             "Más alto = coeficientes más chicos.", "0 a 1.", grupo="Regularización", buscar=[0.0, 0.01, 0.1]),
        real("elasticNetParam", 0.0, 0.0, 1.0, "0 = L2 (Ridge), 1 = L1 (Lasso), en el medio ElasticNet.",
             "Más cerca de 1 = más coeficientes en cero.", "0 a 1.", grupo="Regularización", buscar=[0.0, 0.5, 1.0]),
        entero("maxIter", 100, 1, 10000, "Iteraciones máximas.", "Subilo si no converge.", "100.", grupo="Optimizador"),
        opcion("solver", "auto", [("auto", "auto"), ("normal", "ecuación normal"), ("l-bfgs", "L-BFGS")],
               "Cómo resuelve.", "normal es exacto con pocas columnas; l-bfgs escala.", "auto.", grupo="Optimizador"),
        booleano("standardization", True, "Estandariza las columnas por dentro antes de regularizar.",
                 "Los coeficientes vuelven en la escala original.", "Prendido.", grupo="Avanzado"),
        booleano("fitIntercept", True, "Término constante.", "Dejalo prendido.", "Prendido.")],
       escala=False, importancia="coef", costo="arranque de Spark + bajo"),
    _m("arbol_reg_spark", "spark", "regresion", "pyspark.ml.regression.DecisionTreeRegressor", "Árbol de decisión",
       "Árboles", "El árbol de MLlib: busca cortes con histogramas repartidos en los executors.",
       _sp_arbol(False), escala=False, importancia="arbol", costo="arranque de Spark + bajo", semilla="seed"),
    _m("bosque_reg_spark", "spark", "regresion", "pyspark.ml.regression.RandomForestRegressor", "Bosque aleatorio",
       "Ensambles", "Muchos árboles en paralelo en los executors.",
       [entero("numTrees", 20, 1, 1000, "Cuántos árboles.", "Más = más estable y más lento.", "20 a 200.",
               grupo="Ensamble", buscar=[20, 50, 100]),
        opcion("featureSubsetStrategy", "auto", ["auto", "all", "onethird", "sqrt", "log2"],
               "Columnas al azar por división.", "auto = onethird en regresión.", "auto.", grupo="Árbol"),
        real("subsamplingRate", 1.0, 0.01, 1.0, "Fracción de filas para cada árbol.", "Menos = más azar y más rápido.",
             "0,6 a 1.", grupo="Ensamble")] + _sp_arbol(False),
       escala=False, importancia="arbol", costo="arranque de Spark + medio", semilla="seed"),
    _m("gbt_reg_spark", "spark", "regresion", "pyspark.ml.regression.GBTRegressor", "Gradient boosting (GBT)", "Ensambles",
       "Boosting de árboles en MLlib: secuencial entre árboles, repartido dentro de cada uno.",
       [entero("maxIter", 20, 1, 1000, "Cuántos árboles (rondas).", "Más = aprende más.", "20 a 100.", grupo="Ensamble",
               buscar=[20, 50]),
        real("stepSize", 0.1, 0.001, 1.0, "Tasa de aprendizaje (learning_rate).", "Más chico = más estable.", "0,05 a 0,2.",
             log=True, grupo="Optimizador", buscar=[0.05, 0.1, 0.2]),
        real("subsamplingRate", 1.0, 0.01, 1.0, "Fracción de filas por árbol.", "Menos = más azar.", "0,6 a 1.",
             grupo="Ensamble"),
        opcion("lossType", "squared", [("squared", "cuadrática"), ("absolute", "absoluta")], "La pérdida.",
               "absolute resiste outliers.", "squared.", grupo="Pérdida")] +
       [p for p in _sp_arbol(False) if p["nombre"] != "impurity"],
       escala=False, importancia="arbol", costo="arranque de Spark + medio-alto", semilla="seed"),

    _m("logistica_spark", "spark", "clasificacion", "pyspark.ml.classification.LogisticRegression", "Regresión logística",
       "Lineal", "Logística binaria o multinomial en MLlib.",
       [real("regParam", 0.0, 0.0, 1000.0, "Fuerza de la regularización (≈ 1/C de scikit-learn).",
             "Más alto = coeficientes más chicos.", "0 a 1.", grupo="Regularización", buscar=[0.0, 0.01, 0.1]),
        real("elasticNetParam", 0.0, 0.0, 1.0, "0 = L2, 1 = L1.", "Más cerca de 1 = más coeficientes en cero.", "0 a 1.",
             grupo="Regularización"),
        entero("maxIter", 100, 1, 10000, "Iteraciones máximas.", "Subilo si no converge.", "100.", grupo="Optimizador"),
        real("threshold", 0.5, 0.0, 1.0, "Umbral de probabilidad para decir 'positivo' (binaria).",
             "Más bajo = más positivos (sube recall, baja precisión).", "0,5.", grupo="Decisión"),
        opcion("family", "auto", ["auto", "binomial", "multinomial"], "Binaria o multiclase.", "auto decide por las clases.",
               "auto.", grupo="Avanzado"),
        booleano("standardization", True, "Estandariza por dentro.", "Dejalo prendido.", "Prendido.", grupo="Avanzado")],
       escala=False, importancia="coef", costo="arranque de Spark + bajo", proba=True),
    _m("arbol_clf_spark", "spark", "clasificacion", "pyspark.ml.classification.DecisionTreeClassifier",
       "Árbol de decisión", "Árboles", "El árbol de MLlib.", _sp_arbol(True), escala=False, importancia="arbol",
       costo="arranque de Spark + bajo", semilla="seed", proba=True),
    _m("bosque_clf_spark", "spark", "clasificacion", "pyspark.ml.classification.RandomForestClassifier", "Bosque aleatorio",
       "Ensambles", "Muchos árboles en paralelo en los executors.",
       [entero("numTrees", 20, 1, 1000, "Cuántos árboles.", "Más = más estable y más lento.", "20 a 200.",
               grupo="Ensamble", buscar=[20, 50, 100]),
        opcion("featureSubsetStrategy", "auto", ["auto", "all", "onethird", "sqrt", "log2"],
               "Columnas al azar por división.", "auto = sqrt en clasificación.", "auto.", grupo="Árbol"),
        real("subsamplingRate", 1.0, 0.01, 1.0, "Fracción de filas por árbol.", "Menos = más azar.", "0,6 a 1.",
             grupo="Ensamble")] + _sp_arbol(True),
       escala=False, importancia="arbol", costo="arranque de Spark + medio", semilla="seed", proba=True),
    _m("gbt_clf_spark", "spark", "clasificacion", "pyspark.ml.classification.GBTClassifier", "Gradient boosting (GBT)",
       "Ensambles", "Boosting de árboles en MLlib. Solo clasificación binaria.",
       [entero("maxIter", 20, 1, 1000, "Cuántos árboles.", "Más = aprende más.", "20 a 100.", grupo="Ensamble",
               buscar=[20, 50]),
        real("stepSize", 0.1, 0.001, 1.0, "Tasa de aprendizaje.", "Más chico = más estable.", "0,05 a 0,2.", log=True,
             grupo="Optimizador"),
        real("subsamplingRate", 1.0, 0.01, 1.0, "Fracción de filas por árbol.", "Menos = más azar.", "0,6 a 1.",
             grupo="Ensamble")] + [p for p in _sp_arbol(True) if p["nombre"] != "impurity"],
       escala=False, importancia="arbol", costo="arranque de Spark + medio-alto", semilla="seed", proba=True, binaria=True),
    _m("naive_bayes_spark", "spark", "clasificacion", "pyspark.ml.classification.NaiveBayes", "Naive Bayes", "Probabilístico",
       "Naive Bayes de MLlib (gaussiano o multinomial: el multinomial pide columnas no negativas).",
       [real("smoothing", 1.0, 0.0, 100.0, "Suavizado de Laplace (multinomial).", "Más alto = probabilidades más parejas.",
             "1.", grupo="Regularización"),
        opcion("modelType", "gaussian", [("gaussian", "gaussiano"), ("multinomial", "multinomial (conteos)"),
                                         ("bernoulli", "Bernoulli (0/1)")],
               "Qué distribución supone dentro de cada clase.", "gaussian para números; multinomial para conteos/texto.",
               "gaussian.", grupo="Modelo")],
       escala=False, importancia=None, costo="arranque de Spark + mínimo", proba=True),
    _m("svc_lineal_spark", "spark", "clasificacion", "pyspark.ml.classification.LinearSVC", "SVM lineal", "Kernel",
       "Máquina de vectores de soporte lineal (sin kernel) en MLlib. Solo binaria.",
       [real("regParam", 0.0, 0.0, 1000.0, "Fuerza de la regularización.", "Más alto = margen más ancho.", "0 a 1.",
             grupo="Regularización", buscar=[0.0, 0.01, 0.1]),
        entero("maxIter", 100, 1, 10000, "Iteraciones máximas.", "Subilo si no converge.", "100.", grupo="Optimizador"),
        booleano("standardization", True, "Estandariza por dentro.", "Dejalo prendido.", "Prendido.", grupo="Avanzado")],
       escala=False, importancia="coef", costo="arranque de Spark + bajo", binaria=True),
    _m("mlp_spark", "spark", "clasificacion", "pyspark.ml.classification.MultilayerPerceptronClassifier",
       "Red neuronal (MLP)", "Redes neuronales",
       "Perceptrón multicapa de MLlib (sigmoide en las ocultas, softmax a la salida). Las capas de entrada y salida las pone el estudio.",
       [capas("layers", "16,8", "Neuronas de las capas ocultas, separadas por coma.",
              "Más neuronas = más capacidad y más lento.", "Una o dos capas de 8 a 64.", grupo="Arquitectura",
              buscar=["8", "16,8", "32,16"]),
        entero("maxIter", 100, 1, 10000, "Iteraciones máximas del optimizador.", "Más = entrena más.", "100 a 500.",
               grupo="Optimizador", buscar=[100, 300]),
        opcion("solver", "l-bfgs", [("l-bfgs", "L-BFGS"), ("gd", "descenso de gradiente")], "El optimizador.",
               "l-bfgs converge en menos iteraciones; gd usa stepSize.", "l-bfgs.", grupo="Optimizador"),
        real("stepSize", 0.03, 0.0001, 1.0, "Tamaño del paso (solo gd).", "Muy alto diverge.", "0,01 a 0,1.", log=True,
             grupo="Optimizador", si={"solver": ["gd"]}),
        entero("blockSize", 128, 1, 4096, "Filas que apila por bloque para multiplicar matrices.",
               "Más grande = más rápido y más memoria.", "128.", grupo="Avanzado"),
        real("tol", 1e-6, 0.0, 0.1, "Tolerancia de convergencia.", "Más alto = corta antes.", "1e-6.", log=True,
             grupo="Optimizador")],
       escala=True, importancia=None, costo="arranque de Spark + medio-alto", semilla="seed", proba=True),

    _m("kmeans_spark", "spark", "clustering", "pyspark.ml.clustering.KMeans", "KMeans", "Centroides",
       "KMeans de MLlib con k-means|| (la versión paralela de k-means++).",
       [entero("k", 3, 2, 50, "Cuántos grupos.", "Elegilo con silhouette.", "2 a 10.", grupo="Grupos", buscar=[2, 3, 4, 5]),
        opcion("initMode", "k-means||", [("k-means||", "k-means||"), ("random", "al azar")], "Cómo elige los centros.",
               "k-means|| es k-means++ en paralelo.", "k-means||.", grupo="Inicio"),
        entero("maxIter", 20, 1, 1000, "Iteraciones máximas.", "Subilo si no converge.", "20 a 100.", grupo="Inicio"),
        real("tol", 1e-4, 0.0, 1.0, "Movimiento mínimo de los centros para seguir.", "Más alto = corta antes.", "1e-4.",
             log=True, grupo="Inicio")],
       escala=True, costo="arranque de Spark + bajo", semilla="seed", centros=True),
    _m("bisecting_spark", "spark", "clustering", "pyspark.ml.clustering.BisectingKMeans", "KMeans bisectante", "Jerárquico",
       "Arranca con un grupo y lo va partiendo en dos con KMeans: jerárquico y escalable.",
       [entero("k", 3, 2, 50, "Cuántos grupos (hojas).", "Elegilo con silhouette.", "2 a 10.", grupo="Grupos",
               buscar=[2, 3, 4, 5]),
        entero("maxIter", 20, 1, 1000, "Iteraciones por partición.", "Más = mejor convergencia.", "20.", grupo="Inicio"),
        real("minDivisibleClusterSize", 1.0, 0.0, 100000.0, "Tamaño mínimo para seguir partiendo un grupo (≥1: filas; <1: fracción).",
             "Más alto = no parte grupos chicos.", "1.", grupo="Grupos")],
       escala=True, costo="arranque de Spark + bajo", semilla="seed", centros=True),
    _m("gmm_spark", "spark", "clustering", "pyspark.ml.clustering.GaussianMixture", "Mezcla gaussiana (GMM)",
       "Probabilístico", "Mezcla de gaussianas de MLlib (covarianza completa).",
       [entero("k", 3, 2, 50, "Cuántas campanas.", "Elegilo con silhouette.", "2 a 10.", grupo="Grupos"),
        entero("maxIter", 100, 1, 10000, "Iteraciones máximas.", "Subilo si no converge.", "100.", grupo="Inicio"),
        real("tol", 0.01, 0.0, 1.0, "Tolerancia de convergencia.", "Más alto = corta antes.", "0,01.", log=True,
             grupo="Inicio")],
       escala=True, costo="arranque de Spark + medio", semilla="seed", proba=True),

    _m("pca_spark", "spark", "reduccion", "pyspark.ml.feature.PCA", "PCA (componentes principales)", "Reducción",
       "PCA de MLlib: la matriz de covarianza se arma repartida en los executors.",
       [entero("k", 2, 1, 200, "Cuántas componentes.", "Más = más varianza conservada.", "2 para ver.",
               grupo="Componentes")],
       escala=True, costo="arranque de Spark + bajo"),
]

MODELOS = {m["id"]: m for m in SKLEARN + SPARK}

# Qué modelo de Spark equivale a cada uno de scikit-learn (para "probar en el otro motor")
EQUIVALENTE = {
    "lineal": "lineal_spark", "ridge": "lineal_spark", "lasso": "lineal_spark", "elasticnet": "lineal_spark",
    "arbol_reg": "arbol_reg_spark", "bosque_reg": "bosque_reg_spark", "extra_reg": "bosque_reg_spark",
    "gb_reg": "gbt_reg_spark", "hgb_reg": "gbt_reg_spark",
    "logistica": "logistica_spark", "arbol_clf": "arbol_clf_spark", "bosque_clf": "bosque_clf_spark",
    "extra_clf": "bosque_clf_spark", "gb_clf": "gbt_clf_spark", "hgb_clf": "gbt_clf_spark",
    "naive_bayes": "naive_bayes_spark", "xgb_reg": "gbt_reg_spark", "xgb_clf": "gbt_clf_spark", "svc": "svc_lineal_spark", "mlp_clf": "mlp_spark",
    "kmeans": "kmeans_spark", "minibatch_kmeans": "kmeans_spark", "aglomerativo": "bisecting_spark",
    "mezcla_gaussiana": "gmm_spark", "pca": "pca_spark",
}

# ---------------------------------------------------------------- métricas

METRICAS = {
    # regresión
    "r2": {"tarea": "regresion", "etiqueta": "R²", "sklearn": "r2", "spark": "r2", "mayor_mejor": True,
           "ayuda": "1 = predice perfecto; 0 = igual que decir siempre el promedio; negativo = peor que eso."},
    "mae": {"tarea": "regresion", "etiqueta": "MAE", "sklearn": "neg_mean_absolute_error", "spark": "mae",
            "mayor_mejor": False, "ayuda": "Error absoluto medio, en la unidad del objetivo. Resiste outliers."},
    "rmse": {"tarea": "regresion", "etiqueta": "RMSE", "sklearn": "neg_root_mean_squared_error", "spark": "rmse",
             "mayor_mejor": False, "ayuda": "Raíz del error cuadrático medio: castiga más los errores grandes."},
    "mape": {"tarea": "regresion", "etiqueta": "MAPE", "sklearn": "neg_mean_absolute_percentage_error", "spark": None,
             "mayor_mejor": False, "ayuda": "Error porcentual medio (0,1 = 10 %). Se rompe si el objetivo vale cerca de 0."},
    "varianza_explicada": {"tarea": "regresion", "etiqueta": "varianza explicada", "sklearn": "explained_variance",
                           "spark": "var", "mayor_mejor": True,
                           "ayuda": "Como R² pero sin castigar un sesgo constante."},
    # clasificación
    "exactitud": {"tarea": "clasificacion", "etiqueta": "exactitud", "sklearn": "accuracy", "spark": "accuracy",
                  "mayor_mejor": True, "ayuda": "Filas bien clasificadas. Engaña si una clase es mucho más común."},
    "exactitud_balanceada": {"tarea": "clasificacion", "etiqueta": "exactitud balanceada", "sklearn": "balanced_accuracy",
                             "spark": None, "mayor_mejor": True,
                             "ayuda": "Promedio del recall de cada clase: no la engaña el desbalance."},
    "f1_macro": {"tarea": "clasificacion", "etiqueta": "F1 macro", "sklearn": "f1_macro", "spark": None,
                 "mayor_mejor": True, "ayuda": "Promedio del F1 de cada clase (todas pesan igual)."},
    "f1_ponderado": {"tarea": "clasificacion", "etiqueta": "F1 ponderado", "sklearn": "f1_weighted", "spark": "f1",
                     "mayor_mejor": True, "ayuda": "F1 de cada clase pesado por cuántas filas tiene."},
    "precision_macro": {"tarea": "clasificacion", "etiqueta": "precisión macro", "sklearn": "precision_macro",
                        "spark": None, "mayor_mejor": True,
                        "ayuda": "De lo que dijo que era de una clase, cuánto acertó (promedio por clase)."},
    "recall_macro": {"tarea": "clasificacion", "etiqueta": "recall macro", "sklearn": "recall_macro", "spark": None,
                     "mayor_mejor": True, "ayuda": "De lo que era de cada clase, cuánto encontró (promedio por clase)."},
    "roc_auc": {"tarea": "clasificacion", "etiqueta": "ROC AUC", "sklearn": "roc_auc", "sklearn_multi": "roc_auc_ovr",
                "spark": "areaUnderROC", "spark_binaria": True, "mayor_mejor": True, "proba": True,
                "ayuda": "Probabilidad de que un positivo tenga más puntaje que un negativo: 0,5 = azar, 1 = perfecto."},
    "pr_auc": {"tarea": "clasificacion", "etiqueta": "PR AUC", "sklearn": "average_precision", "spark": "areaUnderPR",
               "spark_binaria": True, "mayor_mejor": True, "proba": True, "binaria": True,
               "ayuda": "Área bajo la curva precisión-recall: la más honesta con una clase positiva rara."},
    "log_loss": {"tarea": "clasificacion", "etiqueta": "log loss", "sklearn": "neg_log_loss", "spark": "logLoss",
                 "mayor_mejor": False, "proba": True,
                 "ayuda": "Castiga estar muy seguro y equivocarse: mide qué tan buenas son las probabilidades."},
    # clustering (no se usan en búsquedas de scikit-learn: se calculan aparte)
    "silhouette": {"tarea": "clustering", "etiqueta": "silhouette", "sklearn": None, "spark": "silhouette",
                   "mayor_mejor": True, "ayuda": "Qué tan separados quedan los grupos: −1 a 1, más alto mejor."},
    "davies_bouldin": {"tarea": "clustering", "etiqueta": "Davies-Bouldin", "sklearn": None, "spark": None,
                       "mayor_mejor": False, "ayuda": "Parecido de cada grupo con el más cercano: más bajo mejor."},
    "calinski_harabasz": {"tarea": "clustering", "etiqueta": "Calinski-Harabasz", "sklearn": None, "spark": None,
                          "mayor_mejor": True, "ayuda": "Dispersión entre grupos sobre dispersión dentro: más alto mejor."},
    "rand_ajustado": {"tarea": "clustering", "etiqueta": "Rand ajustado", "sklearn": None, "spark": None,
                      "mayor_mejor": True, "referencia": True,
                      "ayuda": "Cuánto se parecen los grupos a una columna de referencia (1 = iguales, 0 = azar)."},
    # reducción
    "varianza_acumulada": {"tarea": "reduccion", "etiqueta": "varianza explicada", "sklearn": None, "spark": None,
                           "mayor_mejor": True, "ayuda": "Fracción de la varianza total que juntan las componentes."},
}

METRICA_DEFECTO = {"regresion": "r2", "clasificacion": "f1_macro", "clustering": "silhouette",
                   "reduccion": "varianza_acumulada"}
METRICA_DEFECTO_SPARK = {"regresion": "r2", "clasificacion": "f1_ponderado", "clustering": "silhouette",
                         "reduccion": "varianza_acumulada"}

# ---------------------------------------------------------------- preprocesamiento, particiones, validación, búsqueda

PREPROCESO = {
    "imputar_num": {"etiqueta": "Nulos en numéricas", "opciones": [
        {"valor": "mediana", "etiqueta": "mediana", "ayuda": "Resiste outliers. La opción segura."},
        {"valor": "media", "etiqueta": "media", "ayuda": "El promedio: lo mueven los valores extremos."},
        {"valor": "cero", "etiqueta": "cero", "ayuda": "Cuando vacío significa 'no hubo'."},
        {"valor": "ninguna", "etiqueta": "no imputar", "ayuda": "Solo si no hay nulos o el modelo los acepta (HistGradientBoosting)."}]},
    "indicador_nulos": {"etiqueta": "Marcar los nulos", "ayuda": "Agrega una columna 0/1 por cada columna que tenía nulos: "
                                                                  "a veces que falte un dato es información."},
    "imputar_cat": {"etiqueta": "Nulos en categóricas", "opciones": [
        {"valor": "mas_frecuente", "etiqueta": "la más común", "ayuda": "Rellena con la categoría más común."},
        {"valor": "constante", "etiqueta": "categoría '(vacío)'", "ayuda": "Los nulos pasan a ser una categoría más."}]},
    "escalar": {"etiqueta": "Escalado de numéricas", "opciones": [
        {"valor": "estandar", "etiqueta": "estándar (z)", "ayuda": "Media 0 y desvío 1. Lo que esperan las redes, SVM, KNN y KMeans."},
        {"valor": "minmax", "etiqueta": "min-max", "ayuda": "Lleva todo a [0, 1]. Sensible a outliers."},
        {"valor": "robusto", "etiqueta": "robusto", "ayuda": "Resta la mediana y divide por el rango intercuartil: resiste outliers."},
        {"valor": "ninguno", "etiqueta": "sin escalar", "ayuda": "A los árboles y ensambles de árboles no les cambia nada."}]},
    "outliers": {"etiqueta": "Valores extremos", "opciones": [
        {"valor": "ninguno", "etiqueta": "dejarlos", "ayuda": "No toca nada."},
        {"valor": "recortar_iqr", "etiqueta": "recortar (IQR)", "ayuda": "Lleva al borde lo que esté más allá de Q1 − k·IQR o Q3 + k·IQR (k = factor). Se calcula solo con el entrenamiento."},
        {"valor": "recortar_pct", "etiqueta": "recortar (percentiles)", "ayuda": "Lleva al borde lo que esté fuera de los percentiles 1 y 99."},
        {"valor": "eliminar_iqr", "etiqueta": "sacar filas (IQR)", "ayuda": "Saca del entrenamiento las filas con algún valor fuera de Q1 − k·IQR / Q3 + k·IQR. La prueba no se toca."}]},
    "codificar": {"etiqueta": "Codificación de categóricas", "opciones": [
        {"valor": "onehot", "etiqueta": "one-hot", "ayuda": "Una columna 0/1 por categoría. Lo correcto para modelos lineales, redes y distancias."},
        {"valor": "ordinal", "etiqueta": "ordinal", "ayuda": "Un número por categoría. Alcanza para árboles y no multiplica columnas."}]},
    "fecha": {"etiqueta": "Fechas", "ayuda": "Cada fecha se separa en año, mes, día, día de la semana y hora."},
    "texto": {"etiqueta": "Texto", "ayuda": "TF-IDF: una columna por palabra frecuente, pesada por cuánto distingue."},
    "seleccion": {"etiqueta": "Selección de variables", "opciones": [
        {"valor": "ninguna", "etiqueta": "todas", "ayuda": "Usa todas las columnas que salen del preprocesamiento."},
        {"valor": "varianza", "etiqueta": "sacar casi constantes", "ayuda": "Saca columnas con varianza menor al umbral."},
        {"valor": "kbest", "etiqueta": "las k mejores", "ayuda": "Se queda con las k columnas con más relación (prueba F) con el objetivo."},
        {"valor": "modelo", "etiqueta": "por importancia", "ayuda": "Entrena un bosque chico y deja las columnas con importancia mayor a la mediana."}]},
    "pca": {"etiqueta": "PCA antes del modelo", "ayuda": "Reemplaza las columnas por sus primeras componentes principales."},
}

PREPROCESO_DEFECTO = {"imputar_num": "mediana", "indicador_nulos": False, "imputar_cat": "mas_frecuente",
                      "escalar": "estandar", "outliers": "ninguno", "factor_iqr": 1.5, "codificar": "onehot",
                      "max_categorias": 20, "fecha": True, "texto_max": 200, "seleccion": "ninguna", "k": 10,
                      "umbral_varianza": 0.0, "pca": None}

PARTICIONES = {
    "aleatoria": {"etiqueta": "aleatoria", "ayuda": "Separa filas al azar (con la semilla)."},
    "estratificada": {"etiqueta": "estratificada", "ayuda": "Al azar, pero con las mismas proporciones de cada clase en entrenamiento y prueba."},
    "temporal": {"etiqueta": "temporal", "ayuda": "Lo más viejo para entrenar, lo más nuevo para probar: como se usa de verdad un modelo que predice el futuro."},
}

CV = {
    "ninguna": {"etiqueta": "sin validación cruzada", "ayuda": "Solo la partición de prueba."},
    "kfold": {"etiqueta": "KFold", "ayuda": "Parte el entrenamiento en k partes; entrena con k−1 y valida con la otra, k veces."},
    "estratificada": {"etiqueta": "StratifiedKFold", "ayuda": "KFold con las mismas proporciones de clases en cada parte (clasificación)."},
    "repetida": {"etiqueta": "RepeatedKFold", "ayuda": "KFold repetido con distintas mezclas: estimación más estable del desvío."},
    "temporal": {"etiqueta": "TimeSeriesSplit", "ayuda": "Cada parte valida con datos posteriores a los que usó para entrenar."},
}

BUSQUEDAS = {
    "sklearn": {
        "ninguna": {"etiqueta": "sin búsqueda", "ayuda": "Entrena con los hiperparámetros elegidos."},
        "grid": {"etiqueta": "grilla (GridSearchCV)", "ayuda": "Prueba todas las combinaciones de los valores elegidos."},
        "random": {"etiqueta": "al azar (RandomizedSearchCV)", "ayuda": "Prueba n combinaciones al azar de los rangos: rinde más que la grilla con muchos parámetros."},
        "halving": {"etiqueta": "successive halving (HalvingGridSearchCV)", "ayuda": "Todas las combinaciones con pocas filas; las mejores siguen con más filas. Mucho más rápido que la grilla."},
        "halving_random": {"etiqueta": "successive halving al azar (HalvingRandomSearchCV)", "ayuda": "Halving sobre combinaciones al azar."},
    },
    "spark": {
        "ninguna": {"etiqueta": "sin búsqueda", "ayuda": "Entrena con los hiperparámetros elegidos."},
        "cv": {"etiqueta": "CrossValidator", "ayuda": "Grilla con validación cruzada de k partes: k entrenamientos por combinación."},
        "tvs": {"etiqueta": "TrainValidationSplit", "ayuda": "Grilla con una sola partición entrenamiento/validación: k veces más barato que CrossValidator."},
    },
}

LIMITES = {"max_ajustes": 3000, "max_combinaciones": 500, "max_minutos": 120, "min_minutos": 1, "max_n_jobs": 8,
           "max_filas_perfil": 200000}


def modelo(mid: str) -> dict:
    """El modelo del catálogo (KeyError si no existe)."""
    return MODELOS[mid]


def param(m: dict, nombre: str) -> dict | None:
    return next((p for p in m["params"] if p["nombre"] == nombre), None)


def defectos(mid: str) -> dict:
    """{parámetro: valor por defecto} de un modelo."""
    return {p["nombre"]: p["defecto"] for p in MODELOS[mid]["params"]}


def modelos(tarea: str | None = None, motor: str | None = None) -> list[dict]:
    return [m for m in MODELOS.values() if (tarea is None or m["tarea"] == tarea) and (motor is None or m["motor"] == motor)]


def como_json() -> dict:
    """Todo el catálogo, para GET /api/ml/catalog (y para el modo demo de la interfaz)."""
    return {"version": VERSION, "tareas": TAREAS, "roles": ROLES, "modelos": SKLEARN + SPARK, "equivalente": EQUIVALENTE,
            "metricas": METRICAS, "metricaDefecto": {"sklearn": METRICA_DEFECTO, "spark": METRICA_DEFECTO_SPARK},
            "preproceso": PREPROCESO, "preprocesoDefecto": PREPROCESO_DEFECTO, "particiones": PARTICIONES, "cv": CV,
            "busquedas": BUSQUEDAS, "limites": LIMITES}
