"""Machine learning con scikit-learn: lo que aprende cada modelo, al lado de la regla real.

Sobre clientes_senal.csv (generar_senal.py), donde las reglas son conocidas:
  1. Regresion lineal (supervisado): predecir cuanto va a gastar un cliente.
     Muestra los coeficientes aprendidos al lado de los de la formula real.
  2. Clasificacion (supervisado): predecir si vuelve a comprar, con un arbol
     de decision, regresion logistica y una red neuronal (MLPClassifier).
     Muestra las reglas del arbol al lado de la regla real.
  3. Clustering (NO supervisado): KMeans encuentra grupos de clientes sin que
     nadie le diga cuales son. Se comparan con los segmentos reales.
De cada modelo: aciertos en datos que no vio, validacion cruzada, cuanto
tarda en entrenar y cuanta memoria usa.

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_senal.py      # una vez: crea clientes_senal.csv
    python3 ejemplos/ml/modelos_sklearn.py    # -> metricas_sklearn.json y clusters_sklearn.png

scikit-learn trabaja en la memoria de una sola compu (como pandas). El mismo
trabajo con Spark MLlib, que reparte entre varias: modelos_spark.py.
"""
import json
import sys
import time
import tracemalloc

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import accuracy_score, adjusted_rand_score, mean_absolute_error, r2_score, silhouette_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.tree import DecisionTreeClassifier, export_text

archivo = sys.argv[1] if len(sys.argv) > 1 else "clientes_senal.csv"
clientes = pd.read_csv(archivo)
# Las columnas que el modelo puede mirar. NO van segmento_real, gasto ni
# vuelve: son las respuestas.
ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
X = clientes[ENTRADAS]
metricas = {"filas": len(clientes)}


def titulo(texto):
    print(f"\n{'=' * 78}\n{texto}\n{'=' * 78}")


def entrenar(modelo, X, y):
    """Entrena el modelo y devuelve cuanto tardo (segundos) y la memoria pico
    que uso Python para entrenarlo (MB). Medir la memoria lo hace un poco mas lento."""
    tracemalloc.start()
    inicio = time.perf_counter()
    modelo.fit(X, y)
    segundos = time.perf_counter() - inicio
    pico = tracemalloc.get_traced_memory()[1] / 1024 ** 2
    tracemalloc.stop()
    return segundos, pico


# ---------------------------------------------------------------------------
# 0. Separar: el 80% para entrenar y el 20% para PROBAR. Un modelo se evalua
#    con datos que no vio, como un examen con ejercicios nuevos. random_state
#    fija el sorteo: siempre los mismos clientes en cada parte.
# ---------------------------------------------------------------------------
X_ent, X_prueba, c_ent, c_prueba = train_test_split(X, clientes, test_size=0.2, random_state=42)
print(f"{len(X_ent)} clientes para entrenar, {len(X_prueba)} para probar")

# ---------------------------------------------------------------------------
# 1. REGRESION LINEAL: gasto = a + b1*x1 + b2*x2 + ...  El modelo busca los
#    numeros a, b1, b2... que mejor ajustan. Como los datos salieron de una
#    formula lineal, tendria que encontrarla (salvo el ruido).
# ---------------------------------------------------------------------------
titulo("1. REGRESION LINEAL: cuanto va a gastar el mes que viene")
REGLA_GASTO = {"antiguedad_meses": 50, "visitas_mes": 1500, "ticket_promedio": 0.8,
               "reclamos": -1500, "edad": 0}
regresion = LinearRegression()
segundos, mb = entrenar(regresion, X_ent, c_ent["gasto_mes_siguiente"])
print(f"{'':20}{'aprendido':>12}{'regla real':>12}")
print(f"{'(constante)':20}{regresion.intercept_:>12.1f}{5000:>12}")
for nombre, coef in zip(ENTRADAS, regresion.coef_):
    print(f"{nombre:20}{coef:>12.2f}{REGLA_GASTO[nombre]:>12}")
prediccion = regresion.predict(X_prueba)
r2 = r2_score(c_prueba["gasto_mes_siguiente"], prediccion)
mae = mean_absolute_error(c_prueba["gasto_mes_siguiente"], prediccion)
cv = cross_val_score(LinearRegression(), X, clientes["gasto_mes_siguiente"], cv=5, scoring="r2")
print(f"\nR² en prueba: {r2:.3f} (1 = perfecto) | error medio: {mae:,.0f} pesos")
print(f"Validacion cruzada (5 partes): R² {cv.mean():.3f} ± {cv.std():.3f}")
print(f"Entrenar: {segundos * 1000:.0f} ms, {mb:.1f} MB")
print("El error no baja de ~1.600 pesos: es el ruido de la formula (desvio 2.000),\n"
      "que no depende de nada que el modelo pueda ver. Y 'edad' queda cerca de 0.")
metricas["regresion"] = {"constante": regresion.intercept_,
                         "coeficientes": dict(zip(ENTRADAS, regresion.coef_)),
                         "r2": r2, "error_medio": mae, "segundos": segundos}

# ---------------------------------------------------------------------------
# 2. CLASIFICACION: vuelve a comprar (1) o no (0). La regla real es:
#    (visitas >= 4 y reclamos <= 1) o antiguedad >= 36, con 10% de ruido.
# ---------------------------------------------------------------------------
titulo("2. CLASIFICACION: vuelve a comprar el mes que viene?")
modelos = {
    # Siempre dice lo mismo (lo mas comun): cualquier modelo tiene que ganarle
    "tonto (siempre lo mas comun)": DummyClassifier(strategy="most_frequent"),
    # Preguntas de si/no, en forma de arbol: se puede leer lo que aprendio
    "arbol de decision": DecisionTreeClassifier(max_depth=3, random_state=42),
    # Una formula lineal + una curva que la pasa a probabilidad. StandardScaler
    # pone cada columna en la misma escala (sin eso, ticket_promedio, que vale
    # miles, pesaria mas que reclamos, que vale 0 a 5)
    "regresion logistica": make_pipeline(StandardScaler(), LogisticRegression()),
    # Red neuronal: 2 capas ocultas de 16 y 8 neuronas. early_stopping: deja de
    # entrenar cuando ya no mejora con datos que aparta para controlar
    "red neuronal (MLP)": make_pipeline(
        StandardScaler(),
        MLPClassifier(hidden_layer_sizes=(16, 8), max_iter=500, early_stopping=True, random_state=42)),
}
metricas["clasificacion"] = {}
print(f"{'modelo':30}{'aciertos':>10}{'valid. cruzada':>18}{'entrenar':>11}{'memoria':>10}")
for nombre, modelo in modelos.items():
    segundos, mb = entrenar(modelo, X_ent, c_ent["vuelve"])
    aciertos = accuracy_score(c_prueba["vuelve"], modelo.predict(X_prueba))
    # Validacion cruzada: parte los datos en 5, entrena 5 veces (cada vez deja
    # una parte afuera para probar) y promedia. Mas confiable que una sola prueba.
    cv = cross_val_score(modelo, X, clientes["vuelve"], cv=5)
    print(f"{nombre:30}{aciertos:>10.1%}{cv.mean():>11.1%} ± {cv.std():.1%}"
          f"{segundos * 1000:>9.0f} ms{mb:>7.1f} MB")
    metricas["clasificacion"][nombre] = {"aciertos": aciertos, "validacion_cruzada": cv.mean(),
                                         "segundos": segundos, "memoria_mb": mb}
print("Techo: ~90%. El 10% de las respuestas se dio vuelta al azar y ningun modelo\n"
      "puede adivinarlas. La regresion logistica queda abajo porque la regla real\n"
      "no es una recta: es un 'o' de dos condiciones. El arbol y la red si pueden.")

arbol = modelos["arbol de decision"]
print("\nLo que aprendio el arbol (cada linea es una pregunta; class 1 = vuelve):")
print(export_text(arbol, feature_names=ENTRADAS))
print("La regla real:  vuelve si (visitas_mes >= 4 y reclamos <= 1) o antiguedad_meses >= 36")
print("  (visitas_mes <= 3.5 es lo mismo que < 4: el arbol corta entre dos valores)\n"
      "Si una pregunta termina con la misma clase en las dos ramas, no cambia nada:\n"
      "el arbol la agrego por el ruido (Spark MLlib las saca solo).")
print("\nImportancia de cada columna para el arbol (suma 1):")
for nombre, importancia in sorted(zip(ENTRADAS, arbol.feature_importances_), key=lambda x: -x[1]):
    print(f"  {nombre:20}{importancia:.3f}")

# ---------------------------------------------------------------------------
# 3. NO SUPERVISADO: KMeans busca k grupos de puntos cercanos entre si. Nadie
#    le dice cuales son los segmentos: segmento_real solo se usa al final,
#    para ver si los encontro.
# ---------------------------------------------------------------------------
titulo("3. CLUSTERING (KMeans): grupos de clientes, sin decirle cuales son")
datos = clientes[["visitas_mes", "ticket_promedio"]]
# Sin escalar: el ticket (miles de pesos) tapa a las visitas (1 a 10)
sin_escalar = KMeans(n_clusters=3, n_init=10, random_state=42).fit_predict(datos)
# Escalado (y el ticket en logaritmo: 6.000 vs 9.000 pesa como 60.000 vs 90.000)
escalados = StandardScaler().fit_transform(np.column_stack([datos["visitas_mes"],
                                                            np.log(datos["ticket_promedio"])]))
kmeans = KMeans(n_clusters=3, n_init=10, random_state=42)
segundos, mb = entrenar(kmeans, escalados, None)
grupos = kmeans.labels_
# Indice de Rand ajustado: 1 = los mismos grupos que los reales, 0 = al azar
ari_sin = adjusted_rand_score(clientes["segmento_real"], sin_escalar)
ari = adjusted_rand_score(clientes["segmento_real"], grupos)
print(f"Parecido con los segmentos reales (Rand ajustado, 1 = iguales):"
      f" sin escalar {ari_sin:.2f}, escalado {ari:.2f}")
print("\nCada grupo encontrado (filas) contra el segmento real (columnas):")
print(pd.crosstab(grupos, clientes["segmento_real"], rownames=["grupo"], colnames=["segmento real"]))
print("Los frecuentes que compran 4 veces por mes quedan con los ocasionales (3 por\n"
      "mes): estan mas cerca de ellos. En datos reales los grupos tambien se tocan.")
print(f"Entrenar: {segundos * 1000:.0f} ms, {mb:.1f} MB")

# En la vida real no se sabe cuantos grupos hay: el "silhouette" mide que tan
# separados quedan (de -1 a 1, mas es mejor). Se calcula sobre 5.000 clientes:
# con todos compararia cada par (20.000 x 20.000 distancias).
print("\nCuantos grupos elegir si no se supiera (silhouette, mas alto es mejor):")
for k in range(2, 6):
    etiquetas = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(escalados)
    s = silhouette_score(escalados, etiquetas, sample_size=5000, random_state=42)
    print(f"  k={k}: {s:.3f}")

plt.figure(figsize=(7, 5))
plt.scatter(datos["visitas_mes"] + np.random.default_rng(0).uniform(-0.3, 0.3, len(datos)),
            datos["ticket_promedio"], c=grupos, s=4, cmap="viridis")
plt.yscale("log")
plt.xlabel("visitas por mes")
plt.ylabel("ticket promedio (pesos, escala logaritmica)")
plt.title("Grupos que encontro KMeans")
plt.savefig("clusters_sklearn.png", dpi=100, bbox_inches="tight")
print("\nGrafico: clusters_sklearn.png")

metricas["clustering"] = {"rand_ajustado": ari, "rand_ajustado_sin_escalar": ari_sin,
                          "segundos": segundos}
with open("metricas_sklearn.json", "w") as f:
    json.dump(metricas, f, indent=2)
print("Metricas: metricas_sklearn.json")
