# Evaluación 1. Qué es machine learning

[Índice de evaluación](README.md) · Teoría: [1. Qué es machine learning](../teoria/01-que-es-ml.md) · Siguiente: [2. Preparación de datos →](02-preparacion-de-datos.md)

## Multiple choice

**1.** En `clientes_senal.csv`, si se quiere predecir `vuelve`, ¿cuáles son
las variables de entrada que usan los ejemplos?

- a) Todas las columnas del archivo.
- b) `antiguedad_meses`, `visitas_mes`, `ticket_promedio`, `reclamos` y `edad`.
- c) `segmento_real` y `gasto_mes_siguiente`, porque están muy relacionadas con `vuelve`.
- d) Solo `visitas_mes`, porque es la que más importa.

<details><summary>Respuesta</summary>

**b)**. Son las de la lista `ENTRADAS` de `modelos_sklearn.py` y
`modelos_spark.py`: lo que se sabe de un cliente **hoy**.

- a) No: el archivo trae también las respuestas (`gasto_mes_siguiente`,
  `vuelve`, `segmento_real`). Usar `vuelve` para predecir `vuelve` es hacer
  trampa.
- c) No: `gasto_mes_siguiente` es del **mes que viene**, no se conoce cuando
  hay que predecir; y `segmento_real` existe solo porque los datos son
  generados. Usarlas sería una **fuga de datos**: el modelo parecería
  buenísimo y en la vida real no se podría usar.
- d) No: la regla depende también de los reclamos y la antigüedad. Elegir
  qué columnas importan es justamente lo que hace el modelo.

</details>

**2.** Predecir cuánto va a gastar un cliente el mes que viene es un problema
de:

- a) Clasificación.
- b) Clustering.
- c) Regresión.
- d) Aprendizaje no supervisado.

<details><summary>Respuesta</summary>

**c)**. La respuesta es un **número** (pesos), y se aprende de ejemplos con la
respuesta conocida.

- a) No: clasificación predice una categoría (vuelve / no vuelve).
- b) y d) No: clustering es no supervisado, no tiene respuesta; acá sí la
  hay (`gasto_mes_siguiente`).

</details>

**3.** KMeans arma grupos de clientes con `visitas_mes` y `ticket_promedio`.
¿Por qué se dice que es **no supervisado**?

- a) Porque nadie revisa los resultados.
- b) Porque se entrena sin una columna de respuestas: `segmento_real` no se
  le pasa.
- c) Porque usa solo dos columnas.
- d) Porque no tiene hiperparámetros.

<details><summary>Respuesta</summary>

**b)**. Supervisado y no supervisado se distinguen por si se entrena con
respuestas o no. `segmento_real` se usa **después**, solo para medir.

- a) No: el nombre no tiene que ver con revisar. De hecho se mide con el
  Rand ajustado.
- c) No: la cantidad de columnas no cambia el tipo de aprendizaje.
- d) No: KMeans tiene un hiperparámetro central, `k` (la cantidad de
  grupos).

</details>

**4.** ¿Cuál de estos es un **hiperparámetro**?

- a) Los coeficientes de la regresión lineal.
- b) Las preguntas que encontró el árbol.
- c) `max_depth=3` del árbol de decisión.
- d) La columna `vuelve`.

<details><summary>Respuesta</summary>

**c)**. Se elige **antes** de entrenar, y el modelo no lo cambia.

- a) y b) No: son lo que el modelo **aprende** al entrenar (sus parámetros).
- d) No: es la variable objetivo.

</details>

**5.** El árbol de los ejemplos acierta el 90,9 % de los clientes de prueba.
¿Por qué ningún modelo puede llegar a 100 %?

- a) Porque 20.000 clientes son pocos.
- b) Porque falta una columna importante.
- c) Porque el 10 % de las respuestas se dio vuelta al azar al generar los
  datos, y ese ruido no depende de nada que el modelo vea.
- d) Porque scikit-learn redondea los resultados.

<details><summary>Respuesta</summary>

**c)**. `generar_senal.py` da vuelta el 10 % de los `vuelve`. Ese 10 % es
imposible de adivinar: el techo es ~90 %.

- a) No: con más clientes el techo sigue siendo 90 %; los datos alcanzan para
  encontrar la regla (el árbol la encuentra).
- b) No: la regla usa solo columnas que el modelo ve (visitas, reclamos,
  antigüedad).
- d) No: no hay redondeo en las predicciones.

</details>

**6.** Un modelo dice que los clientes con más reclamos gastan menos. ¿Qué se
puede concluir?

- a) Que los reclamos **causan** que gasten menos, y hay que evitar que
  reclamen.
- b) Que en estos datos están relacionados; para saber si una cosa causa la
  otra hace falta otro tipo de estudio.
- c) Que el modelo está mal, porque los reclamos no deberían importar.
- d) Nada, porque los modelos no encuentran relaciones.

<details><summary>Respuesta</summary>

**b)**. Un modelo encuentra relaciones, no causas. Acá, por cómo se
generaron los datos, sabemos que es causal (la fórmula resta 1500 por
reclamo), pero en datos reales podría ser al revés o un tercer factor (los
que compran poco y mal reclaman más, por ejemplo).

- a) No: eso es saltar de relación a causa.
- c) No: la fórmula real los usa, y el modelo encuentra −1503, muy cerca de
  −1500.
- d) No: encontrar relaciones es justamente lo que hacen.

</details>

**7.** ¿Qué hace `modelo.fit(X_ent, y_ent)` en scikit-learn?

- a) Predice las respuestas de `X_ent`.
- b) Busca las reglas (entrena) con las entradas y sus respuestas.
- c) Separa los datos en entrenamiento y prueba.
- d) Mide los aciertos.

<details><summary>Respuesta</summary>

**b)**. `fit` es entrenar.

- a) No: eso es `predict`.
- c) No: eso es `train_test_split`.
- d) No: eso es `accuracy_score` (o `score`).

</details>

## Preguntas de desarrollo

**1.** Explicá con un ejemplo de la imagen la diferencia entre programar una
regla y aprenderla de los datos.

<details><summary>Respuesta modelo</summary>

Programar: alguien sabe la regla y la escribe, por ejemplo `if (visitas >= 4
and reclamos <= 1) or antiguedad >= 36: vuelve`. Aprender: no se conoce la
regla; se le dan al modelo miles de clientes con la respuesta (`vuelve`) y el
modelo busca una regla que la reproduzca. En la imagen se puede comparar,
porque los datos se generaron con una regla conocida: el árbol de
profundidad 3 encuentra `antiguedad_meses <= 35.50` y `visitas_mes <= 3.50`,
que son los mismos cortes (36 y 4) que la regla real. En la vida real la
regla no se conoce, y por eso se aprende.

Puntos que tiene que tocar: quién escribe la regla, que el modelo aprende de
ejemplos con respuesta, que se puede verificar en la imagen porque la regla
es conocida.

</details>

**2.** Describí las etapas de un proyecto de machine learning, desde los
datos crudos hasta usar el modelo, nombrando qué guía de `ml` hace cada una.

<details><summary>Respuesta modelo</summary>

1. Juntar los datos (en la imagen, los generadores; en la vida real,
   sistemas, MongoDB, HDFS: guía 6 para MongoDB).
2. Limpiarlos y prepararlos (ETL: guías 2 y 3).
3. Explorar: mirar distribuciones y relaciones (guía 4, primeras celdas).
4. Separar entrenamiento y prueba.
5. Entrenar varios modelos y compararlos, eligiendo hiperparámetros con
   validación cruzada (guías 4 y 5).
6. Evaluar el elegido con la prueba, contra el modelo tonto.
7. Usarlo con datos nuevos (`predict` de clientes nuevos, guía 4) y vigilar
   que siga andando.

Tiene que mencionar que preparar datos es una etapa grande, y que la prueba
se usa al final.

</details>

**3.** Nombrá dos cosas que un modelo no puede hacer, con un ejemplo de los
clientes para cada una.

<details><summary>Respuesta modelo</summary>

Dos cualesquiera de:

- Adivinar el ruido: el 10 % de `vuelve` dado vuelta; techo ~90 %.
- Usar lo que no ve: si la respuesta dependiera de algo que no está en las
  columnas (por ejemplo, si el cliente se mudó), el modelo no podría.
- Saber qué causa qué: encuentra que más reclamos va con menos gasto, no que
  uno cause lo otro.
- Generalizar a casos muy distintos: entrenado con clientes de 1 a 10 visitas,
  no sabe qué hacer con uno de 50.

</details>

## Ejercicios prácticos

### Ejercicio 1. El modelo tonto, a mano

Hecha la [guía 4](../04-modelos-sklearn.md) (tiene que existir
`/datos/clientes_senal.csv`). En un notebook nuevo:

1. Leé `clientes_senal.csv` con pandas.
2. Calculá qué porcentaje de los clientes vuelve.
3. Calculá el porcentaje que vuelve en cada `segmento_real`.
4. Contestá: ¿cuánto acertaría un modelo que dice siempre "vuelve"? ¿Por qué
   cualquier modelo tiene que ganarle a ese número?

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd

clientes = pd.read_csv("clientes_senal.csv")
print(clientes["vuelve"].mean())
print(clientes.groupby("segmento_real")["vuelve"].mean().round(3))
```

| Qué | Valor |
|---|---|
| Vuelve, sobre todos | 0,5765 (11.530 de 20.000) |
| frecuente | 0,846 |
| mayorista | 0,638 |
| ocasional | 0,429 |

Decir siempre "vuelve" acierta el 57,65 % de todos los clientes (en la parte
de prueba, 57,3 %: es lo que da el `DummyClassifier` de la guía 4). Un modelo
que no le gana a eso no aprendió nada de las columnas: el porcentaje sale de
contar, sin mirar a ningún cliente.

Los frecuentes vuelven más porque la regla pide 4 visitas o más, y los
frecuentes tienen de 4 a 10.

</details>

| Criterio | Puntos |
|---|---:|
| Lee el archivo y calcula el porcentaje total bien | 3 |
| Calcula por segmento con `groupby` | 3 |
| Explica que el tonto acierta ~57 % y por qué es el piso | 3 |
| Relaciona el resultado por segmento con la regla | 1 |

### Ejercicio 2. Lo que el modelo no ve

Hecha la guía 4. Entrená una regresión lineal que prediga
`gasto_mes_siguiente` usando **solo** `edad`, con la misma separación de los
ejemplos (`test_size=0.2, random_state=42`). Medí el R² en la prueba y
explicá el resultado con la regla del gasto de la
[teoría](../teoria/README.md).

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score
from sklearn.model_selection import train_test_split

clientes = pd.read_csv("clientes_senal.csv")
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[["edad"]], clientes["gasto_mes_siguiente"], test_size=0.2, random_state=42)
modelo = LinearRegression().fit(X_ent, y_ent)
print(r2_score(y_prueba, modelo.predict(X_prueba)))
```

El R² da prácticamente 0 (−0,001). La fórmula del gasto no usa la edad: la
edad no tiene ninguna información sobre el gasto, y el mejor modelo posible
con esa sola columna es decir siempre el promedio (que es lo que mide un R²
de 0). Un R² apenas negativo significa que en la prueba le fue un poco peor
que el promedio. Con las cinco columnas, la guía 4 llega a 0,983.

</details>

| Criterio | Puntos |
|---|---:|
| Usa `[["edad"]]` (tabla de una columna, no una serie) y la misma separación | 3 |
| Mide el R² en la prueba, no en el entrenamiento | 3 |
| Explica que la edad no está en la fórmula | 3 |
| Explica qué significa un R² de 0 | 1 |

[Índice de evaluación](README.md) · Teoría: [1. Qué es machine learning](../teoria/01-que-es-ml.md) · Siguiente: [2. Preparación de datos →](02-preparacion-de-datos.md)
