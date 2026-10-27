# 2. Preparación y calidad de datos

[← 1. Qué es machine learning](01-que-es-ml.md) · [Índice de teoría](README.md) · Siguiente: [3. Regresión lineal →](03-regresion.md)

## Por qué importa

Un modelo aprende de los datos que le das, errores incluidos. Si la mitad de
las cantidades están multiplicadas por 100, el modelo va a aprender que se
venden 300 yerbas por ticket. "Basura entra, basura sale". En los proyectos
reales, juntar y limpiar los datos suele llevar más tiempo que modelar.

## ETL

**ETL** (*Extract, Transform, Load*: extraer, transformar, cargar) es el
nombre del proceso que lleva datos de donde están, los arregla y los deja
donde se van a usar. `etl_pandas.py` y `etl_spark.py` son un ETL completo:

| Etapa | En los ejemplos |
|---|---|
| **Extraer** | Leer `ventas_sucias.csv` todo como texto (paso 1) |
| **Transformar** | Duplicados, texto, fechas, números, nulos, outliers (pasos 2 a 7) |
| **Cargar** | Escribir Parquet con los tipos correctos (paso 8) |

¿Por qué leer todo como **texto** (`dtype=str` en pandas, sin `inferSchema`
en Spark)? Porque si la librería adivina los tipos, adivina mal con datos
sucios: una columna de precios con `"2.575,00"` mezclado con `2575` no es ni
número ni texto. Se lee como texto, se mira, y se convierte con reglas
explícitas.

## Los problemas típicos

Los que mete `generar_sucios.py` son los de cualquier sistema real:

| Problema | Ejemplo en las ventas | Cómo se arregla en el ETL | Cómo se decide |
|---|---|---|---|
| **Duplicados** | El mismo ticket cargado dos veces (3.000) | Quedarse con uno (`drop_duplicates`) | Hay una clave que tiene que ser única: el número de ticket |
| **Formatos distintos** | Fechas `2026-03-05`, `05/03/2026` y `20260305`; precios `2575` y `2.575,00` | Detectar el formato con una expresión regular y convertir cada uno con el suyo | Nunca dejar que la librería adivine: `05/03` puede ser 5 de marzo o 3 de mayo |
| **Texto desprolijo** | `"  YERBA"`, `"Débito "` | Sin espacios, minúsculas, sin tildes | Si no, `yerba` y ` yerba` son dos productos distintos al agrupar |
| **Valores faltantes (nulos)** | Cantidad, precio o medio de pago vacíos | Según la columna (abajo) | Depende de qué significa el vacío |
| **Valores imposibles (outliers)** | Cantidad 300 o −3; precio 257500 | Borrar, o corregir si se sabe el error | Una regla del negocio, ayudada por la estadística |

## Qué hacer con los nulos

No hay una sola respuesta. El ETL hace tres cosas distintas, cada una con su
razón:

| Columna | Qué hace | Por qué |
|---|---|---|
| `cantidad` vacía | Borra la fila | Sin cantidad no hay importe: el ticket no sirve. Son el 2 % |
| `medio_pago` vacío | Pone `desconocido` | El ticket sirve igual; borrarlo cambiaría el total facturado. Y `desconocido` deja a la vista que faltaba, cosa que inventar "efectivo" no haría |
| `precio` vacío | Pone la **mediana** del producto | El precio de una yerba es parecido al de las otras yerbas. La mediana del producto es una estimación razonable (esto se llama **imputar**) |

Las opciones en general:

- **Borrar** la fila (o la columna, si casi todo está vacío). Simple, pero se
  pierden datos y, si los vacíos no son al azar, el resultado se sesga.
- **Completar** con un valor fijo (`desconocido`, `0`) cuando el vacío
  significa algo. Ojo: en la [guía 6](../06-mongodb-pandas.md), un pedido sin
  cupón tiene descuento 0, pero uno sin calificación **no** tiene
  calificación 0.
- **Imputar** con una estadística (media, mediana, la más común), mejor por
  grupo (la mediana **del producto**, no la de todos).

Y siempre **contar** cuántos se tocaron: el resumen del ETL lo hace, y así se
puede comprobar contra lo que metió el generador.

## Outliers: la estadística ayuda, el negocio decide

Un **outlier** es un valor muy lejos del resto. Puede ser un error (300
yerbas por un tipeo) o un caso real y raro (un mayorista). El método más
usado para encontrarlos es el **rango intercuartil** (IQR):

1. Q1 = el valor que deja el 25 % de los datos abajo; Q3, el que deja el 75 %.
2. IQR = Q3 − Q1 (el ancho del 50 % central).
3. Es sospechoso lo que está debajo de Q1 − 1,5 × IQR o arriba de Q3 + 1,5 ×
   IQR.

En las cantidades (las normales van de 1 a 5) da un rango de −1 a 7 y marca
740 filas: las 500 multiplicadas por 100 y 240 de las negativas. Pero **deja
pasar** las 60 con cantidad −1, que es imposible. Por eso el ETL usa el IQR
para **mirar** y una **regla del negocio** para decidir: en un mostrador se
venden de 1 a 20 unidades por ticket. Eso saca las 800 (500 + 300).

Con los precios no se borra: un precio de más de 10 veces la mediana del
producto es un precio cargado sin la coma decimal (`257500` en vez de
`2575,00`, 100 veces más), y se arregla dividiendo por 100. Se usa la **mediana** y no el
promedio porque la mediana no se mueve con unos pocos valores locos; el
promedio sí (un solo 257.500 sube mucho el promedio de las yerbas).

## Calidad: cómo saber si quedó bien

- **Contar antes y después** de cada paso (el resumen del ETL).
- **Comparar con lo que se sabe**: acá, con los errores que metió el
  generador (97.200 tickets limpios). En datos reales, con totales de otro
  sistema (lo facturado según contabilidad, por ejemplo).
- **Mirar el resultado**: `describe()`, `value_counts()`, un gráfico. Si
  aparece un producto `yerba ` con espacio, falta un paso.
- **Hacerlo reproducible**: un script que se corre de nuevo, no arreglos a
  mano en una planilla. Si mañana llegan datos nuevos, se vuelve a correr.

## Formatos: CSV o Parquet

| | CSV | Parquet |
|---|---|---|
| Qué es | Texto, una fila por línea | Binario, **por columnas**, comprimido |
| Tipos | No tiene: todo es texto | Los guarda: el que lee no adivina |
| Tamaño (las ventas limpias) | El sucio, ~4,5 MB | ~1 MB |
| Leer dos columnas de veinte | Lee todo | Lee solo esas dos |
| Para | Intercambiar con cualquier programa | Guardar datos para análisis (data lakes, Spark, Hive) |

Por eso el ETL **carga** en Parquet.

## Preparar para el modelo: escalar

Hay un paso más, que no es limpieza sino preparación para algunos modelos:
**escalar**. `ticket_promedio` vale miles; `reclamos`, de 0 a 5. Para los
modelos que miden distancias (KMeans) o que suman columnas multiplicadas por
pesos y se entrenan de a pasos (logística, redes), la columna grande tapa a
la chica. `StandardScaler` resta el promedio y divide por el desvío: todas
quedan con media 0 y desvío 1. En la [teoría 5](05-clustering.md) se ve la
diferencia: KMeans sin escalar acierta 0,30 de Rand ajustado; escalado, 0,83.
Los árboles no lo necesitan: comparan una columna por vez contra un corte.

El escalador se **entrena** solo con los datos de entrenamiento (aprende sus
promedios y desvíos) y se aplica igual a los de prueba. Si se calcula con
todos los datos, se filtra información de la prueba. Meterlo en un
**pipeline** (`make_pipeline(StandardScaler(), LogisticRegression())`) lo
resuelve solo.

## Para repasar

- ETL: extraer (como texto), transformar (con reglas explícitas), cargar (con
  tipos).
- Nulos: borrar, completar o imputar, según qué significa el vacío; y contar.
- Outliers: el IQR marca, la regla del negocio decide; la mediana resiste a
  los valores locos.
- Escalar antes de los modelos que usan distancias o pesos; los árboles no lo
  necesitan.

[← 1. Qué es machine learning](01-que-es-ml.md) · [Índice de teoría](README.md) · Siguiente: [3. Regresión lineal →](03-regresion.md)
