# 1. Qué es machine learning

[Índice de teoría](README.md) · Siguiente: [2. Preparación y calidad de datos →](02-preparacion-de-datos.md)

## La idea

En la programación de siempre, una persona escribe las reglas y la compu las
aplica a los datos:

    reglas + datos → respuestas

En **machine learning** (aprendizaje automático) es al revés: se le dan
datos **con** las respuestas, y la compu busca las reglas:

    datos + respuestas → reglas (el "modelo")

Después el modelo se usa con datos nuevos, de los que no se sabe la
respuesta. Es lo que hace `modelos_sklearn.py`: le da 16.000 clientes con su
gasto y si volvieron, y el modelo encuentra por su cuenta que el gasto sube
1.500 pesos por visita o que los clientes con 36 meses o más vuelven. Nadie
le escribió esas reglas: estaban escondidas en los datos (las escribió
`generar_senal.py`, y por eso podemos comprobar que las encontró).

¿Para qué, si alguien podría escribir las reglas? Porque en la vida real
nadie las sabe: qué clientes van a dejar de comprar, qué transacción es un
fraude, cuánto va a valer una casa. Hay datos de lo que pasó, y el modelo
saca de ahí las reglas.

## Las palabras

| Palabra | Qué es | En los clientes |
|---|---|---|
| **Fila, ejemplo, observación** | Un caso | Un cliente |
| **Variables de entrada, features, atributos** (`X`) | Lo que el modelo puede mirar | `antiguedad_meses`, `visitas_mes`, `ticket_promedio`, `reclamos`, `edad` |
| **Variable objetivo, etiqueta, target** (`y`) | Lo que hay que predecir | `gasto_mes_siguiente` o `vuelve` |
| **Entrenar** (`fit`) | Buscar las reglas con datos que tienen la respuesta | `modelo.fit(X_ent, y_ent)` |
| **Predecir** (`predict`) | Usar las reglas con datos nuevos | `modelo.predict(X_prueba)` |
| **Modelo** | Las reglas que se encontraron | Los coeficientes de la regresión, las preguntas del árbol |
| **Hiperparámetro** | Algo del modelo que se elige antes de entrenar | `max_depth=3` del árbol, `k=3` de KMeans |

Las respuestas **nunca** van entre las variables de entrada. Por eso
`modelos_sklearn.py` define `ENTRADAS` sin `segmento_real`, `gasto` ni
`vuelve`. Si se cuela la respuesta (o algo que solo se sabe después), el
modelo "acierta" en las pruebas y no sirve en la realidad: se llama **fuga de
datos** (*data leakage*). El docstring de `generar_senal.py` avisa: si un
modelo da 99 % en estos datos, algo está mal.

## Supervisado y no supervisado

**Supervisado**: los datos de entrenamiento traen la respuesta. El modelo
aprende a ir de las entradas a la respuesta. Dos tipos, según qué se predice:

| | Predice | Ejemplo en la imagen | Modelos de la imagen |
|---|---|---|---|
| **Regresión** | Un número | Cuánto va a gastar el mes que viene | Regresión lineal |
| **Clasificación** | Una categoría | Si vuelve a comprar (1) o no (0) | Árbol, regresión logística, red neuronal |

Ojo con el nombre: la **regresión logística** es un modelo de
**clasificación**, aunque diga "regresión".

**No supervisado**: no hay respuesta. El modelo busca estructura en los
datos por su cuenta. El caso típico es el **clustering**: armar grupos de
filas parecidas. KMeans recibe solo visitas y ticket de cada cliente y arma 3
grupos; nadie le dice cuáles son los segmentos. `segmento_real` se usa
**después**, solo para medir si los encontró (en la vida real esa columna no
existe: si existiera, el problema sería supervisado).

Otros usos no supervisados (que la imagen no trae): detectar casos raros
(anomalías) y reducir muchas columnas a pocas.

## El proceso completo

Lo que hacen las guías, en orden, es el proceso de cualquier proyecto de ML:

1. **Definir qué se quiere predecir** y con qué datos se cuenta. "¿Vuelve el
   cliente el mes que viene?", con datos de antigüedad, visitas, ticket y
   reclamos.
2. **Juntar y limpiar los datos** (ETL): guías 2, 3 y 6,
   [teoría 2](02-preparacion-de-datos.md). Suele ser la parte más larga.
3. **Mirar los datos**: `describe()`, promedios por grupo, gráficos. Antes de
   modelar se mira (guía 4, "Mirar los datos antes de modelar").
4. **Separar** entrenamiento y prueba ([teoría 7](07-evaluacion.md)).
5. **Entrenar** varios modelos, empezando por uno muy simple que sirva de
   vara (el "tonto" de `DummyClassifier`).
6. **Evaluar** con los datos de prueba y con validación cruzada.
7. **Usar** el modelo con casos nuevos (guía 4, "Usar el modelo con clientes
   nuevos") y volver a medir cada tanto: los datos cambian con el tiempo.

## Qué no puede hacer un modelo

- **Adivinar el ruido.** El 10 % de los `vuelve` se dio vuelta al azar: no
  depende de nada que esté en los datos. Por eso el techo es ~90 %, y el
  error de la regresión no baja de ~1.600 pesos.
- **Usar lo que no ve.** Si lo que decide la respuesta no está en las
  columnas, ningún modelo lo encuentra.
- **Saber qué causa qué.** Encuentra relaciones en los datos, no causas. En
  estos datos sí sabemos las causas porque las escribimos; en datos reales,
  no.
- **Generalizar a casos muy distintos.** Un modelo entrenado con clientes de
  1 a 10 visitas no sabe qué pasa con uno de 50.

## Una compu o un cluster

Los mismos modelos existen en **scikit-learn** (en la memoria de una compu,
[guía 4](../04-modelos-sklearn.md)) y en **Spark MLlib** (repartido en el
cluster, [guía 5](../05-modelos-spark-mllib.md)). Las ideas de este y los
próximos temas valen para los dos; lo que cambia está en la
[teoría 9](09-ml-distribuido-mllib.md).

## Para repasar

- ML: la compu saca las reglas de datos con respuestas, para usarlas con
  datos nuevos.
- Supervisado (hay respuesta): regresión (número) o clasificación
  (categoría). No supervisado (no hay respuesta): clustering.
- La respuesta nunca va entre las entradas.
- El ruido pone un techo que ningún modelo pasa.

[Índice de teoría](README.md) · Siguiente: [2. Preparación y calidad de datos →](02-preparacion-de-datos.md)
