"""Genera un dataset de clientes CON SEÑAL: reglas conocidas + ruido (CSV).

Para aprender machine learning conviene empezar con datos donde SABEMOS la
respuesta: las reglas con las que se generaron estan escritas aca abajo.
Despues de entrenar un modelo se puede comparar lo que aprendio con la regla
real (modelos_sklearn.py y modelos_spark.py lo muestran lado a lado).

Uso (adentro del contenedor, parado en /datos):

    python3 ejemplos/ml/generar_senal.py                   # 20.000 clientes -> clientes_senal.csv
    python3 ejemplos/ml/generar_senal.py 100000 otro.csv    # otra cantidad y otro nombre

Columnas (una fila por cliente de la tienda):

    antiguedad_meses     hace cuantos meses es cliente (1 a 60)
    visitas_mes          compras por mes (1 a 10)
    ticket_promedio      cuanto gasta por compra, en pesos
    reclamos             reclamos que hizo en el ultimo año (0 a 5)
    edad                 edad del cliente (18 a 80). NO INFLUYE EN NADA: esta
                         para ver si los modelos se dan cuenta de que no sirve
    segmento_real        el grupo del cliente. Es "la respuesta" del modelo no
                         supervisado: NO usarla para entrenar, solo para comparar
    gasto_mes_siguiente  lo que va a gastar el mes que viene (para REGRESION)
    vuelve               1 si vuelve a comprar el mes que viene, 0 si no (para
                         CLASIFICACION)

LAS REGLAS (lo que los modelos tienen que descubrir):

1. Segmentos (para el modelo NO supervisado, KMeans). Cada cliente es de uno
   de 3 grupos, que se distinguen por visitas y ticket:

       ocasional  60% de los clientes   visitas_mes 1 a 3    ticket ~ 6.000
       frecuente  30%                   visitas_mes 4 a 10   ticket ~ 9.000
       mayorista  10%                   visitas_mes 1 a 6    ticket ~ 60.000

   (el ticket varia alrededor de ese valor: distribucion lognormal, desvio 30%)

2. gasto_mes_siguiente (REGRESION LINEAL):

       gasto = 5000 + 1500 * visitas_mes + 0.8 * ticket_promedio
               - 1500 * reclamos + 50 * antiguedad_meses + ruido

   ruido: normal con desvio 2000 pesos (lo que ningun modelo puede adivinar).
   Si da negativo, 0 (pasa en muy pocos casos).

3. vuelve (CLASIFICACION):

       vuelve = 1  si (visitas_mes >= 4 y reclamos <= 1) o antiguedad_meses >= 36
       vuelve = 0  si no

   y despues se da vuelta el 10% de las respuestas, al azar (ruido: clientes
   que hacen lo contrario de lo esperado). Por eso el MEJOR modelo posible
   acierta ~90%, no 100%: si uno da 99%, algo esta mal (por ejemplo, se le
   paso la respuesta entre los datos de entrada).

Siempre genera los mismos datos (semilla fija).
"""
import sys

import numpy as np
import pandas as pd

filas = int(sys.argv[1]) if len(sys.argv) > 1 else 20000
archivo = sys.argv[2] if len(sys.argv) > 2 else "clientes_senal.csv"
azar = np.random.default_rng(42)

# 1. Segmentos y lo que depende de ellos
segmento = azar.choice(["ocasional", "frecuente", "mayorista"], size=filas, p=[0.6, 0.3, 0.1])
visitas = np.select(
    [segmento == "ocasional", segmento == "frecuente"],
    [azar.integers(1, 4, filas), azar.integers(4, 11, filas)],
    default=azar.integers(1, 7, filas))
ticket_medio = np.select([segmento == "ocasional", segmento == "frecuente"], [6000, 9000], default=60000)
ticket = np.round(ticket_medio * azar.lognormal(0, 0.3, filas))

# 2. El resto de los datos de entrada, iguales para todos los segmentos
antiguedad = azar.integers(1, 61, filas)
reclamos = np.minimum(azar.poisson(0.6, filas), 5)
edad = azar.integers(18, 81, filas)

# 3. Regresion: la formula + ruido
gasto = (5000 + 1500 * visitas + 0.8 * ticket - 1500 * reclamos + 50 * antiguedad
         + azar.normal(0, 2000, filas))
gasto = np.maximum(np.round(gasto), 0)

# 4. Clasificacion: la regla + 10% de respuestas dadas vuelta
vuelve = ((visitas >= 4) & (reclamos <= 1)) | (antiguedad >= 36)
dar_vuelta = azar.random(filas) < 0.10
vuelve = np.where(dar_vuelta, ~vuelve, vuelve).astype(int)

clientes = pd.DataFrame({
    "antiguedad_meses": antiguedad,
    "visitas_mes": visitas,
    "ticket_promedio": ticket.astype(int),
    "reclamos": reclamos,
    "edad": edad,
    "segmento_real": segmento,
    "gasto_mes_siguiente": gasto.astype(int),
    "vuelve": vuelve,
})
clientes.to_csv(archivo, index=False)

print(f"Listo: {filas} clientes en {archivo}")
print(clientes.head().to_string(index=False))
print(f"\nSegmentos: {clientes['segmento_real'].value_counts().to_dict()}")
print(f"Vuelven: {vuelve.mean():.1%} | respuestas dadas vuelta (ruido): {dar_vuelta.mean():.1%}")
