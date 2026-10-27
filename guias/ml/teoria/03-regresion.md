# 3. Regresión lineal

[← 2. Preparación y calidad de datos](02-preparacion-de-datos.md) · [Índice de teoría](README.md) · Siguiente: [4. Clasificación →](04-clasificacion.md)

## Qué predice

Un **número**: cuánto va a gastar un cliente el mes que viene
(`gasto_mes_siguiente`). Es el problema de **regresión** más simple, y la
base de muchos otros modelos.

## El modelo

La regresión lineal supone que la respuesta es una suma de las entradas, cada
una multiplicada por un número:

    gasto ≈ a + b1 × antigüedad + b2 × visitas + b3 × ticket + b4 × reclamos + b5 × edad

- `a` es la **constante** (*intercept*): lo que da si todas las entradas
  valen 0.
- `b1` a `b5` son los **coeficientes**: cuánto cambia la respuesta si esa
  entrada sube 1 y las demás quedan igual.

**Entrenar** es buscar los números `a`, `b1`... que mejor ajustan a los datos
de entrenamiento. "Mejor" quiere decir que la suma de los errores al cuadrado
(la diferencia entre el gasto real y el predicho, elevada al cuadrado) sea lo
más chica posible: el método de **mínimos cuadrados**. Al cuadrado para que
los errores para arriba y para abajo no se cancelen, y para que un error
grande pese mucho más que varios chicos.

## Lo que encontró

`generar_senal.py` armó el gasto con una fórmula lineal más ruido:

    gasto = 5000 + 50 × antigüedad + 1500 × visitas + 0,8 × ticket − 1500 × reclamos + ruido

y `LinearRegression` encontró, con 16.000 clientes:

| | Aprendido | Regla real | Se lee como |
|---|---:|---:|---|
| constante | 4972,4 | 5000 | |
| antiguedad_meses | 50,24 | 50 | Cada mes más de antigüedad, 50 pesos más |
| visitas_mes | 1507,16 | 1500 | Cada visita más por mes, 1.500 pesos más |
| ticket_promedio | 0,80 | 0,8 | Cada peso más de ticket, 80 centavos más |
| reclamos | −1503,02 | −1500 | Cada reclamo, 1.500 pesos menos |
| edad | 0,16 | 0 | La edad no influye: el modelo lo descubrió |

No da exacto por el ruido: con otros 16.000 clientes daría otros decimales.
Con más datos, se acerca más.

La interpretación "si sube 1 y las demás quedan igual" es la gran ventaja de
la regresión lineal: el modelo **se puede explicar**. Pero ojo: los
coeficientes dependen de las unidades. El del ticket es 0,8 y el de las
visitas 1.507, y eso **no** quiere decir que las visitas importen 2.000 veces
más: un peso de ticket y una visita no son comparables. Para comparar
importancias hay que escalar antes.

## Predecir

Con los coeficientes se calcula el gasto de un cliente nuevo. Para uno de 40
meses, 1 visita, ticket de 5.000, sin reclamos y 30 años:

    4972,4 + 50,24 × 40 + 1507,16 × 1 + 0,80 × 5000 − 1503,02 × 0 + 0,16 × 30 ≈ 12.494

Es lo que da `predict` (guía 4).

## Cómo se mide

| Métrica | Qué es | Da | Se lee |
|---|---|---:|---|
| **MAE** (error absoluto medio) | El promedio de cuánto le erra, sin importar el signo | ~1.617 pesos | En promedio, le erra por 1.600 pesos |
| **R²** (coeficiente de determinación) | Qué parte de la variación de la respuesta explica el modelo | 0,983 | Explica el 98 % de por qué unos gastan más que otros |

- **R² = 1**: predice perfecto. **R² = 0**: lo mismo que predecir siempre el
  promedio. Puede dar negativo si el modelo es peor que eso.
- El **MAE** está en las unidades de la respuesta (pesos): es el más fácil de
  explicar a alguien que no es técnico. Otra métrica común es el **RMSE**
  (raíz del error cuadrático medio), que castiga más los errores grandes.

¿Por qué el MAE no baja de ~1.600? Porque el ruido de la fórmula tiene desvío
2.000, y no depende de nada que el modelo vea. Para un ruido normal, el error
absoluto medio es alrededor de 0,8 veces el desvío: 0,8 × 2.000 = 1.600. El
modelo llegó al **mejor error posible**. Un modelo más complicado no lo
mejoraría: solo podría aprenderse el ruido (sobreajuste,
[teoría 7](07-evaluacion.md)).

## Cuándo no alcanza

La regresión lineal supone que:

- **La relación es una recta** (un plano, con varias entradas). Si el gasto
  subiera mucho a partir de 5 visitas y nada antes, una recta no lo captaría.
  Se puede ayudar agregando columnas transformadas (el cuadrado, el
  logaritmo) o usando otros modelos (árboles, redes).
- **Los efectos se suman.** Si un reclamo restara más cuanto más visitas
  tiene el cliente, haría falta una columna "visitas × reclamos".
- **Los datos nuevos se parecen a los de entrenamiento.** Fuera del rango que
  vio (un cliente con 50 visitas), la recta sigue y puede predecir cualquier
  cosa.

En estos datos se cumplen las tres porque la fórmula es lineal. Por eso el R²
es tan alto: en datos reales, un R² de 0,98 es raro y conviene sospechar.

## En scikit-learn y en Spark

| | scikit-learn | Spark MLlib |
|---|---|---|
| Modelo | `LinearRegression()` | `LinearRegression(labelCol="gasto_mes_siguiente")` |
| Entrenar | `fit(X_ent, y_ent)` | `fit(df_ent)` (con la columna `features`) |
| Constante y coeficientes | `intercept_`, `coef_` | `intercept`, `coefficients` |
| R² y MAE | `r2_score`, `mean_absolute_error` | `RegressionEvaluator` con `r2` y `mae` |

Los dos llegan a la misma fórmula (la prueba de la imagen lo controla con una
tolerancia por coeficiente).

## Para repasar

- La regresión lineal aprende una constante y un coeficiente por entrada,
  minimizando los errores al cuadrado.
- Los coeficientes se leen como "cuánto cambia si esta sube 1 y las demás
  quedan igual"; no se comparan entre sí si las unidades son distintas.
- R² (qué parte explica) y MAE (cuánto le erra, en pesos).
- El ruido pone un piso al error.

[← 2. Preparación y calidad de datos](02-preparacion-de-datos.md) · [Índice de teoría](README.md) · Siguiente: [4. Clasificación →](04-clasificacion.md)
