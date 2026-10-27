# Evaluación 2. Preparación y calidad de datos

[← 1. Qué es machine learning](01-que-es-ml.md) · [Índice de evaluación](README.md) · Teoría: [2. Preparación de datos](../teoria/02-preparacion-de-datos.md) · Siguiente: [3. Regresión lineal →](03-regresion.md)

## Multiple choice

**1.** ¿Por qué los ETL de la imagen leen el CSV sucio **todo como texto**
(`dtype=str` en pandas)?

- a) Porque leer como texto es más rápido.
- b) Porque Parquet solo acepta texto.
- c) Porque con datos sucios la librería adivina mal los tipos; se lee como
  texto y se convierte con reglas explícitas.
- d) Porque pandas no puede leer números de un CSV.

<details><summary>Respuesta</summary>

**c)**. En la columna `precio` conviven `2898` y `900,00`: no es ni número
ni texto. Si la librería adivina, puede dejar toda la columna como texto, o
peor, convertir mal. Leyendo como texto, cada formato se detecta y se
convierte con su regla.

- a) No: no es por velocidad (convertir después es trabajo extra).
- b) No: Parquet guarda tipos, y justamente el ETL carga números y fechas.
- d) No: pandas lee números de un CSV sin problema cuando están limpios.

</details>

**2.** En las ventas sucias hay fechas `05/03/2026`. ¿Por qué el ETL no usa
`pd.to_datetime` sin formato?

- a) Porque es muy lento.
- b) Porque `05/03/2026` puede ser 5 de marzo o 3 de mayo, y la librería
  podría elegir mal sin avisar.
- c) Porque `to_datetime` no existe en pandas 2.
- d) Porque Spark no lo entendería después.

<details><summary>Respuesta</summary>

**b)**. Una fecha ambigua mal convertida no da error: da otra fecha válida.
Por eso el ETL detecta cada formato con una expresión regular y convierte
con `format="%d/%m/%Y"`, explícito.

- a) No: la velocidad no es el problema.
- c) No: existe; el ETL lo usa, pero con formato.
- d) No: lo que lee Spark es el Parquet, con la fecha ya convertida.

</details>

**3.** Faltan datos en tres columnas. ¿Qué combinación hace el ETL?

- a) Borra todas las filas con algún vacío.
- b) Completa todo con 0.
- c) Sin cantidad: borra la fila. Sin medio de pago: `desconocido`. Sin
  precio: la mediana del producto.
- d) Sin cantidad: la mediana. Sin medio de pago: borra. Sin precio: 0.

<details><summary>Respuesta</summary>

**c)**. Cada vacío se trata según lo que significa: sin cantidad no hay
venta; sin medio de pago la venta vale igual; el precio se puede estimar
bien con los de ese producto.

- a) No: borraría 5.000 tickets válidos sin medio de pago y cambiaría el
  facturado.
- b) No: un precio 0 haría importe 0, y un medio de pago "0" no significa
  nada.
- d) No: inventar cantidades cambiaría lo vendido; un precio 0 es falso.

</details>

**4.** El IQR de las cantidades da un rango aceptado de −1 a 7. ¿Qué problema
tiene usarlo solo?

- a) Ninguno: es el método estándar.
- b) Marca como outliers ventas normales de 3 unidades.
- c) Deja pasar las 60 ventas con cantidad −1, que son imposibles.
- d) No marca las cantidades multiplicadas por 100.

<details><summary>Respuesta</summary>

**c)**. El IQR mira qué tan lejos está un valor del centro, no si es
posible. −1 está "cerca" de 2, pero una venta no puede tener cantidad
negativa. Por eso el ETL decide con una regla del negocio: de 1 a 20.

- a) No: es estándar para **mirar**, no para decidir solo.
- b) No: 3 está adentro del rango.
- d) No: las 500 multiplicadas por 100 (100 a 500) sí las marca.

</details>

**5.** Para detectar precios sin la coma, el ETL compara cada precio con
**la mediana** de su producto y no con el promedio. ¿Por qué?

- a) Porque la mediana es más fácil de calcular.
- b) Porque los mismos precios locos suben el promedio, y la mediana casi no
  se mueve.
- c) Porque el promedio de números enteros no es entero.
- d) Es lo mismo: daría el mismo resultado.

<details><summary>Respuesta</summary>

**b)**. En el CSV crudo, el promedio de las yerbas (sin contar los precios
con coma) da ~3.999 y la mediana 2.732: unos pocos `273200` alcanzan para
subir el promedio casi un 50 %. Con la mediana, la referencia queda en el
precio normal.

- a) No: es más cara (hay que ordenar), y en Spark obliga a un join.
- c) No: el ETL redondea (`np.floor`) igual.
- d) No: con valores extremos, promedio y mediana se separan mucho.

</details>

**6.** ¿Qué ventaja tiene guardar las ventas limpias en Parquet en vez de CSV?

- a) Se puede abrir con el bloc de notas.
- b) Guarda los tipos, está por columnas y comprimido (~1 MB contra ~4,5 MB
  del CSV sucio).
- c) Lo pueden leer más programas que un CSV.
- d) No tiene ventajas: es una costumbre.

<details><summary>Respuesta</summary>

**b)**. El que lee no tiene que adivinar tipos (la fecha llega como fecha),
ocupa menos y se pueden leer solo las columnas que se usan.

- a) No: es binario, justamente no se abre como texto.
- c) No: al revés, el CSV lo lee cualquier programa; es su ventaja.
- d) No: las ventajas son concretas, y por eso lo usan los data lakes.

</details>

**7.** Antes de entrenar una regresión logística se aplica `StandardScaler`.
¿Con qué datos se calculan los promedios y desvíos?

- a) Con todos los datos, entrenamiento y prueba juntos.
- b) Solo con los de prueba.
- c) Solo con los de entrenamiento, y se aplican igual a los de prueba.
- d) Con cada parte por separado: los de prueba con los suyos.

<details><summary>Respuesta</summary>

**c)**. La prueba representa datos que todavía no llegaron: nada de ella
puede influir en el entrenamiento. `make_pipeline(StandardScaler(), ...)` lo
hace solo: `fit` aprende con el entrenamiento, `predict` aplica.

- a) No: la información de la prueba se filtra en el modelo.
- b) No: no tiene sentido entrenar con lo que hay que guardar.
- d) No: los datos de prueba quedarían en otra escala que la que aprendió el
  modelo (y con un solo cliente nuevo, ni siquiera hay desvío).

</details>

**8.** ¿Qué modelo de la imagen **no** necesita escalar las columnas?

- a) KMeans.
- b) Regresión logística.
- c) Red neuronal (MLP).
- d) Árbol de decisión.

<details><summary>Respuesta</summary>

**d)**. El árbol compara una columna por vez contra un corte
(`visitas_mes <= 3.50`): la escala de las otras no importa.

- a) No: usa distancias, y el ticket tapa a las visitas (0,30 contra 0,83).
- b) y c) No: suman columnas por pesos y se entrenan por pasos; las escalas
  desparejas los entorpecen.

</details>

## Preguntas de desarrollo

**1.** El resumen del ETL cuenta cada arreglo. ¿Para qué sirve contar, si
igual los datos se arreglan?

<details><summary>Respuesta modelo</summary>

Para **comprobar** que la limpieza hizo lo que tenía que hacer. Acá se sabe
cuántos errores metió el generador y el resumen tiene que coincidir (3.000
duplicados, 2.000 sin cantidad, 97.200 filas limpias). En datos reales se
compara con otra fuente (el total facturado de contabilidad). Además, si un
día el número cambia mucho (de 2.000 sin cantidad a 30.000), avisa que algo
cambió en el origen. Y permite comparar dos ETL distintos: la guía 3 compara
pandas y Spark con `diff` sobre esos resúmenes.

</details>

**2.** Explicá la diferencia entre borrar, completar con un valor fijo e
imputar un nulo. Dá un caso de los datos de la imagen en que completar con 0
estaría **mal**.

<details><summary>Respuesta modelo</summary>

Borrar: se saca la fila; se pierden datos, y si los vacíos no son al azar,
sesga. Completar con un valor fijo: cuando el vacío significa algo
(`desconocido`, o descuento 0 si no hay cupón). Imputar: estimar el valor con
una estadística, mejor por grupo (la mediana del producto).

Completar con 0 estaría mal en la `calificacion` de los pedidos de MongoDB
(guía 6): un pedido sin calificar no tiene calificación 0; promediar con
ceros bajaría la nota. O en el precio de las ventas: importe 0.

</details>

**3.** ¿Qué es un outlier? ¿Siempre hay que borrarlo? Usá las cantidades y los
precios del ETL para explicarlo.

<details><summary>Respuesta modelo</summary>

Un valor muy lejos del resto. Puede ser un error o un caso real raro. No
siempre se borra:

- Cantidades 100 a 500 o negativas: imposibles en un mostrador, se borran
  (regla de 1 a 20). El IQR ayuda a encontrarlas, pero la decisión es del
  negocio.
- Precios de más de 10 veces la mediana: se sabe qué error es (falta la coma)
  y se **corrige** dividiendo por 100, sin perder la venta.
- Un mayorista con ticket de 60.000 en los clientes es un outlier, pero
  real: borrarlo sería perder un segmento.

</details>

## Ejercicios prácticos

### Ejercicio 1. Los nulos, antes y después de los duplicados

Hecha la [guía 2](../02-datos-sucios-pandas.md). En un notebook:

1. Leé `ventas_sucias.csv` todo como texto y contá los vacíos de `cantidad`,
   `precio` y `medio_pago`.
2. Sacá los duplicados por `ticket` y volvé a contar.
3. Compará con el resumen del ETL y explicá por qué los números del punto 1
   no coinciden con él.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd

ventas = pd.read_csv("ventas_sucias.csv", dtype=str)
columnas = ["cantidad", "precio", "medio_pago"]
print(ventas[columnas].isna().sum())
sin_repetir = ventas.drop_duplicates(subset="ticket")
print(len(ventas) - len(sin_repetir))
print(sin_repetir[columnas].isna().sum())
```

| Columna | Vacíos en el CSV | Sin duplicados | Resumen del ETL |
|---|---:|---:|---:|
| `cantidad` | 2.062 | 2.000 | sin cantidad (fuera): 2000 |
| `precio` | 1.027 | 1.000 | sin precio: 1000 |
| `medio_pago` | 5.155 | 5.000 | sin medio de pago: 5000 |

Se sacan 3.000 duplicados. Los duplicados son copias de tickets, y algunos
son copias de tickets con vacíos: ese vacío aparece dos veces. El ETL cuenta
los vacíos **después** de sacar los duplicados (paso 2 antes del 6), por eso
da números redondos. Moraleja: el orden de los pasos cambia los conteos.

</details>

| Criterio | Puntos |
|---|---:|
| Lee con `dtype=str` y cuenta con `isna().sum()` | 3 |
| Saca duplicados por `ticket` (no por fila entera, aunque acá da igual) | 2 |
| Llega a 2.000 / 1.000 / 5.000 | 2 |
| Explica que los duplicados repiten vacíos y que el orden importa | 3 |

### Ejercicio 2. El IQR y la regla del negocio

Hecha la guía 2. Con las ventas sin duplicados y sin las cantidades vacías:

1. Convertí `cantidad` a número y calculá Q1, Q3, el IQR y el rango
   aceptado.
2. Contá cuántas filas marca el IQR y cuántas marca la regla "de 1 a 20".
3. Mostrá qué valores de cantidad marca la regla y no el IQR.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd

ventas = pd.read_csv("ventas_sucias.csv", dtype=str).drop_duplicates(subset="ticket")
cantidad = pd.to_numeric(ventas["cantidad"]).dropna()
q1, q3 = cantidad.quantile([0.25, 0.75])
iqr = q3 - q1
fuera_iqr = (cantidad < q1 - 1.5 * iqr) | (cantidad > q3 + 1.5 * iqr)
fuera_regla = (cantidad < 1) | (cantidad > 20)
print(q1, q3, iqr, q1 - 1.5 * iqr, q3 + 1.5 * iqr)
print(fuera_iqr.sum(), fuera_regla.sum())
print(cantidad[fuera_regla & ~fuera_iqr].value_counts())
```

| Qué | Valor |
|---|---|
| Q1, Q3, IQR | 2, 4, 2 |
| Rango aceptado | −1 a 7 (igual que el ETL) |
| Marca el IQR | 740 |
| Marca la regla | 800 |
| Las que marca la regla y no el IQR | 60 filas, todas con cantidad −1 |

Las 800 de la regla son 500 multiplicadas por 100 (100, 200, 300, 400 y
500) y 300 negativas (−1 a −5). El IQR deja pasar las −1 porque están a
solo 3 unidades del Q1.

</details>

| Criterio | Puntos |
|---|---:|
| Cuartiles y rango bien calculados | 3 |
| Cuenta 740 y 800 | 3 |
| Encuentra que la diferencia son las −1 | 2 |
| Explica por qué el IQR no las ve (mide distancia, no si es posible) | 2 |

[← 1. Qué es machine learning](01-que-es-ml.md) · [Índice de evaluación](README.md) · Teoría: [2. Preparación de datos](../teoria/02-preparacion-de-datos.md) · Siguiente: [3. Regresión lineal →](03-regresion.md)
