# Evaluación de la versión full

Preguntas y ejercicios para comprobar que se entendió lo que muestra la
interfaz y la teoría que hay detrás. Sirve para repasar solo, para armar un
examen o para corregir un trabajo práctico.

[← Teoría](../teoria/README.md) · [Índice de full](../README.md) · [Referencia](../referencia.md)

## Qué hay en cada archivo

| Tema | Archivo | Guías | Teoría |
|---|---|---|---|
| Operar el cluster: lámparas, carteles, configuración, memoria, Consola | [operacion.md](operacion.md) | [1](../01-arrancar-y-recorrido.md), [2](../02-cluster-y-sinoptico.md), [9](../09-configuracion-y-compose.md), [10](../10-consola.md) | [La interfaz y el cluster](../teoria/ui-y-cluster.md), [Observabilidad](../teoria/observabilidad.md) |
| HDFS: bloques, réplicas, caídas, re-replicación | [hdfs.md](hdfs.md) | [3](../03-hdfs.md) y el paso 7 de la [2](../02-cluster-y-sinoptico.md) | [Salud de HDFS](../teoria/salud-hdfs.md) |
| YARN: estados, memoria, contenedores, logs, tres motores | [yarn.md](yarn.md) | [4](../04-trabajos-yarn.md) | [Ciclo de vida en YARN](../teoria/ciclo-de-vida-yarn.md) |
| Consultas: Hive, MariaDB, MongoDB y Pig; plan y trace | [consultas.md](consultas.md) | [5](../05-consultas.md) | [Ciclo de vida en YARN](../teoria/ciclo-de-vida-yarn.md) |
| Pipeline: etapas, herramientas, dependencias | [pipeline.md](pipeline.md) | [6](../06-pipeline.md) | [Pipelines](../teoria/pipelines.md) |
| Machine Learning: línea base, métricas, interpretabilidad | [machine-learning.md](machine-learning.md) | [7](../07-machine-learning.md) | [Interpretabilidad](../teoria/interpretabilidad.md) |

## Cómo está armado cada archivo

Cada archivo tiene tres partes:

1. **Opción múltiple.** Cuatro opciones, una correcta. La respuesta está
   plegada abajo de cada pregunta (abrila recién después de contestar) y
   explica por qué la correcta sí y por qué cada una de las otras no.
2. **Desarrollo.** Preguntas para contestar con tus palabras. La respuesta
   modelo está plegada, con una **rúbrica** en puntos: qué tiene que aparecer
   para que la respuesta esté completa.
3. **Ejercicios sobre la interfaz.** Algo para hacer en la interfaz con el
   cluster prendido y anotar lo que se ve. La solución dice qué se tendría que
   ver y de dónde sale, con su rúbrica. Donde los números dependen de la
   corrida (tiempos, ids, filas exactas), se corrige que salgan de la
   pantalla correcta y que la explicación sea coherente, no el número.

Ningún archivo tiene comandos para copiar: los comandos están en las guías,
con su marca de dónde se corren.

## Cómo se complementa con las Prácticas

La pantalla **Prácticas** ([guía 8](../08-practicas.md)) ya tiene preguntas
de opción múltiple, pero de otro tipo:

| | Prácticas | Esta evaluación |
|---|---|---|
| Qué pregunta | "Ahora queremos X, ¿cuál es el comando correcto?" | Qué significa lo que se ve, por qué pasa, qué conviene |
| Cuándo | Antes de cada paso, con el cluster prendido | Cuando quieras, con o sin cluster (menos los ejercicios) |
| Opciones incorrectas | Los errores típicos al escribir el comando (el de Linux en vez del de HDFS, el guion que falta) | Las confusiones típicas de concepto (bloques contra copias, vivo contra listo, proceso contra servicio) |
| Corrección | La interfaz: solo cuenta el primer intento ("acertaste N de M al primer intento") | Vos o el docente, con la respuesta y la rúbrica |
| Dónde queda | En el `localStorage` del navegador | En papel o donde lo entregues |
| Cubre | Las guías 3 a 10 de la materia, comando por comando | Las pantallas de la interfaz y la teoría de esta carpeta |

Un recorrido posible por tema:

1. Hacer la **práctica** de la interfaz (aprender los comandos, con la
   pregunta de cada paso).
2. Leer la **guía** de full de la misma pantalla y su **teoría**.
3. Contestar la **opción múltiple** de este archivo sin mirar las respuestas.
4. Hacer los **ejercicios sobre la interfaz** y escribir el **desarrollo**.

Para un examen, las Prácticas sirven como parte práctica autocorregida
(captura de "acertaste N de M al primer intento" y del "Terminaste …") y
estos archivos como parte teórica y de interpretación.

## Para el docente

- Las preguntas salen de lo que la interfaz muestra y del código del
  sandbox: textos de la pantalla, configuración de la imagen
  (`conf/*.xml`, `conf/spark-defaults.conf`) y salidas reales de las pruebas.
  Los valores de referencia de Machine Learning son los medidos en la imagen
  (ver la [guía 7](../07-machine-learning.md)).
- Las rúbricas suman entre 4 y 7 puntos por ítem; escalalas a la nota que
  uses.
- Los ejercicios que dependen de tiempos (cuántos trabajos corren a la vez,
  cuánto tarda una sesión) piden la explicación, no el número exacto.
