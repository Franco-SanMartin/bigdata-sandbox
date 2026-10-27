# 2. Datos sucios y ETL con pandas

Generar un archivo de ventas con errores metidos **a propósito y en
cantidades conocidas**, mirarlo en un notebook, limpiarlo con
`etl_pandas.py` y comprobar que el ETL encontró exactamente lo que había.

[← 1. Arrancar y JupyterLab](01-arrancar-y-jupyterlab.md) · [Índice de ml](README.md) · Siguiente: [3. El mismo ETL con Spark →](03-etl-spark.md)

## Antes de empezar

- El contenedor `bigdata` con la imagen `ml`, en *Cluster LISTO*
  ([guía 1](01-arrancar-y-jupyterlab.md)).
- Los comandos van en una terminal **adentro** (la de JupyterLab o `docker
  exec -it bigdata bash`), parada en `/datos`. Las celdas, en un notebook de
  JupyterLab guardado en `/datos`.
- Esta guía no usa el cluster: pandas trabaja en la memoria del contenedor.
  Anda con cualquier `SERVICIOS`.
- Teoría que acompaña: [preparación de datos](teoria/02-preparacion-de-datos.md).

## Qué vamos a hacer y por qué

ETL quiere decir **E**xtraer (leer los datos como vienen), **T**ransformar
(limpiarlos) y **C**argar (*Load*: guardarlos listos para analizar). En la
vida real los datos llegan sucios: cada sucursal carga a su manera, con
errores de tipeo, celdas vacías y formatos distintos. Antes de cualquier
modelo hay que limpiarlos, y la limpieza es la parte que más tiempo lleva en
un proyecto de datos.

Para aprender sirve que los errores sean **conocidos**: el generador dice
cuántos metió de cada tipo, y el ETL tiene que encontrar exactamente esos.
Si no da igual, el ETL tiene un error.

## Generar las ventas sucias

<!-- prueba: adentro | espera: Tickets que tendrian que quedar despues de limpiar: 97200 -->
```bash
python3 ejemplos/ml/generar_sucios.py
ls -l ventas_sucias.csv
```

Genera `ventas_sucias.csv` en `/datos` (lo ves también en tu carpeta
`datos/`): 100.000 tickets de las 4 sucursales en el primer semestre de 2026,
más 3.000 duplicados, en total **103.000 filas** y unos 4,5 MB. Siempre son
los mismos datos (semilla fija): a todos les da igual, y la prueba de la
imagen lo comprueba con el md5 del archivo.

Al final dice qué problemas metió, en filas distintas para poder contarlos:

| Problema | Filas | Qué es |
|---|---:|---|
| cantidad vacía | 2.000 | La celda `cantidad` sin nada (2 %) |
| cantidad x100 | 500 | Error de tipeo: 300 en vez de 3 (0,5 %) |
| cantidad negativa | 300 | -3 en vez de 3 (0,3 %) |
| precio vacío | 1.000 | La celda `precio` sin nada (1 %) |
| precio sin coma decimal | 500 | 257500 en vez de 2.575,00 (0,5 %) |
| medio de pago vacío | 5.000 | La celda `medio_pago` sin nada (5 %) |
| tickets duplicados | 3.000 | El mismo ticket cargado dos veces (3 %) |

Y la cuenta que tiene que dar el ETL: *Tickets que tendrían que quedar
después de limpiar: 97200* (100.000 menos los 2.000 sin cantidad, los 500 x100
y los 300 negativos).

Además mete errores **de formato**, que no cambian el valor, solo cómo está
escrito: fechas en tres formatos (`2026-03-05`, `05/03/2026` y `20260305`),
texto con mayúsculas, espacios de más y tildes (`"  YERBA"`, `"Débito "`) y el
15 % de los precios con formato argentino (`"2.575,00"`). Y los precios suben
un 3 % por mes, como con inflación.

Para otra cantidad o con otro nombre: `python3 ejemplos/ml/generar_sucios.py
500000 grande.csv`. El generador usa solo Python, sin librerías: anda también
en `base`.

## Mirarlos antes de limpiar

Antes de limpiar, se mira. En un notebook nuevo (en `/datos`):

<!-- prueba: no (celda de JupyterLab) -->
```python
import pandas as pd

sucias = pd.read_csv("ventas_sucias.csv", dtype=str)
print(sucias.shape)
sucias.head(8)
```

`(103000, 7)`: 103.000 filas y 7 columnas (`ticket`, `fecha`, `sucursal`,
`producto`, `cantidad`, `precio`, `medio_pago`). `dtype=str` lee **todo como
texto**: si pandas adivinara los tipos, `"2.575,00"` o `"05/03/2026"` quedarían
mal sin avisar. En las primeras filas ya se ven fechas `20260623` y
`04/01/2026`, productos `Facturas` y `FACTURAS`, un precio `900,00`, una
cantidad `300` y medios de pago `Débito` y `Qr`.

Cuántas celdas vacías hay en cada columna:

<!-- prueba: no (celda de JupyterLab) -->
```python
sucias.isna().sum()
```

`cantidad` tiene 2.062, `precio` 1.027 y `medio_pago` 5.155: **más** de lo que
dijo el generador (2.000, 1.000 y 5.000). La diferencia son los duplicados:
algunos de los tickets copiados tenían una celda vacía, y la copia también.
Por eso el ETL saca primero los duplicados y después cuenta los nulos.

Duplicados y texto desprolijo:

<!-- prueba: no (celda de JupyterLab) -->
```python
print("tickets repetidos:", sucias["ticket"].duplicated().sum())
sucias["producto"].value_counts().head(12)
```

3.000 repetidos. Y en los productos aparecen `yerba`, `Yerba`, `YERBA` y
**dos veces** `yerba`: una de las dos tiene un espacio adelante o atrás, que
no se ve pero hace que pandas lo cuente como otro producto.

Los formatos de fecha, por largo del texto:

<!-- prueba: no (celda de JupyterLab) -->
```python
sucias["fecha"].str.len().value_counts()
```

Las de 10 caracteres son `2026-03-05` o `05/03/2026`; las de 8, `20260305`.

## Correr el ETL

<!-- prueba: adentro | espera: filas limpias | espera: 97200 -->
```bash
python3 ejemplos/ml/etl_pandas.py
```

Tarda un par de segundos. Muestra las primeras filas como vienen y como
quedan, los tipos de cada columna, la memoria que ocupa la tabla y al final
el **resumen**, que es lo que importa. Deja `ventas_limpias.parquet` en
`/datos`.

También acepta otros archivos: `python3 ejemplos/ml/etl_pandas.py grande.csv
grande.parquet`.

## El ETL paso a paso

`etl_pandas.py` tiene ocho pasos numerados, con un comentario largo en cada
uno. Abrilo en JupyterLab (`ejemplos/ml/etl_pandas.py`, doble clic) y seguilo
con esta tabla:

| Paso | Qué hace | Con qué |
|---|---|---|
| 1. Extraer | Lee todo como texto; las celdas vacías quedan `NaN` | `pd.read_csv(entrada, dtype=str)` |
| 2. Duplicados | Se queda con un ticket de cada uno | `drop_duplicates(subset="ticket")` |
| 3. Texto | Sin espacios de más, minúsculas, sin tildes | `.str.strip().str.lower().str.translate(...)` |
| 4. Fechas | Detecta el formato de cada una con una expresión regular y la convierte **con su formato** | `str.fullmatch`, `pd.to_datetime(..., format=...)`, `fillna` |
| 5. Números | `"2.575,00"` → saca el punto, la coma pasa a punto → número | `str.replace`, `pd.to_numeric` |
| 6. Nulos | Sin cantidad: fuera. Sin medio de pago: `desconocido`. Sin precio: después, con la mediana | `isna`, `fillna` |
| 7. Outliers | Mira lo que marcaría el IQR, y aplica una regla del negocio: de 1 a 20 unidades por ticket. Un precio de más de 10 veces la mediana del producto se divide por 100 | `quantile`, `groupby(...).transform("median")` |
| 8. Cargar | Columnas finales con sus tipos, `importe = cantidad * precio`, a Parquet | `to_parquet` |

Dos decisiones del script que conviene entender:

**Las fechas no se adivinan.** `05/03/2026` puede ser 5 de marzo o 3 de mayo.
Por eso no se deja que pandas "adivine" el formato: se detecta cuál es cada
una y se convierte con el suyo. Este es el paso 4 del script:

<!-- prueba: no (fragmento de etl_pandas.py: se corre con el script entero) -->
```python
f = ventas["fecha"]
iso = f.str.fullmatch(r"\d{4}-\d{2}-\d{2}", na=False)        # 2026-03-05
argentina = f.str.fullmatch(r"\d{2}/\d{2}/\d{4}", na=False)  # 05/03/2026
junta = f.str.fullmatch(r"\d{8}", na=False)                  # 20260305
ventas["fecha"] = (pd.to_datetime(f.where(iso), format="%Y-%m-%d")
                   .fillna(pd.to_datetime(f.where(argentina), format="%d/%m/%Y"))
                   .fillna(pd.to_datetime(f.where(junta), format="%Y%m%d")))
```

`f.where(iso)` deja solo las fechas ISO (las demás quedan vacías); se
convierten esas, y `fillna` completa los huecos con las de cada otro formato.

**El IQR no alcanza.** El método del rango intercuartil marca lo que está
lejos del 50 % central de los datos. Sobre `cantidad` el script imprime
*rango aceptado -1 a 7, marca 740 filas*: deja pasar `-1` (imposible: no se
venden -1 yerbas) y, si se usara para borrar, sacaría también ventas reales
de 8 a 20 unidades si las hubiera. Por eso, después de mirarlo, se usa una
**regla del negocio**: en un mostrador se venden de 1 a 20 unidades por
ticket. La estadística ayuda a encontrar candidatos; la decisión la da el
conocimiento del problema.

## El resumen: ¿encontró todo?

| Línea del resumen | Da | Tiene que dar (del generador) |
|---|---:|---|
| filas leidas | 103000 | 100.000 + 3.000 duplicados |
| duplicados eliminados | 3000 | tickets duplicados: 3.000 |
| fechas en formato dia/mes/año | 35070 | (formato: no se pierde ninguna) |
| fechas en formato todo junto | 10025 | (formato) |
| fechas que no se entienden (fuera) | 0 | 0 |
| precios con formato 2.575,00 | 14866 | (formato: ~15 %) |
| sin cantidad (fuera) | 2000 | cantidad vacía: 2.000 |
| sin medio de pago (-> desconocido) | 5000 | medio de pago vacío: 5.000 |
| cantidad imposible (fuera) | 800 | cantidad x100 + negativa: 500 + 300 |
| precio sin la coma (/100) | 500 | precio sin coma decimal: 500 |
| sin precio (-> mediana del producto) | 1000 | precio vacío: 1.000 |
| filas limpias | 97200 | Tickets que tendrían que quedar: 97.200 |

Además imprime el facturado total y por sucursal: son los números que tiene
que repetir Spark en la [guía 3](03-etl-spark.md). La prueba de la imagen
(`pruebas/probar_ml.sh`) compara cada línea con lo que dijo el generador.

Dos tickets para ver en detalle:

- El **5** no está en la tabla limpia: venía sin cantidad.
- El **76331** venía con precio `273200` (yerba en abril, sin la coma
  decimal): quedó en `2732`, el precio de la yerba ese mes.

## Mirar el resultado

En el notebook:

<!-- prueba: no (celda de JupyterLab) -->
```python
limpias = pd.read_parquet("ventas_limpias.parquet")
print(limpias.dtypes)
limpias[limpias["ticket"].isin([5, 76331])]
```

Los tipos ya vienen dentro del Parquet: `fecha` es `datetime64`, `cantidad`,
`precio` e `importe` son `int64`. El que lo lee no tiene que adivinar nada.
La consulta devuelve una sola fila, la del 76331.

La inflación que metió el generador, en el precio mediano de la yerba por
mes:

<!-- prueba: no (celda de JupyterLab) -->
```python
yerba = limpias[limpias["producto"] == "yerba"]
yerba.groupby(yerba["fecha"].dt.month)["precio"].median()
```

De 2500 en enero a 2898 en junio: un 3 % por mes, la regla del generador.

Facturado por producto y por mes, con un gráfico:

<!-- prueba: no (celda de JupyterLab) -->
```python
import matplotlib.pyplot as plt

print(limpias.groupby("producto")["importe"].sum().sort_values(ascending=False))
limpias.groupby(limpias["fecha"].dt.month)["importe"].sum().plot(kind="bar")
plt.xlabel("mes")
plt.ylabel("facturado (pesos)")
plt.show()
```

La yerba es lo que más factura y el termo, que se vende poco, queda segundo
porque es caro.

## Tamaños

| Archivo | Tamaño |
|---|---|
| `ventas_sucias.csv` (texto) | ~4,5 MB |
| `ventas_limpias.parquet` (por columnas, comprimido, con tipos) | ~1 MB |
| La tabla limpia en la memoria de pandas | ~20 MB (lo dice el script: *Memoria que ocupa la tabla en pandas*) |

En memoria ocupa mucho más que en disco: cada texto es un objeto de Python.
Por eso pandas tiene un límite práctico: la tabla (y las copias que hace en
cada paso) tiene que entrar en la RAM. Ese límite es el que resuelve Spark.

## Qué hiciste

- Generaste 103.000 ventas con errores conocidos y las miraste con
  `read_csv(dtype=str)`, `isna`, `duplicated` y `value_counts`.
- Corriste `etl_pandas.py` y comprobaste, línea por línea, que encontró
  exactamente lo que metió el generador.
- Leíste el Parquet limpio y viste la inflación del generador en las
  medianas.

Siguiente: [3. El mismo ETL con Spark →](03-etl-spark.md)
