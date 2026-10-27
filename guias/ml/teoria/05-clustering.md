# 5. Clustering con k-means

[← 4. Clasificación](04-clasificacion.md) · [Índice de teoría](README.md) · Siguiente: [6. Redes neuronales básicas →](06-redes-neuronales.md)

## Qué hace

**Clustering** (agrupamiento) es armar grupos de filas parecidas **sin**
respuestas: es aprendizaje **no supervisado**. Se usa para segmentar
clientes, agrupar productos que se compran juntos, ordenar documentos por
tema o encontrar casos que no se parecen a ningún grupo.

En la imagen: KMeans recibe, de cada cliente, solo las visitas por mes y el
ticket promedio, y arma 3 grupos. La columna `segmento_real` (ocasional,
frecuente, mayorista) **no** se usa para entrenar; se usa al final para medir
si los grupos coinciden con los segmentos con los que se generaron los datos.

## El algoritmo

k-means busca `k` grupos, cada uno representado por su **centro** (el
promedio de sus puntos):

1. Elegir `k` centros iniciales (al azar, o con un método más cuidadoso,
   *k-means++*, que es el de scikit-learn).
2. **Asignar** cada punto al centro más cercano.
3. **Mover** cada centro al promedio de los puntos que le tocaron.
4. Repetir 2 y 3 hasta que los centros dejan de moverse.

Lo que minimiza es la suma de las distancias al cuadrado de cada punto a su
centro (la **inercia**). Como el resultado depende de dónde arranca,
`n_init=10` lo corre 10 veces con distintos comienzos y se queda con el de
menor inercia. `random_state=42` fija esos comienzos: siempre da lo mismo.

## Por qué hay que escalar

"Más cercano" se mide con la distancia de siempre (euclídea), que suma las
diferencias de cada columna al cuadrado. Las visitas van de 1 a 10; el ticket,
de unos 2.000 a más de 170.000. Una diferencia de 1.000 pesos de ticket pesa
como 1.000 visitas: el ticket **tapa** a las visitas y KMeans agrupa casi solo
por ticket. Resultado: un parecido con los segmentos reales de 0,30.

`modelos_sklearn.py` hace dos cosas antes:

- **Logaritmo del ticket**: así 6.000 contra 9.000 pesa lo mismo que 60.000
  contra 90.000 (las dos son "50 % más"). Es lo habitual con montos de
  dinero, que tienen unos pocos valores enormes.
- **StandardScaler**: cada columna con media 0 y desvío 1. Las dos pesan
  parecido.

Resultado: 0,83. Mismo algoritmo, mismos datos, otra preparación. Lo que
hace la diferencia es escalar: con estos datos, escalando sin el logaritmo
da casi lo mismo (0,84; es un ejercicio de la
[evaluación 5](../evaluacion/05-clustering.md)). Es el
ejemplo más claro de la imagen de que **preparar los datos importa tanto como
el modelo**.

## Cómo se mide si encontró los grupos

### Con la respuesta: Rand ajustado

Cuando se conocen los grupos reales (acá sí, en la vida real casi nunca), el
**índice de Rand ajustado** (`adjusted_rand_score`) compara los dos
agrupamientos: mira cada par de clientes y cuenta si los dos agrupamientos
coinciden en ponerlos juntos o separados. Da 1 si son iguales, alrededor de 0
si coinciden lo que daría el azar. No importa el número de cada grupo
(KMeans los numera como quiere: su "grupo 2" puede ser el segmento
"frecuente").

La tabla de grupos contra segmentos muestra **dónde** se equivoca:

| Grupo | frecuente | mayorista | ocasional |
|---|---:|---:|---:|
| 0 | 19 | 1991 | 1 |
| 1 | 1008 | 0 | 11938 |
| 2 | 5043 | 0 | 0 |

Los mayoristas quedan todos juntos. Los ocasionales también, pero con ~1.000
frecuentes: los que compran 4 veces por mes están más cerca de los
ocasionales (3 visitas) que del centro de los frecuentes (7 visitas). KMeans
no sabe de reglas: ve distancias. En datos reales, los grupos también se
tocan.

### Sin la respuesta: silhouette

En la vida real no hay `segmento_real`. Para saber si los grupos son buenos,
y **cuántos** pedir, se usa el **silhouette**: para cada punto, compara la
distancia promedio a los de su grupo con la distancia al grupo vecino. Va de
−1 a 1: cerca de 1, el punto está bien metido en su grupo; cerca de 0, está
en el borde; negativo, está en el grupo equivocado.

| k | silhouette |
|---|---:|
| 2 | 0,539 |
| 3 | **0,634** |
| 4 | 0,501 |
| 5 | 0,399 |

El mejor es k = 3: los segmentos con que se armaron los datos. El script lo
calcula sobre 5.000 clientes (`sample_size=5000`) porque con todos tendría que
medir las 20.000 × 20.000 distancias.

Otro método común es el **codo**: graficar la inercia para cada k y elegir
donde deja de bajar mucho. La inercia siempre baja al subir k (con k = cantidad
de puntos es 0), así que no sirve tomar la menor.

## Limitaciones

- **Hay que elegir k.** El algoritmo no lo sabe.
- **Supone grupos redondos y de tamaño parecido.** Si un grupo tiene forma de
  banana, o uno es mucho más disperso que otro, k-means los corta mal.
- **Todas las columnas tienen que ser números** y estar en escalas
  comparables.
- **Un outlier mueve un centro**, porque el centro es un promedio.
- Para grupos con otras formas existen otros algoritmos (por densidad, como
  DBSCAN; jerárquicos), que la imagen no usa.

## En scikit-learn y en Spark

| | scikit-learn | Spark MLlib |
|---|---|---|
| Preparar | `np.log`, `StandardScaler().fit_transform(...)` | `F.log(...)`, `VectorAssembler` + `StandardScaler(withMean=True)` en un `Pipeline` |
| Modelo | `KMeans(n_clusters=3, n_init=10, random_state=42)` | `KMeans(k=3, seed=42)` |
| Grupo de cada fila | `kmeans.labels_` o `fit_predict` | Columna `prediction` de `transform(df)` |
| Tabla contra segmentos | `pd.crosstab` | `df.crosstab("prediction", "segmento_real")` |
| Rand ajustado | `adjusted_rand_score` | Se pasan dos columnas a pandas (`toPandas`) y se usa la de scikit-learn |

Los dos tienen que pasar 0,8 de Rand ajustado (lo controla la prueba de la
imagen).

## Para repasar

- No supervisado: grupos sin respuestas.
- k-means: asignar al centro más cercano, mover el centro al promedio,
  repetir.
- Usa distancias: escalar (y a veces el logaritmo) cambia todo, 0,30 contra
  0,83.
- Rand ajustado si se conoce la verdad; silhouette (o el codo) para elegir k
  cuando no.

[← 4. Clasificación](04-clasificacion.md) · [Índice de teoría](README.md) · Siguiente: [6. Redes neuronales básicas →](06-redes-neuronales.md)
