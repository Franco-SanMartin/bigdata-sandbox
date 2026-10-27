# 4. Clasificación: regresión logística y árboles de decisión

[← 3. Regresión lineal](03-regresion.md) · [Índice de teoría](README.md) · Siguiente: [5. Clustering con k-means →](05-clustering.md)

## Qué predice

Una **categoría**: si el cliente vuelve a comprar (1) o no (0). Con dos
categorías se llama clasificación **binaria**; con más (ocasional, frecuente,
mayorista), **multiclase**. Los mismos modelos sirven para las dos.

La regla real, escrita en `generar_senal.py`:

    vuelve = 1 si (visitas ≥ 4 y reclamos ≤ 1) o antigüedad ≥ 36

con el 10 % de las respuestas dado vuelta al azar. El mejor modelo posible
acierta ~90 %.

## La vara: el modelo "tonto"

Antes de cualquier modelo, la pregunta es: ¿cuánto acierta uno que no sabe
nada? `DummyClassifier(strategy="most_frequent")` siempre dice lo más común
("vuelve"), y acierta el 57,3 %: el porcentaje de clientes que vuelven. Un
modelo que no le gana a eso no aprendió nada. Y un 57 % "de aciertos" suena
mejor de lo que es: por eso siempre se compara contra el tonto.

## Regresión logística

A pesar del nombre, clasifica. Hace dos cosas:

1. Calcula una **suma con pesos**, como la regresión lineal:
   `z = a + b1 × antigüedad + b2 × visitas + ...`
2. La pasa por la **función logística** (sigmoide), que convierte cualquier
   número en una probabilidad entre 0 y 1: `p = 1 / (1 + e^(−z))`. Si `z` es
   muy grande, `p` está cerca de 1; si es muy negativo, cerca de 0; si es 0,
   `p` = 0,5.

Si `p` ≥ 0,5, predice 1. Entrenar es buscar los pesos que hacen más probables
las respuestas reales.

En la imagen va en un pipeline con `StandardScaler` (para que el ticket, que
vale miles, no tape a los reclamos). Con las columnas escaladas, los pesos
que aprende son, más o menos: antigüedad 1,36; visitas 1,15; reclamos −0,28;
ticket 0,15; edad 0,02. Más antigüedad y más visitas suben la probabilidad;
más reclamos la bajan.

### Por qué queda en 81,7 %

La frontera entre "vuelve" y "no vuelve" de una logística es donde `z` = 0:
una **recta** (con 5 columnas, un plano). La regla real no es una recta: es
un "o" de dos condiciones, una de ellas un "y". Dibujada con antigüedad en un
eje y visitas en el otro, la zona de "vuelve" tiene forma de L: todo lo de
arriba de 36 meses, más el rincón de 4 visitas o más. Una sola recta no puede
separar una L.

Se ve con los clientes nuevos de la [guía 4](../04-modelos-sklearn.md): uno
con 40 meses y 1 visita vuelve seguro según la regla, pero la logística le da
0,56 de probabilidad, apenas arriba de 0,5. Para ella, pocas visitas restan,
y no puede expresar "con 36 meses no importa cuántas visitas".

Ventajas que la mantienen como estándar en la industria (crédito, seguros,
medicina): es rápida, da **probabilidades** bien calibradas y sus pesos se
pueden explicar.

## Árbol de decisión

Un árbol hace **preguntas de sí o no** sobre una columna por vez, una debajo
de la otra, hasta llegar a una **hoja** que dice la clase. Es lo que
`export_text` muestra:

    antiguedad_meses <= 35.50
    |   visitas_mes <= 3.50                    → 0 (no vuelve)
    |   visitas_mes >  3.50
    |   |   reclamos <= 1.50                   → 1 (vuelve)
    |   |   reclamos >  1.50                   → 0
    antiguedad_meses >  35.50                  → 1

(resumido: en la salida real, algunas ramas tienen una pregunta más, por el
ticket o la edad, que termina en la misma clase de los dos lados y no cambia
nada).

Es **la regla real**. `<= 35.50` es lo mismo que `< 36` (el árbol corta entre
dos valores que existen en los datos, 35 y 36), `<= 3.50` es `< 4` y `<= 1.50`
es `≤ 1`.

### Cómo elige las preguntas

En cada paso prueba **todas** las columnas y **todos** los cortes posibles, y
se queda con el que deja los dos grupos más "puros" (más de una sola clase).
La pureza se mide con el índice de **Gini** (el que usa scikit-learn por
defecto) o la **entropía**. Después repite lo mismo adentro de cada grupo. Es
un algoritmo **goloso**: elige el mejor corte de ahora, sin mirar adelante.

La primera pregunta es por antigüedad porque es la que más separa: de un lado
casi todos vuelven. Por eso la **importancia** de las columnas
(`feature_importances_`, cuánto mejoró la pureza cada una, sumando 1) da
antigüedad 0,477, visitas 0,423, reclamos 0,100 y casi 0 para ticket y edad.

### Profundidad

`max_depth=3` limita a 3 preguntas seguidas. Sin límite, el árbol sigue
preguntando hasta que cada hoja tiene una sola clase: con estos datos, 43
niveles y 2.630 hojas, acierta el 100 % de lo que vio y el 81,5 % de lo nuevo.
Se aprendió el ruido. Ver [teoría 7](07-evaluacion.md).

### Ventajas y desventajas

| Ventaja | Desventaja |
|---|---|
| Se lee: cualquiera entiende las reglas | Un árbol solo es inestable: cambiando un poco los datos puede cambiar mucho |
| No necesita escalar (compara una columna con un corte) | Sobreajusta fácil si no se limita |
| Captura "y" y "o", reglas con forma de L | Los cortes son siempre paralelos a los ejes: una frontera diagonal la aproxima con escalones |
| Rápido de entrenar (17 ms acá, contra segundos de la red) | Predice con escalones, no con una curva suave |

En la industria se usan mucho los **conjuntos de árboles**: muchos árboles
que votan (*random forest*) o que se corrigen uno a otro (*gradient
boosting*). Son de lo mejor que hay para datos en tablas. scikit-learn y
MLlib los traen (`RandomForestClassifier`, `GradientBoostingClassifier` /
`GBTClassifier`), aunque los ejemplos de la imagen no los usan.

## Los resultados, juntos

| Modelo | Aciertos en prueba | Por qué |
|---|---:|---|
| Tonto | 57,3 % | No mira nada |
| Regresión logística | 81,7 % | Frontera recta; la regla tiene forma de L |
| Árbol (profundidad 3) | 90,9 % | Arma la regla con preguntas: llega al techo |
| Red neuronal | 90,6 % | Puede aprender fronteras curvas: llega al techo ([teoría 6](06-redes-neuronales.md)) |

"Aciertos" (*accuracy*) no es la única medida: la matriz de confusión,
precision y recall están en la [teoría 7](07-evaluacion.md).

## En scikit-learn y en Spark

| | scikit-learn | Spark MLlib |
|---|---|---|
| Árbol | `DecisionTreeClassifier(max_depth=3)` | `DecisionTreeClassifier(maxDepth=3, labelCol="vuelve")` |
| Ver el árbol | `export_text(arbol, feature_names=...)` | `modelo.toDebugString` |
| Importancias | `feature_importances_` | `featureImportances` |
| Logística | `make_pipeline(StandardScaler(), LogisticRegression())` | `Pipeline(stages=[StandardScaler(...), LogisticRegression(...)])` |
| Probabilidades | `predict_proba(X)` | Columna `probability` de `transform(df)` |

Una diferencia: MLlib **poda** solo las preguntas que terminan en la misma
clase de los dos lados, así que su árbol queda más corto.

## Para repasar

- Siempre comparar contra el modelo tonto.
- Logística: suma con pesos → sigmoide → probabilidad; frontera recta.
- Árbol: preguntas de sí o no elegidas por pureza (Gini); se lee, no necesita
  escalar, captura reglas con "y" y "o"; hay que limitarle la profundidad.

[← 3. Regresión lineal](03-regresion.md) · [Índice de teoría](README.md) · Siguiente: [5. Clustering con k-means →](05-clustering.md)
