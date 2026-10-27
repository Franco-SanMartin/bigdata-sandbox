# Evaluación 3. Regresión lineal

[← 2. Preparación de datos](02-preparacion-de-datos.md) · [Índice de evaluación](README.md) · Teoría: [3. Regresión lineal](../teoria/03-regresion.md) · Siguiente: [4. Clasificación →](04-clasificacion.md)

## Multiple choice

**1.** La regresión lineal de la guía 4 aprende un coeficiente de 1507,16
para `visitas_mes`. ¿Qué significa?

- a) Que el 1507 % del gasto depende de las visitas.
- b) Que, con todo lo demás igual, cada visita más por mes suma ~1.507 pesos
  al gasto previsto.
- c) Que un cliente con una visita gasta 1.507 pesos.
- d) Que las visitas son 1.507 veces más importantes que el ticket.

<details><summary>Respuesta</summary>

**b)**. Un coeficiente es cuánto cambia la predicción por cada unidad más de
esa columna, sin mover las otras. La regla real usa 1.500: el modelo la
encontró, salvo el ruido.

- a) No: no es un porcentaje.
- c) No: el gasto es la suma de la constante y de todos los términos, no solo
  el de visitas.
- d) No: los coeficientes dependen de las unidades. El del ticket es 0,8 por
  **peso**; un ticket se mueve en miles, una visita en unidades. No se
  comparan directamente.

</details>

**2.** El coeficiente aprendido para `edad` es 0,16. ¿Qué se concluye?

- a) Que cada año de edad suma 16 pesos.
- b) Que la edad casi no influye: la regla real no la usa y el modelo le da
  un peso cercano a 0.
- c) Que hay que sacar la edad porque arruina el modelo.
- d) Que el modelo está mal, porque la edad debería influir.

<details><summary>Respuesta</summary>

**b)**. Con edades de 18 a 80, 0,16 por año mueve la predicción unos pocos
pesos, contra un error medio de ~1.600. Es ruido: la fórmula real no tiene
edad.

- a) No: 0,16 por año son 16 centavos, no 16 pesos; y aun así es ruido.
- c) No: no arruina nada, el modelo la ignora casi del todo. Sacarla
  simplificaría, pero no cambia el resultado.
- d) No: el modelo hizo lo correcto, porque la edad no está en la fórmula.

</details>

**3.** La regresión tiene R² = 0,983 en la prueba. ¿Qué significa?

- a) Que acierta exacto el 98,3 % de los gastos.
- b) Que explica el 98,3 % de la variación del gasto entre clientes.
- c) Que le erra por un 1,7 % en promedio.
- d) Que es 98,3 % mejor que el modelo tonto.

<details><summary>Respuesta</summary>

**b)**. R² compara el error del modelo con el de predecir siempre el promedio:
1 es perfecto, 0 es lo mismo que el promedio.

- a) No: en regresión casi nunca se acierta exacto; R² no cuenta aciertos.
- c) No: el error en pesos es el MAE (~1.617), y no es un porcentaje.
- d) No: no es una comparación con el clasificador tonto.

</details>

**4.** El MAE no baja de ~1.600 pesos aunque el modelo encuentre la fórmula
casi exacta. ¿Por qué?

- a) Porque faltan iteraciones de entrenamiento.
- b) Porque la fórmula tiene un ruido con desvío 2.000 que no depende de
  ninguna columna; su error absoluto medio es ~0,8 × 2.000.
- c) Porque scikit-learn redondea los coeficientes.
- d) Porque hay que escalar los datos.

<details><summary>Respuesta</summary>

**b)**. El ruido es imposible de predecir: ni la fórmula real exacta bajaría
de ese error.

- a) No: la regresión lineal se resuelve con una fórmula, no por pasos.
- c) No: no redondea.
- d) No: escalar no cambia las predicciones de una regresión lineal; solo
  cambian los coeficientes, en la escala nueva.

</details>

**5.** Un cliente nuevo tiene 50 visitas por mes (los de entrenamiento tienen
de 1 a 10). ¿Qué pasa con la predicción?

- a) El modelo da error.
- b) El modelo predice el máximo que vio.
- c) La recta sigue: predice un gasto enorme, que puede no tener sentido,
  porque nunca vio casos así.
- d) Predice el promedio.

<details><summary>Respuesta</summary>

**c)**. Una regresión lineal **extrapola** sin avisar. Fuera del rango
visto, no hay evidencia de que la recta siga valiendo.

- a) No: no da error, y ese es el peligro.
- b) No: eso hace un árbol de regresión, no una recta.
- d) No: solo predice el promedio si los coeficientes son 0.

</details>

**6.** En Spark MLlib, ¿cómo se mide el R² de una regresión?

- a) Con `r2_score`.
- b) Con `RegressionEvaluator(metricName="r2")` sobre el DataFrame con
  predicciones.
- c) Con `model.r2()`, sin datos.
- d) Spark no calcula R².

<details><summary>Respuesta</summary>

**b)**. En MLlib, las métricas son Evaluators que leen la columna de
predicción y la de respuesta de un DataFrame.

- a) No: `r2_score` es de scikit-learn, recibe arrays en memoria.
- c) No: para medir en la prueba hacen falta los datos de prueba.
- d) No: lo calcula, y la prueba de la imagen exige más de 0,9.

</details>

## Preguntas de desarrollo

**1.** ¿Qué quiere decir que la regresión lineal busca los coeficientes por
**mínimos cuadrados**? ¿Por qué los errores van al cuadrado?

<details><summary>Respuesta modelo</summary>

Para cada cliente de entrenamiento hay un error: real menos predicho.
Mínimos cuadrados elige los coeficientes que hacen mínima la **suma de los
errores al cuadrado**. Al cuadrado porque: los errores positivos y negativos
no se cancelan; los errores grandes pesan más (uno de 4.000 pesa como cuatro
de 2.000); y matemáticamente tiene una solución exacta con una fórmula, sin
probar. La contra: un outlier con error enorme pesa mucho, y por eso conviene
limpiar antes.

</details>

**2.** La regresión de la imagen da R² = 0,983. En un trabajo con datos reales,
alguien muestra un R² de 0,98. ¿Qué preguntarías antes de creerle?

<details><summary>Respuesta modelo</summary>

- ¿Se midió en datos de **prueba**, que el modelo no vio?
- ¿Hay alguna columna que contiene la respuesta (fuga)? Por ejemplo, predecir
  el gasto con una columna "impuestos pagados".
- ¿Los datos de prueba son de **después** que los de entrenamiento, si hay
  tiempo de por medio?
- ¿Cuál es el MAE en unidades reales? Un R² alto con un error de 30 % puede
  no servir.

Acá es tan alto porque los datos salieron de una fórmula lineal; en datos
reales es raro.

</details>

## Ejercicios prácticos

### Ejercicio 1. Con menos columnas

Hecha la [guía 4](../04-modelos-sklearn.md). Entrená una regresión lineal
para `gasto_mes_siguiente` usando solo `visitas_mes` y `ticket_promedio`, con
la separación de siempre (`test_size=0.2, random_state=42`). Compará los
coeficientes, el R² y el MAE con los de la guía 4, y explicá qué pasó con la
constante.

<details><summary>Solución</summary>

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

clientes = pd.read_csv("clientes_senal.csv")
columnas = ["visitas_mes", "ticket_promedio"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[columnas], clientes["gasto_mes_siguiente"], test_size=0.2, random_state=42)
modelo = LinearRegression().fit(X_ent, y_ent)
prediccion = modelo.predict(X_prueba)
print(modelo.intercept_, dict(zip(columnas, modelo.coef_)))
print(r2_score(y_prueba, prediccion), mean_absolute_error(y_prueba, prediccion))
```

| | Las 5 columnas (guía 4) | Visitas y ticket |
|---|---:|---:|
| Constante | 4.972,4 | 5.627,9 |
| `visitas_mes` | 1.507,16 | 1.505,24 |
| `ticket_promedio` | 0,80 | 0,80 |
| R² | 0,983 | 0,973 |
| MAE | ~1.617 | ~2.025 |

Los coeficientes de visitas y ticket casi no cambian. Lo que antes
explicaban antigüedad y reclamos ahora es error: el MAE sube unos 400 pesos y
el R² baja un punto. La constante sube porque absorbe el **promedio** de lo
que falta: el modelo ya no sabe la antigüedad ni los reclamos de cada
cliente, y suma lo que aportan en promedio (50 × la antigüedad media − 1500 ×
los reclamos medios).

</details>

| Criterio | Puntos |
|---|---:|
| Modelo con las dos columnas y la misma separación | 3 |
| Tabla comparativa con R² y MAE en prueba | 3 |
| Explica que el error sube por lo que ya no ve | 2 |
| Explica por qué cambia la constante | 2 |

### Ejercicio 2. La fórmula contra el modelo

Hecha la guía 4. Para el cliente con 40 meses de antigüedad, 1 visita por
mes, ticket de 5.000, 0 reclamos y 30 años:

1. Calculá a mano el gasto con la fórmula real, sin el ruido.
2. Calculalo con la regresión entrenada como en la guía 4.
3. Explicá por qué no dan igual, y por qué ninguno de los dos va a ser el
   gasto que ese cliente tenga de verdad.

<details><summary>Solución</summary>

1. 5000 + 50 × 40 + 1500 × 1 + 0,8 × 5000 − 1500 × 0 = 12.500.
2. Con el modelo:

<!-- prueba: no (celda de Jupyter: solución de ejercicio) -->
```python
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.model_selection import train_test_split

clientes = pd.read_csv("clientes_senal.csv")
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X_ent, X_prueba, y_ent, y_prueba = train_test_split(
    clientes[ENTRADAS], clientes["gasto_mes_siguiente"], test_size=0.2, random_state=42)
modelo = LinearRegression().fit(X_ent, y_ent)
nuevo = pd.DataFrame([[40, 1, 5000, 0, 30]], columns=ENTRADAS)
print(modelo.predict(nuevo))
```

Da ~12.494 (lo mismo que la guía 4).

3. No dan igual porque el modelo estimó los coeficientes con datos con
   ruido: 4.972,4 en vez de 5.000, 50,24 en vez de 50, etcétera. La
   diferencia es chica (6 pesos). Ninguno es el gasto real porque cada
   cliente tiene su ruido (desvío 2.000): el gasto de verdad va a estar, con
   mucha probabilidad, entre unos 8.500 y 16.500.

</details>

| Criterio | Puntos |
|---|---:|
| Cuenta a mano bien (12.500) | 2 |
| `predict` con un DataFrame con los nombres de columna en el orden correcto | 3 |
| Llega a ~12.494 | 2 |
| Explica la diferencia (coeficientes estimados) y el ruido | 3 |

[← 2. Preparación de datos](02-preparacion-de-datos.md) · [Índice de evaluación](README.md) · Teoría: [3. Regresión lineal](../teoria/03-regresion.md) · Siguiente: [4. Clasificación →](04-clasificacion.md)
