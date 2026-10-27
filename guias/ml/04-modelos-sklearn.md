# 4. Modelos con scikit-learn

Generar 20.000 clientes con reglas **conocidas** y entrenar sobre ellos una
regresión lineal, un árbol de decisión, una regresión logística, una red
neuronal y KMeans. Como sabemos la regla que armó los datos, podemos ver qué
aprendió cada modelo y qué no.

[← 3. El mismo ETL con Spark](03-etl-spark.md) · [Índice de ml](README.md) · Siguiente: [5. Los mismos modelos con Spark MLlib →](05-modelos-spark-mllib.md)

## Antes de empezar

- El contenedor `:ml` andando ([guía 1](01-arrancar-y-jupyterlab.md)). Esta
  guía no usa Hadoop: scikit-learn trabaja en la memoria del contenedor.
- Teoría que acompaña: [qué es ML](teoria/01-que-es-ml.md),
  [regresión](teoria/03-regresion.md), [clasificación](teoria/04-clasificacion.md),
  [clustering](teoria/05-clustering.md), [redes neuronales](teoria/06-redes-neuronales.md)
  y [evaluación](teoria/07-evaluacion.md).

Todo se corre desde `/datos`, en la terminal de JupyterLab o con
`docker exec -it bigdata bash`.

## Qué vamos a hacer y por qué

Con datos reales nunca se sabe cuál es "la verdad": si un modelo acierta el
85 %, no sabés si se podía más. Por eso `generar_senal.py` arma clientes con
fórmulas escritas en el código, y le agrega ruido como en la vida real. Así
cada resultado se puede comparar con la respuesta correcta:

| Columna | Qué es | De dónde sale |
|---|---|---|
| `antiguedad_meses` | Meses como cliente | Al azar, 1 a 60 |
| `visitas_mes` | Compras por mes | Depende del segmento |
| `ticket_promedio` | Gasto promedio por compra | Depende del segmento |
| `reclamos` | Reclamos hechos | Al azar, 0 a 5, más probables los pocos |
| `edad` | Edad | Al azar, 18 a 80. **No influye en nada**, a propósito |
| `segmento_real` | ocasional, frecuente o mayorista | La respuesta del clustering |
| `gasto_mes_siguiente` | Cuánto gasta el mes que viene | La respuesta de la regresión |
| `vuelve` | Si vuelve a comprar (1) o no (0) | La respuesta de la clasificación |

Las reglas, tal cual están en el código:

- **Segmentos**: ocasional (60 %, 1 a 3 visitas, ticket alrededor de 6.000),
  frecuente (30 %, 4 a 10 visitas, ticket alrededor de 9.000) y mayorista
  (10 %, 1 a 6 visitas, ticket alrededor de 60.000).
- **Gasto** = 5000 + 1500 × visitas + 0,8 × ticket − 1500 × reclamos + 50 ×
  antigüedad + un ruido al azar (normal, desvío 2000).
- **Vuelve** si (visitas ≥ 4 **y** reclamos ≤ 1) **o** antigüedad ≥ 36. Y al
  10 % de los clientes se le da vuelta la respuesta: es ruido que **ningún**
  modelo puede adivinar.

## Generar los clientes

<!-- prueba: adentro | espera: Listo: 20000 clientes en clientes_senal.csv -->
```bash
python3 ejemplos/ml/generar_senal.py
```

Muestra las cinco primeras filas, cuántos hay de cada segmento (alrededor de
12.000 ocasionales, 6.000 frecuentes y 2.000 mayoristas), qué porcentaje
vuelve (un poco más de la mitad) y cuántas respuestas se dieron vuelta (el
10 %). Usa una semilla fija: el archivo sale **idéntico** en cualquier compu,
y la prueba de la imagen lo comprueba.

Opcional: `python3 ejemplos/ml/generar_senal.py 100000 grande.csv` arma
100.000 en otro archivo.

## Mirar los datos antes de modelar

Siempre primero se mira. En un notebook nuevo (en `/datos`):

<!-- prueba: no (celda de JupyterLab) -->
```python
import pandas as pd

clientes = pd.read_csv("clientes_senal.csv")
clientes.describe().round(1)
```

`describe()` da, por columna, cantidad, promedio, desvío, mínimo, cuartiles y
máximo. Fijate en `ticket_promedio`: el promedio (unos 12.800) queda muy lejos
de la mediana (el 50 %), porque unos pocos mayoristas tiran para arriba; el
máximo pasa los 170.000.

<!-- prueba: no (celda de JupyterLab) -->
```python
clientes.groupby("segmento_real")[["visitas_mes", "ticket_promedio", "gasto_mes_siguiente"]].mean().round(1)
```

Los tres segmentos se separan bien: los frecuentes con unas 7 visitas, los
ocasionales con 2 y los mayoristas con tickets de unos 62.000.

¿Qué tan bien anda la **regla real** para predecir `vuelve`?

<!-- prueba: no (celda de JupyterLab) -->
```python
regla = ((clientes["visitas_mes"] >= 4) & (clientes["reclamos"] <= 1)) | (clientes["antiguedad_meses"] >= 36)
print((regla.astype(int) == clientes["vuelve"]).mean())
pd.crosstab(regla, clientes["vuelve"])
```

Acierta el 90 %: el 10 % restante es justo el ruido. Eso es el **techo**:
ningún modelo va a pasar de ahí en datos que no vio. Si uno lo pasa en los
datos de entrenamiento, se está aprendiendo el ruido (ver más abajo).

## Correr los modelos

<!-- prueba: adentro | espera: antiguedad_meses <= 35.50 | espera: visitas_mes <= 3.50 | espera: Metricas: metricas_sklearn.json -->
```bash
python3 ejemplos/ml/modelos_sklearn.py
```

Tarda unos segundos (la red neuronal es lo más lento). Deja
`metricas_sklearn.json` y el gráfico `clusters_sklearn.png` en `/datos`. La
salida tiene tres partes; abajo, qué quiere decir cada una. Los números son
los que dio con las versiones de la imagen y pueden moverse en el último
decimal en otro procesador.

### Separar para entrenar y para probar

Lo primero que imprime: *16000 clientes para entrenar, 4000 para probar*.
`train_test_split(..., test_size=0.2, random_state=42)` sortea el 20 % y lo
guarda: los modelos aprenden con el 80 % y se miden con el 20 % que **no
vieron**, como un examen con ejercicios nuevos. `random_state` fija el
sorteo, así siempre son los mismos.

### 1. Regresión lineal: cuánto va a gastar

Muestra, para cada columna, el coeficiente **aprendido** al lado del de la
**regla real**:

| | Aprendido | Regla real |
|---|---:|---:|
| (constante) | 4972,4 | 5000 |
| antiguedad_meses | 50,24 | 50 |
| visitas_mes | 1507,16 | 1500 |
| ticket_promedio | 0,80 | 0,8 |
| reclamos | −1503,02 | −1500 |
| edad | 0,16 | 0 |

Encontró la fórmula. `edad` queda casi en 0: el modelo descubrió que no sirve.
Después:

- **R² en prueba: 0,983.** Qué parte de la variación del gasto explica el
  modelo (1 = todo). Alto porque los datos salieron de una fórmula lineal.
- **Error medio: unos 1.600 pesos** (MAE: el promedio de cuánto le erra, en
  pesos). No baja de ahí: es el ruido de la fórmula, que no depende de nada
  que el modelo pueda ver.
- **Validación cruzada: R² 0,982 ± 0,001.** Lo mismo medido 5 veces con
  partes distintas: no fue suerte del sorteo.

### 2. Clasificación: ¿vuelve a comprar?

Una tabla con cuatro modelos:

| Modelo | Aciertos en prueba | Validación cruzada |
|---|---:|---:|
| tonto (siempre lo más común) | 57,3 % | 57,6 % |
| árbol de decisión (profundidad 3) | 90,9 % | 90,0 % |
| regresión logística | 81,7 % | 81,0 % |
| red neuronal (MLP) | 90,6 % | 89,8 % |

Además muestra cuánto tardó en entrenar cada uno y cuánta memoria usó. Cómo
leerla:

- **El tonto** siempre dice "vuelve" (lo más común): acierta lo mismo que el
  porcentaje de clientes que vuelven. Es la vara mínima: un modelo que no le
  gana no aprendió nada.
- **El árbol y la red** llegan al techo del 90 %. La regla real es un "o" de
  dos condiciones, y eso un árbol lo arma con preguntas de sí o no.
- **La logística** queda abajo: separa las clases con una **recta** (un
  plano, con 5 columnas), y la regla real no es una recta.
- **La red** acierta como el árbol pero tarda cientos de veces más en
  entrenar (segundos contra milisegundos) y no se puede leer qué aprendió.

Después muestra **lo que aprendió el árbol**, como preguntas anidadas
(`export_text`). La primera pregunta es `antiguedad_meses <= 35.50` y,
debajo, `visitas_mes <= 3.50` y `reclamos <= 1.50`: son los cortes de la regla
real (`<= 3.50` es lo mismo que `< 4`, porque el árbol corta entre dos
valores). Algunas preguntas terminan con la misma clase en las dos ramas: no
cambian nada, el árbol las agregó por el ruido.

Y la **importancia** de cada columna (suma 1): antigüedad 0,477, visitas
0,423, reclamos 0,100, ticket y edad prácticamente 0. El árbol descubrió solo
qué columnas importan.

### 3. Clustering: grupos sin decirle cuáles son

KMeans busca 3 grupos de clientes parecidos usando **solo** las visitas y el
ticket. `segmento_real` se usa al final, para ver si los encontró:

- **Rand ajustado sin escalar: 0,30; escalado: 0,83** (1 = los mismos grupos
  que los reales, 0 = al azar). Sin escalar, el ticket (miles de pesos) tapa
  a las visitas (de 1 a 10) en las distancias. Escalado (y el ticket en
  logaritmo), las dos pesan parecido.
- **La tabla de grupos contra segmentos**: un grupo junta a los 1.991
  mayoristas; otro, a casi todos los ocasionales con unos 1.000 frecuentes; y
  el tercero, unos 5.000 frecuentes. Los frecuentes de 4 visitas quedan con
  los ocasionales de 3: están más cerca de ellos.
- **Silhouette** para k = 2 a 5 (qué tan separados quedan los grupos; más es
  mejor): el mejor es k=3, con 0,634. Así se elige k cuando no se sabe
  cuántos grupos hay.

El gráfico, en una celda:

<!-- prueba: no (celda de JupyterLab) -->
```python
from IPython.display import Image
Image("clusters_sklearn.png")
```

Visitas en el eje horizontal, ticket (en escala logarítmica) en el vertical y
un color por grupo: se ven los mayoristas arriba y los otros dos abajo,
cortados alrededor de las 3 o 4 visitas.

## Usar el modelo con clientes nuevos

Para eso se entrena: para predecir casos que todavía no pasaron. En un
notebook, con el mismo sorteo del script:

<!-- prueba: no (celda de JupyterLab) -->
```python
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X, y = clientes[ENTRADAS], clientes["vuelve"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(X, y, test_size=0.2, random_state=42)
arbol = DecisionTreeClassifier(max_depth=3, random_state=42).fit(X_ent, y_ent)

nuevos = pd.DataFrame({"antiguedad_meses": [40, 10, 10], "visitas_mes": [1, 6, 6],
                       "ticket_promedio": [5000, 9000, 9000], "reclamos": [0, 0, 3],
                       "edad": [30, 30, 30]})
print(arbol.predict(nuevos))
print(arbol.predict_proba(nuevos).round(2))
```

Da `1`, `1` y `0`, con probabilidades de 0,9 o 0,1: el primero vuelve por
antigüedad, el segundo por visitas, el tercero no (mismas visitas, pero 3
reclamos). Coincide con la regla. Las columnas tienen que tener **los mismos
nombres** que al entrenar.

## Más allá de "aciertos": la matriz de confusión

<!-- prueba: no (celda de JupyterLab) -->
```python
from sklearn.metrics import confusion_matrix, classification_report

prediccion = arbol.predict(X_prueba)
print(confusion_matrix(y_prueba, prediccion))
print(classification_report(y_prueba, prediccion, digits=3))
```

La matriz da `[[1485, 223], [140, 2152]]`: filas = lo real (0, 1), columnas
= lo que dijo el modelo. De los 1.708 que no vuelven, acertó 1.485 y a 223
les dijo que sí (falsos positivos); de los 2.292 que vuelven, a 140 les dijo
que no (falsos negativos). El reporte resume eso en **precision** (de los que
dijo "vuelve", cuántos volvieron: 0,906) y **recall** (de los que volvieron,
cuántos encontró: 0,939). La [teoría 7](teoria/07-evaluacion.md) explica cuándo
importa cada una.

## Sobreajuste: el árbol que se aprende el ruido

`max_depth=3` no es casualidad. Probá varias profundidades y compará
entrenamiento contra prueba:

<!-- prueba: no (celda de JupyterLab) -->
```python
for profundidad in [1, 2, 3, 5, 10, None]:
    a = DecisionTreeClassifier(max_depth=profundidad, random_state=42).fit(X_ent, y_ent)
    print(f"max_depth={profundidad}: entrenamiento {a.score(X_ent, y_ent):.3f},"
          f" prueba {a.score(X_prueba, y_prueba):.3f}, hojas {a.get_n_leaves()}")
```

| `max_depth` | Entrenamiento | Prueba | Hojas |
|---|---:|---:|---:|
| 1 | 0,753 | 0,761 | 2 |
| 2 | 0,876 | 0,885 | 4 |
| 3 | 0,898 | 0,909 | 8 |
| 5 | 0,899 | 0,907 | 30 |
| 10 | 0,905 | 0,900 | 225 |
| None (sin límite) | 1,000 | 0,815 | 2630 |

- Con 1 o 2 preguntas no alcanza: le faltan condiciones (**subajuste**).
- Con 3 llega al techo. Más profundidad no mejora la prueba.
- Sin límite acierta el **100 %** de lo que vio y solo el 81,5 % de lo nuevo:
  armó 2.630 hojas para memorizar cada cliente, ruido incluido
  (**sobreajuste**). Por eso nunca se mide con los datos de entrenamiento.

La profundidad es un **hiperparámetro**: no lo aprende el modelo, lo elegís
vos. Bien elegido, con validación cruzada: en la [guía 5](05-modelos-spark-mllib.md)
Spark lo hace solo con `CrossValidator`.

## Qué hiciste

- Generaste datos con reglas conocidas y comprobaste el techo del 90 %.
- Corriste `modelos_sklearn.py`: la regresión encontró la fórmula, el árbol
  encontró la regla, la logística no puede con un "o" y KMeans encontró los
  segmentos, pero solo con los datos escalados.
- Usaste el árbol con clientes nuevos, leíste la matriz de confusión y viste
  el sobreajuste.

Siguiente: [5. Los mismos modelos con Spark MLlib →](05-modelos-spark-mllib.md)
