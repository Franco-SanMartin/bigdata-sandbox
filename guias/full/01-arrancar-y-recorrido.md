# 1. Arrancar y primer recorrido

Crear el contenedor, abrir la interfaz, prender el cluster y conocer las
partes que se repiten en todas las pantallas: la barra lateral, la barra de
arriba, la paleta de comandos, la consola y la ayuda.

[Índice de full](README.md) · Siguiente: [2. El panel del cluster y el sinóptico →](02-cluster-y-sinoptico.md)

Los comandos de esta guía van en **tu compu** salvo los que dicen *adentro*,
que van en el contenedor (`docker exec -it bigdata-full bash`).

## Paso 1. Crear el contenedor

**Qué hacer.** En tu carpeta de trabajo, con una carpeta `datos/` adentro:

<!-- prueba: no (baja y arranca la imagen full: lo prueba el humo de full.yml) -->
```bash
docker run -d --name bigdata-full --stop-timeout 20 \
  -p 127.0.0.1:8080:8080 -p 127.0.0.1:8888:8888 \
  -v bigdata_full:/hadoop -v "$(pwd)/datos:/datos" \
  franki678/bigdata-sandbox:full
```

**Qué se ve.** Docker devuelve el id del contenedor y vuelve al prompt. En
`docker ps` aparece `bigdata-full` con los puertos `127.0.0.1:8080->8080/tcp` (la interfaz) y
`127.0.0.1:8888->8888/tcp` (JupyterLab).

**Qué significa.** A diferencia de `base` y `ml`, el contenedor de `full`
**no** prende Hadoop: el proceso principal es el servidor de la interfaz
(`tini` → `python3 -m sandbox_server`), que queda esperando. El cluster se
prende cuando lo pedís desde el navegador. Por eso `docker logs` al principio
muestra solo el servidor web.

**En la terminal.**

<!-- prueba: no (necesita el contenedor bigdata-full) -->
```bash
docker ps --filter name=bigdata-full
docker logs bigdata-full
```

Para que arranque solo, como `base`, se agrega `-e AUTOSTART=1` al `docker
run`; toma las mismas variables (`DATANODES`, `REPLICATION`, `SERVICIOS`...).

## Paso 2. Abrir la interfaz

**Qué hacer.** Abrí http://localhost:8080 en el navegador.

**Qué se ve.** La pantalla **Inicio**, con el cartel *El cluster está
apagado* y el texto "Prendelo para usar HDFS, YARN, Hive y el resto. Los
datos de la vez anterior siguen en el volumen.". Abajo, el botón **Iniciar
cluster** y el enlace *¿Querés otros nodos o servicios? Configuralo antes*.

![Inicio: el estado del cluster y qué podés hacer ahora, con lo que falta y cómo activarlo](../../docs/capturas/inicio.png)

**Qué significa.** La interfaz le pregunta al servidor `GET /api/status`. Si
contesta en 1,5 s, trabaja contra el cluster de verdad; si no contesta (por
ejemplo, si abriste la [demo](https://franki-678.github.io/bigdata-sandbox/demo/)),
cae al **modo demo**: un cluster simulado en el navegador. Con `?demo` en la
dirección se fuerza la demo aunque haya servidor.

**En la terminal.** Lo mismo que pide la interfaz, desde tu compu:

<!-- prueba: no (necesita el contenedor bigdata-full con el puerto 8080 publicado) -->
```bash
curl -s http://localhost:8080/api/status | head -c 400
```

## Paso 3. Iniciar el cluster

**Qué hacer.** Tocá **Iniciar cluster**.

**Qué se ve.** El cartel pasa a *El cluster está arrancando* ("Levantando los
procesos en orden.") con una barra de avance y el botón **Ver arranque**, que
lleva a la pantalla Cluster con cada paso, su comando y su log (ver la
[guía 2](02-cluster-y-sinoptico.md#paso-2-el-arranque-paso-a-paso)). Arriba a
la derecha, el estado dice *Arrancando · Paso N de M*.

**Qué significa.** El servidor corre `/opt/entrypoint.sh`, **el mismo** script
de arranque de `base` y `ml`, con la configuración que elegiste, y va leyendo
lo que imprime para armar los pasos. El primer arranque formatea HDFS y carga
las bases de ejemplo (unos 2 minutos); los siguientes saltean esos pasos y
tardan menos de uno. Cuando el script dice *Cluster LISTO*, el estado pasa a
*En marcha · Todo responde*.

**En la terminal.** Lo que hace el botón equivale a arrancar `base` con sus
variables y seguir el log:

<!-- prueba: no (necesita el contenedor bigdata-full) -->
```bash
docker logs -f bigdata-full
```

Y, adentro, el resumen de procesos de siempre:

<!-- prueba: adentro | espera: NameNode -->
```bash
estado
```

## Paso 4. Recorrer Inicio

**Qué hacer.** Con el cluster en marcha, mirá Inicio de arriba abajo.

**Qué se ve.**

- **El estado**: *El cluster está andando* (o *degradado*, o *con fallas*,
  con el botón **Ver qué falla**), con los procesos y los DataNodes vivos.
- **Qué podés hacer ahora**: una tarjeta por tema de la materia (Subir y
  explorar HDFS, Trabajos MapReduce, Pig Latin, Consultas en Hive, MariaDB,
  Spark, Alta disponibilidad, MongoDB, Pipeline completo, Machine Learning,
  JupyterLab). Cada una dice *Listo*, *Arrancando* o *No disponible*; si no
  está disponible, dice por qué y trae el botón que lo arregla. Abajo a la
  derecha, el número de guía de la materia.
- **Prácticas sugeridas**: las cuatro primeras que se pueden hacer ya (HDFS
  básico, WordCount en YARN, HDFS ante fallas, Hive sobre HDFS...).
- **Lo que tenés en el cluster**: archivos en HDFS, tablas de Hive, trabajos
  en YARN y modelos entrenados, cada uno con un enlace a su pantalla.
- **Últimas acciones**: lo último que pasó, con el comando. Vacío dice *Todavía
  no pasó nada*.

**Qué significa.** Las tarjetas salen de cruzar la configuración con el estado
de cada proceso: por ejemplo, con `SERVICIOS=mapreduce` la tarjeta de Hive dice
*No disponible* y ofrece cambiar la configuración. Es la misma regla que
bloquea los botones en el resto de las pantallas.

## Paso 5. La barra lateral y la barra de arriba

**Qué se ve.** A la izquierda, las pantallas en tres grupos:

| Grupo | Pantallas | Atajo |
|---|---|---|
| Empezar | Inicio, Prácticas guiadas | `G I`, `G R` |
| Trabajar | HDFS, Trabajos en YARN, Consultas, Pipeline, Machine Learning | `G H`, `G Y`, `G D`, `G P`, `G M` |
| Operar | Cluster, Consola, Configuración | `G C`, `G O`, `G S` |

Los atajos se escriben como dos teclas seguidas: `G` y después la letra.
Arriba están el estado del cluster, el botón de la consola (`Ctrl+J`), la
búsqueda (`Ctrl+K`) y la ayuda (`?`).

**Qué significa.** Cada pantalla tiene su dirección: `#hdfs`, `#yarn`,
`#cluster/dn2`... Se pueden guardar en favoritos o compartir, y recargar la
página vuelve al mismo lugar.

## Paso 6. La paleta de comandos

**Qué hacer.** Apretá `Ctrl+K` y escribí, por ejemplo, *fsck* o *wordcount*.

**Qué se ve.** Una lista de pantallas y acciones que coinciden; las que no se
pueden hacer ahora aparecen con el motivo.

**Qué significa.** Es un atajo para ir y hacer sin buscar el botón. Algunas
entradas solo te llevan a la pantalla (por ejemplo, *Revisar HDFS con fsck*
abre HDFS, y el fsck lo corrés vos ahí).

## Paso 7. La consola y la ayuda

**Qué hacer.** Apretá `Ctrl+J`.

**Qué se ve.** Un cajón con la actividad: cada cosa que hiciste y cada cosa
que hizo el cluster, con la hora y, si corrió un comando, el comando. La
[guía 10](10-consola.md) la recorre entera.

**Qué hacer.** Apretá `?`.

**Qué se ve.** La ayuda de la pantalla en la que estás y la lista de atajos.

## Paso 8. Apagar

**Qué hacer.** Desde Inicio o Cluster, **Detener** el cluster. O desde tu
compu:

<!-- prueba: no (apaga el contenedor bigdata-full) -->
```bash
docker stop bigdata-full
```

**Qué significa.** Las dos formas apagan **en orden**, con la misma función
`apagar_en_orden` de `base`: primero lo que escribe en HDFS (HiveServer2, el
Metastore, Spark History), MySQL, MongoDB y JupyterLab; cuando esos
terminaron, el resto de los procesos de Java (YARN, DataNodes, NameNode). Detener desde la interfaz deja el contenedor prendido, con el
servidor esperando el próximo *Iniciar*; `docker stop` apaga todo y espera
hasta 20 s (`--stop-timeout 20`). En los dos casos los datos quedan en el
volumen `bigdata_full`.

Para volver: `docker start bigdata-full` y, en la interfaz, *Iniciar
cluster*.

## Qué te llevás

- `full` es `ml` con un servidor web adelante: el cluster es el mismo y se
  prende con el mismo script.
- Cada botón tiene su comando, y la consola lo muestra.
- Si algo no se puede hacer, la interfaz dice por qué y cómo habilitarlo.
