# Evaluación: Consultas en cuatro motores

Sobre la [guía 5](../05-consultas.md). La teoría de cómo Hive lanza
trabajos en YARN está en el
[ciclo de vida en YARN](../teoria/ciclo-de-vida-yarn.md).

[← Evaluación](README.md) · [Índice de full](../README.md)

## Opción múltiple

### 1. Corrés `SELECT * FROM ventas LIMIT 5` en Hive. ¿Aparece un trabajo en **Trabajos en YARN**?

- a) Sí, un trabajo Tez.
- b) Sí, un MapReduce.
- c) No: HiveServer2 la resuelve leyendo directo de HDFS (una *fetch task*).
- d) No: Hive tiene los datos en caché.

<details><summary>Respuesta</summary>

**c).** Un `SELECT` con `LIMIT` sin agrupar ni ordenar no necesita juntar
filas de muchos bloques: HiveServer2 lee el archivo y listo. El trace lo
dice: "HiveServer2 la resuelve leyendo directo de HDFS, sin YARN (fetch
task)".

- a) Pasa con `GROUP BY` u `ORDER BY`.
- b) El motor de Hive en la imagen es Tez.
- d) No es una cuestión de caché: aunque sea la primera vez que la corrés,
  no lanza trabajo.
</details>

### 2. ¿Por qué `GROUP BY producto` sí lanza un trabajo en YARN?

- a) Porque Hive no sabe agrupar.
- b) Porque hay que juntar filas de muchos bloques: Hive arma un DAG de Tez y lo manda a YARN.
- c) Porque la tabla es externa.
- d) Porque la consulta es más larga.

<details><summary>Respuesta</summary>

**b).** Agrupar u ordenar necesita ver todas las filas, que están repartidas
en bloques: eso es trabajo distribuido.

- a) Es el motor el que lo traduce a Tez.
- c) Ser externa no cambia el plan.
- d) El largo del texto no importa.
</details>

### 3. Hacés `DROP TABLE ventas` sobre la tabla externa de Hive. ¿Qué pasa con `/user/root/ventas`?

- a) Se borra.
- b) Queda: se borra solo la descripción del Metastore.
- c) Pasa a la papelera de HDFS.
- d) Se mueve a `/user/hive/warehouse`.

<details><summary>Respuesta</summary>

**b).** Una tabla externa apunta a los archivos sin copiarlos; borrarla borra
la descripción.

- a), c) Pasaría con una tabla administrada.
- d) No se mueve nada.
</details>

### 4. En el **Plan** de MariaDB aparece la marca **lee todo**. ¿Qué indica?

- a) Que la consulta devolvió todas las filas.
- b) Que el motor va a recorrer la tabla entera (`ALL`), sin usar un índice.
- c) Que lanzó un trabajo en YARN.
- d) Que la tabla está vacía.

<details><summary>Respuesta</summary>

**b).** Las marcas *lee todo* son `TableScan` en Hive, `ALL` en MariaDB y
`COLLSCAN` en MongoDB: recorrer todo. El plan lo dice antes de correr.

- a) El plan no corre la consulta.
- c) MariaDB nunca lanza trabajos en YARN.
- d) No.
</details>

### 5. ¿Dónde quedan las consultas **Guardadas** y el **Historial**?

- a) En el Metastore de Hive.
- b) En MySQL.
- c) En el `localStorage` de este navegador.
- d) En HDFS.

<details><summary>Respuesta</summary>

**c).** En otra compu o en otro navegador no están; borrar los datos del
sitio los borra.

- a), b), d) No viajan al cluster.
</details>

### 6. ¿Por qué la interfaz no deja correr `sh` ni `exec` en Pig?

- a) Porque Pig no los soporta.
- b) Porque el script corre en el contenedor con permisos de root.
- c) Porque lanzan trabajos de Spark.
- d) Porque tardan mucho.

<details><summary>Respuesta</summary>

**b).** Desde el editor se podría correr cualquier cosa en el contenedor. Por
la misma razón no deja `STREAM` ni borrar fuera de `/user`.

- a) Pig sí los soporta en la terminal.
- c), d) No es el motivo.
</details>

## Desarrollo

### 1. ¿Para qué sirve mirar el plan antes de correr una consulta? Dá un ejemplo en dos motores.

<details><summary>Respuesta modelo</summary>

El plan es lo que el motor **piensa** hacer, sin hacerlo. Sirve para saber
de antemano si la consulta va a lanzar un trabajo en YARN (y tardar segundos
o minutos) o si va a recorrer toda la tabla. En Hive, el plan de un `GROUP
BY` dice "Lanza un trabajo en YARN con N etapas" y empieza con un
`TableScan`; en MongoDB, el `explain` muestra `COLLSCAN` sin índice e
`IXSCAN` con índice. Con eso se decide si agregar un índice, filtrar antes o
cambiar de motor.

Rúbrica: qué es el plan (1), para qué sirve (2), dos ejemplos (2).
</details>

### 2. Hive y MariaDB entienden SQL. ¿En qué se diferencian, según lo que muestra la pantalla?

<details><summary>Respuesta modelo</summary>

Hive es SQL sobre **archivos de HDFS**: no guarda los datos, solo la
descripción en el Metastore, y cuando hace falta juntar filas lanza un
trabajo Tez en YARN (segundos de arranque, pero escala a muchos nodos).
MariaDB es una base relacional que guarda sus datos y resuelve todo en su
propio proceso, en una sola máquina, con índices: rápida para datos chicos y
para modificar filas, pero no reparte el trabajo. El trace lo muestra: "la
convierte en un trabajo Tez" contra "MySQL la resuelve en su propio
proceso".

Rúbrica: dónde están los datos (2), quién resuelve (2), cuándo conviene cada
uno (1).
</details>

## Ejercicios sobre la interfaz

### Ejercicio 1. Con y sin YARN

En Hive, corré **Primeras filas** y después **Ventas por producto**. Para
cada una anotá el tiempo, si aparece un trabajo en Trabajos y qué dice
*Hace* en el Trace.

<details><summary>Solución</summary>

**Primeras filas**: rápida, sin trabajo en YARN; *Hace*: "HiveServer2 la
resuelve leyendo directo de HDFS, sin YARN (fetch task)". **Ventas por
producto**: tarda más (la primera vez, la sesión de Tez lleva 10-20 s), con
un trabajo de motor Tez en Trabajos; *Hace*: "HiveServer2 la convierte en un
trabajo Tez y lo manda a YARN", y en el Trace aparece el renglón **YARN** con
el id.

Rúbrica: los tres datos de cada una (3), explica la diferencia (2).
</details>

### Ejercicio 2. Leer un error

Corré `SELECT * FROM no_existe;` en Hive y en MariaDB. Copiá el mensaje de
cada motor, identificá el código de error y buscá el evento en la Consola.

<details><summary>Solución</summary>

Hive: `SemanticException [Error 10001] … Table not found 'no_existe'`, con
`state=42S02`. MariaDB: `ERROR 1146 (42S02) … Table 'tienda.no_existe'
doesn't exist`. Los dos comparten el SQLSTATE `42S02` (tabla o vista no
encontrada). En la Consola, con *Errores*, aparece un evento de origen *Vos*
con el comando que se corrió y el mensaje en **Log**.

Rúbrica: los dos mensajes (2), el código (1), el evento en la Consola (1).
</details>

### Ejercicio 3. Un índice en MongoDB

Con `MONGODB=si`, corré **Índice: IXSCAN en vez de COLLSCAN** y mirá el
**Plan**. ¿Qué etapa aparece? ¿Qué cambiaría sin el índice?

<details><summary>Solución</summary>

Con el índice, la etapa es `IXSCAN`: MongoDB va derecho a los documentos que
cumplen el filtro. Sin índice sería `COLLSCAN`, con la marca *lee todo*:
recorrer la colección entera. En una colección grande, la diferencia es de
órdenes de magnitud.

Rúbrica: identifica la etapa (2), explica la alternativa (2).
</details>
