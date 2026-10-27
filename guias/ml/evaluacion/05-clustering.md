# Evaluación 5. Clustering con k-means

[← 4. Clasificación](04-clasificacion.md) · [Índice de evaluación](README.md) · Teoría: [5. Clustering](../teoria/05-clustering.md) · Siguiente: [6. Redes neuronales →](06-redes-neuronales.md)

## Multiple choice

**1.** ¿Qué repite k-means hasta que los centros dejan de moverse?

- a) Sortear grupos nuevos y quedarse con el mejor.
- b) Asignar cada punto al centro más cercano y mover cada centro al promedio
  de sus puntos.
- c) Partir el grupo más grande en dos.
- d) Juntar los dos puntos más cercanos.

<details><summary>Respuesta</summary>

**b)**. Esos dos pasos, alternados, bajan la inercia (la suma de distancias
al cuadrado de cada punto a su centro) hasta que se estabiliza.

- a) No: sortea solo los centros iniciales (y `n_init=10` repite todo 10
  veces con distintos comienzos).
- c) No: eso es otro método (k-means bisectante).
- d) No: eso es el agrupamiento jerárquico, que la imagen no usa.

</details>

**2.** Sin escalar, KMeans da un Rand ajustado de 0,30; escalando, 0,83. ¿Por
qué tanta diferencia?

- a) Porque escalar agrega información nueva.
- b) Porque KMeans mide distancias: sin escalar, el ticket (miles de pesos)
  tapa a las visitas (de 1 a 10) y agrupa casi solo por ticket.
- c) Porque sin escalar KMeans no converge.
- d) Porque el escalado cambia la cantidad de grupos.

<details><summary>Respuesta</summary>

**b)**. En la distancia euclídea, una diferencia de 1.000 pesos pesa como
1.000 visitas. Escaladas, las dos columnas pesan parecido.

- a) No: escalar no agrega información; cambia cuánto pesa cada columna.
- c) No: converge igual, a grupos peores.
- d) No: `k` es 3 en los dos casos.

</details>

**3.** ¿Para qué se usa `segmento_real` en `modelos_sklearn.py`?

- a) Para entrenar KMeans.
- b) Para elegir `k`.
- c) Solo al final, para medir con el Rand ajustado si los grupos coinciden
  con los segmentos con que se generaron los datos.
- d) Para escalar.

<details><summary>Respuesta</summary>

**c)**. KMeans es no supervisado: no ve la respuesta. Se la usa para
evaluar porque, siendo datos generados, se la conoce; en la vida real no.

- a) No: si entrenara con eso sería supervisado.
- b) No: `k` se fija en 3; para elegirlo sin respuesta está el silhouette.
- d) No: el escalador usa solo las columnas de entrada.

</details>

**4.** El Rand ajustado da 1 si los grupos son iguales a los reales. ¿Qué
pasa si KMeans llama "grupo 2" a lo que en la realidad es "frecuente"?

- a) Baja a 0.
- b) No importa: el Rand ajustado mira qué pares de clientes quedan juntos o
  separados, no el número de cada grupo.
- c) Da negativo.
- d) Da error, porque los nombres no coinciden.

<details><summary>Respuesta</summary>

**b)**. Los números de grupo son arbitrarios. El índice compara cada par de
clientes: si los dos agrupamientos los ponen juntos (o separados), suma.

- a) y c) No: con los mismos grupos, aunque con otros números, da 1.
- d) No: acepta etiquetas de cualquier tipo.

</details>

**5.** El silhouette para k = 2, 3, 4 y 5 da 0,539, 0,634, 0,501 y 0,399.
¿Qué k elegirías y por qué?

- a) 5, porque son más grupos y más detalle.
- b) 2, porque es el más simple.
- c) 3, porque es el silhouette más alto: los grupos quedan mejor separados.
- d) No se puede elegir sin `segmento_real`.

<details><summary>Respuesta</summary>

**c)**. El silhouette compara la distancia a los del propio grupo con la del
grupo vecino: más alto, mejor separados. Coincide con los 3 segmentos reales.

- a) No: más grupos no es mejor; el silhouette baja porque se parten grupos
  que estaban bien.
- b) No: el más simple no es el que mejor separa.
- d) No: justamente el silhouette sirve **sin** la respuesta.

</details>

**6.** ¿Por qué no sirve elegir el k con **menor inercia**?

- a) Porque la inercia siempre baja al subir k: con un grupo por punto es 0.
- b) Porque la inercia no se puede calcular.
- c) Porque la inercia sube con k.
- d) Sí sirve: es el mejor método.

<details><summary>Respuesta</summary>

**a)**. Por eso, con la inercia, se usa el **codo**: el k a partir del cual
deja de bajar mucho.

- b) No: KMeans la calcula (`inertia_`).
- c) No: baja.
- d) No: siempre elegiría el k más grande probado.

</details>

**7.** ¿Cuál de estas es una limitación de k-means?

- a) Solo funciona con dos columnas.
- b) Supone grupos más o menos redondos y de tamaño parecido; un grupo con
  forma de banana lo corta mal.
- c) No se puede usar en Spark.
- d) Necesita la respuesta para entrenar.

<details><summary>Respuesta</summary>

**b)**. Asigna al centro más cercano: las fronteras entre grupos son rectas
a mitad de camino entre centros.

- a) No: funciona con cualquier cantidad de columnas numéricas.
- c) No: MLlib tiene `KMeans` (guía 5).
- d) No: es no supervisado.

</details>

## Preguntas de desarrollo

**1.** Mirá la tabla de grupos contra segmentos de la guía 4. ¿Por qué unos
1.000 frecuentes quedan en el grupo de los ocasionales? ¿Es un error del
algoritmo?

<details><summary>Respuesta modelo</summary>

Los frecuentes tienen de 4 a 10 visitas y los ocasionales de 1 a 3, con
tickets parecidos (~9.000 y ~6.000). Un frecuente con 4 visitas está más
cerca del centro de los ocasionales (unas 2 visitas) que del de los
frecuentes (más de 7): KMeans asigna por distancia y lo manda con los
ocasionales. No es un error del algoritmo: hace lo que promete (minimizar
distancias). Los segmentos reales se definieron con una regla que KMeans no
conoce. En datos reales pasa lo mismo: los grupos se tocan.

</details>

**2.** Una empresa quiere segmentar a sus clientes con k-means usando edad,
ingresos mensuales y cantidad de compras. ¿Qué pasos de preparación harías y
qué tendrías en cuenta para elegir k?

<details><summary>Respuesta modelo</summary>

- Limpiar: nulos, outliers (un ingreso cargado de más movería un centro).
- Transformar montos muy desparejos (ingresos) con logaritmo.
- **Escalar** las tres columnas (`StandardScaler`): si no, los ingresos
  tapan todo.
- Probar varios k con silhouette (sobre una muestra si son muchos) y el
  codo de la inercia.
- Mirar los centros de cada grupo y ver si tienen sentido para el negocio:
  el k "mejor" en números puede no ser útil.

</details>

## Ejercicios prácticos

### Ejercicio 1. ¿Escalar o el logaritmo?

Hecha la [guía 4](../04-modelos-sklearn.md). `modelos_sklearn.py` hace dos
cosas antes de KMeans: logaritmo del ticket y `StandardScaler`. Averiguá
cuál de las dos hace la diferencia: corré KMeans (`n_clusters=3, n_init=10,
random_state=42`) sobre las visitas y el ticket **escalados sin logaritmo**,
y compará el Rand ajustado con el 0,30 (sin nada) y el 0,83 (las dos cosas).

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import adjusted_rand_score
from sklearn.preprocessing import StandardScaler

clientes = pd.read_csv("clientes_senal.csv")
escalados = StandardScaler().fit_transform(clientes[["visitas_mes", "ticket_promedio"]])
grupos = KMeans(n_clusters=3, n_init=10, random_state=42).fit_predict(escalados)
print(adjusted_rand_score(clientes["segmento_real"], grupos))
```

| Preparación | Rand ajustado |
|---|---:|
| Nada | 0,30 |
| Solo escalar | 0,84 |
| Logaritmo y escalar (el script) | 0,83 |

Lo que hace la diferencia es **escalar**. Con estos datos, el logaritmo casi
no cambia el resultado. Conclusión: no hay que asumir que un paso de
preparación sirve; se prueba y se mide. (El logaritmo igual es una
costumbre sana con montos de dinero: con otros datos sí puede ayudar.)

</details>

| Criterio | Puntos |
|---|---:|
| Escala sin logaritmo y usa los mismos hiperparámetros | 3 |
| Llega a ~0,84 | 3 |
| Concluye que lo que importa es escalar | 2 |
| Comenta que hay que medir cada paso en vez de suponer | 2 |

### Ejercicio 2. El codo

Hecha la guía 4. Con las columnas preparadas como en el script (logaritmo del
ticket y escalado), calculá la inercia de KMeans para k de 1 a 6 y graficala.
¿Dónde está el codo? ¿Coincide con el silhouette?

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler

clientes = pd.read_csv("clientes_senal.csv")
escalados = StandardScaler().fit_transform(
    np.column_stack([clientes["visitas_mes"], np.log(clientes["ticket_promedio"])]))
inercias = [KMeans(n_clusters=k, n_init=10, random_state=42).fit(escalados).inertia_ for k in range(1, 7)]
print([round(i) for i in inercias])
plt.plot(range(1, 7), inercias, marker="o")
plt.xlabel("k")
plt.ylabel("inercia")
plt.show()
```

| k | Inercia |
|---|---:|
| 1 | 40.000 |
| 2 | 20.699 |
| 3 | 8.133 |
| 4 | 6.106 |
| 5 | 4.902 |
| 6 | 4.189 |

Con k = 1 la inercia es 40.000: 20.000 clientes × 2 columnas, cada una con
varianza 1 después de escalar. Baja mucho hasta k = 3 y después poco: el
codo está en 3, igual que el máximo del silhouette (0,634).

</details>

| Criterio | Puntos |
|---|---:|
| Prepara las columnas igual que el script | 2 |
| Calcula las 6 inercias y grafica | 3 |
| Identifica el codo en 3 | 3 |
| Lo relaciona con el silhouette (o explica el 40.000) | 2 |

[← 4. Clasificación](04-clasificacion.md) · [Índice de evaluación](README.md) · Teoría: [5. Clustering](../teoria/05-clustering.md) · Siguiente: [6. Redes neuronales →](06-redes-neuronales.md)
