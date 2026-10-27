# 8. Prácticas guiadas

Hacer las guías de la materia paso a paso desde la interfaz: en cada paso,
primero una pregunta de opción múltiple (¿cuál es el comando?), después el
comando, un botón que lo corre y otro que verifica que dio lo esperado. Es la
forma de practicar los comandos sin perderse en la terminal, y de comprobar
que se entendieron.

[← 7. Machine Learning](07-machine-learning.md) · [Índice de full](README.md) · Siguiente: [9. Configuración y compose →](09-configuracion-y-compose.md)

La pantalla es **Prácticas**. Cada práctica pide servicios distintos: las que
no se pueden correr ahora lo dicen y ofrecen el arreglo (por ejemplo,
prender el cluster o cambiar los servicios). Los comandos de cada paso son
los mismos de las guías de la materia y se pueden escribir **adentro** del
contenedor.

## Paso 1. La lista

**Qué se ve.** El título *Prácticas* con "Las guías de la materia paso a
paso: el comando de cada paso y un botón que lo corre y lo verifica." y una
etiqueta "N de 9 completas". Arriba, **Para seguir** ("Las que empezaste y
las que se pueden hacer ya"); abajo, **Todas** ("En el orden de las guías").
Cada tarjeta dice la guía, el estado (*Sin empezar*, *En curso*, *Completa*,
*Preparándose* o *No disponible* con el motivo), los minutos, los pasos y una
barra con cuántos van hechos.

| Práctica | Guía | Min | Pasos |
|---|---|---|---|
| HDFS: subir, mirar y replicar | [3](../03-hdfs.md) | 15 | crear la carpeta, subir `ventas_grandes.csv`, listar, leer las primeras líneas, pedir 3 copias, `fsck`, bajarlo a tu compu |
| HDFS: se cae un DataNode | [3](../03-hdfs.md) | 10 | dejar 2 copias, apagar un DataNode, esperar a que lo dé por muerto, ver los sub-replicados, volver a prenderlo |
| MapReduce: contar palabras | [4](../04-yarn-mapreduce.md) | 15 | subir el texto, lanzar el wordcount, seguirlo, leer los logs, abrir el resultado |
| Pig: las ventas en Pig Latin | [5](../05-pig.md) | 15 | LOAD, FILTER y FOREACH, GROUP y SUM |
| Hive: SQL sobre HDFS | [6](../06-hive.md) | 15 | tabla externa, primeras filas, agrupar por sucursal (Tez), por producto, EXPLAIN |
| MariaDB y Sqoop: de la base a HDFS | [7](../07-mysql-sqoop.md) | 15 | ver los productos, JOIN por categoría, traer `ventas` con Sqoop, mirar lo que dejó |
| Spark: el mismo cálculo en memoria | [8](../08-spark.md) | 15 | SparkPi, las ventas con DataFrames, mirar el DAG |
| Alta disponibilidad: se cae el NameNode | [9](../09-zookeeper-ha.md) | 10 | ver quién está activo, apagarlo, esperar el failover, HDFS sigue, prender el que se cayó |
| MongoDB: documentos e índices | [10](../10-mongodb.md) | 15 | un documento entero, `find`, contar, `aggregate` por canal, con índice y sin índice |

**Qué significa.** "Se cae un DataNode" necesita al menos 2 DataNodes (si
la configuración tiene menos, dice "Hacen falta 2 DataNodes y la
configuración tiene 1" y ofrece **Aplicar 2 DataNodes**); "Alta
disponibilidad" necesita `NAMENODES` en 2 o 3, con ZooKeeper andando. La de
MapReduce y la del DataNode conviene hacerlas después de la de HDFS básico (la interfaz lo avisa con
"conviene hacerla antes", pero no lo impide).

## Paso 2. Abrir una práctica

**Qué hacer.** Abrí **HDFS: subir, mirar y replicar**.

**Qué se ve.** A la izquierda, **Te llevás** (lo que vas a aprender),
**Antes de empezar** (cada servicio que necesita, con un punto verde si está
andando o el motivo si no) y **Avance** con el índice de pasos. Arriba a la
derecha, el enlace **Guía 3** (abre la guía de la materia en GitHub) y, si ya
empezaste, **Empezar de nuevo**. Al pie: "El avance queda guardado en este
navegador."

Si falta algo para correr los pasos: "Para correr los pasos desde acá: *motivo*.
Igual podés leerlos, hacerlos en la terminal y marcarlos.", con un botón para
arreglarlo cuando se puede.

## Paso 3. La pregunta antes del comando

**Qué se ve.** El paso abierto empieza con la pregunta. En el primero: "Ahora
queremos crear la carpeta /user/root/ventas en HDFS (y las de arriba, si
faltan). ¿Cuál es el comando correcto?". Las cuatro opciones aparecen
mezcladas (siempre en el mismo orden para el mismo paso) y, si todas empiezan
o terminan igual, esa parte común se muestra aparte ("Todas las opciones
empiezan igual:"). El comando todavía no se ve: sería la respuesta. Abajo:
"Elegí una opción de la pregunta para habilitar Ejecutar."

**Qué hacer.** Elegí una.

**Qué se ve después.** Si acertaste: "¡Bien! Es ese." y el porqué. Si no:
"Ese no." con por qué esa opción está mal, y "El correcto es …" con por qué
ese sí. Por ejemplo, para `mkdir -p /user/root/ventas`: "Es el mkdir de
Linux: crea la carpeta en el disco del contenedor, no en HDFS. El NameNode ni
se entera."

**Qué significa.** Solo cuenta el primer intento: al pie del Avance queda
"Preguntas: acertaste N de M al primer intento". Las opciones incorrectas no
son al azar: son los errores típicos (el comando de Linux en vez del de HDFS,
el guion que falta, la opción que hace otra cosa).

## Paso 4. Ejecutar, verificar o hacerlo en la terminal

**Qué se ve.** El comando ("En la terminal del contenedor"), y tres datos:
**Entra**, **Hace** y **Tiene que dar**. Para `mkdir`: entra "La ruta de la
carpeta"; hace "Solo anota la carpeta en el NameNode: ningún DataNode se
entera."; tiene que dar "/user/root/ventas aparece en /user/root".

Tres botones:

- **Ejecutar**: lo corre el servidor (lo mismo que harías en la terminal).
- **Verificar**: "Mira el cluster y confirma que dio lo esperado (sirve si lo
  hiciste en la terminal)".
- **Lo hice en la terminal**: lo marca como hecho sin comprobar nada.

El paso queda marcado como *Hecho*, *Verificado* o *Hecho en la terminal*; con
**Desmarcar** se vuelve atrás.

**En la terminal.** Es el mismo comando que muestra la pantalla:

<!-- prueba: no (crea una carpeta; la guía 3 de la materia lo corre) -->
```bash
hdfs dfs -mkdir -p /user/root/ventas
```

## Paso 5. La salida y dónde quedó cada cosa

**Qué se ve.** Después de **Ejecutar**:

- Un resumen (o "No dio lo esperado" con el motivo).
- **Salida en la terminal**: el comando, lo que imprimió y el "Código de
  salida 0 (terminó bien)". Al lado del título dice si es "lo que imprimió el
  comando" o "armada con lo que respondió el servicio". El stderr va en ámbar,
  con la aclaración "Hadoop escribe ahí sus avisos (INFO, WARN), no siempre
  son errores".
- Si hay un resultado en tabla, la tabla.
- **Qué pasó en el cluster** (el trace) y un botón para ir a la pantalla
  donde se ve (por ejemplo **Ver en HDFS** o **Ver el trabajo**). Al volver,
  la interfaz ofrece **Volver al paso N**.
- **Dónde va a quedar** (antes) o **Dónde quedó** (después): *En el
  contenedor*, *En HDFS*, *En YARN* y *En tu compu*. Para `mkdir`: en HDFS,
  "/user/root/ventas, vacía. Solo existe en los metadatos del NameNode"; en el
  contenedor, "Nada nuevo"; en tu compu, "La ves en HDFS → Archivos, o en
  http://localhost:9870 → Utilities → Browse the file system".

**Qué significa.** *Dónde quedó* es la parte que más cuesta al principio:
distinguir el disco del contenedor, HDFS (que es otro sistema de archivos,
repartido en DataNodes), lo que vive en YARN mientras corre y lo que llega a
tu compu por el navegador.

## Paso 6. Terminar la práctica

**Qué se ve.** Con todos los pasos hechos: "Terminaste *práctica*", cuántas
preguntas acertaste al primer intento, un botón **Seguir con** la próxima
sugerida y el plegable **Qué hiciste, paso por paso**: cada paso con su
comando y dónde quedó cada cosa.

**Empezar de nuevo** confirma: "Se borra lo que marcaste como hecho y lo que
respondiste en esta práctica. Lo que creaste en el cluster queda." Si ya la
habías completado, las preguntas se pueden contestar de nuevo o **ver la
respuesta**, y **Ejecutar** queda habilitado sin contestar.

**Qué significa.** El avance se guarda en el `localStorage` del navegador
(clave `bds.practicas.v1`): otro navegador u otra compu arranca de cero, y
borrar los datos del sitio lo borra.

## Paso 7. Cómo encaja con las guías de la materia

Las prácticas cubren las guías 3 a 10. La 1 (instalación), la 2 (arrancar y
apagar) y la 11 (problemas) no tienen práctica: se hacen con Docker desde
tu compu. Para la evaluación teórica de cada tema, ver
[evaluación](evaluacion/README.md), que suma preguntas de desarrollo y
ejercicios sobre la interfaz a las de opción múltiple de las prácticas.

## Dónde se usa esto en la industria

Los laboratorios guiados con verificación automática son la forma en que se
capacita en plataformas de datos: **Cloudera** y **Databricks Academy** tienen
labs con pasos que se validan solos, igual que los **Qwiklabs / Google Cloud
Skills Boost** y los **AWS Skill Builder labs**. En los equipos, lo mismo se ve
en los *runbooks* de operación: cada paso con su comando, qué tiene que dar y
cómo comprobar que dio eso antes de seguir.
