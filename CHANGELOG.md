# Cambios

Los cambios que importan de cada versión. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones,
[Semantic Versioning](https://semver.org/lang/es/). Las imágenes se publican
en Docker Hub como
[`franki678/bigdata-sandbox`](https://hub.docker.com/r/franki678/bigdata-sandbox),
con un tag por versión de la imagen (`latest`, `base`, `ml`, `full`).

## [Sin publicar]

### Agregado

- **Inicio con el mapa vivo del ecosistema** (`full`): las 20 herramientas
  ordenadas por capa (desde dónde trabajás → cómo lo pedís → quién hace el
  trabajo → quién reparte → dónde quedan los datos, más el puente y lo que
  corre en una sola máquina), cada una con la lámpara de sus procesos reales y
  flechas de quién le pide qué a quién. Las flechas de MapReduce, Tez y Spark
  se mueven cuando hay un trabajo de ese motor corriendo en YARN.
  - **Ficha de cada herramienta**: qué hace, una analogía, qué se puede hacer
    ahí (la pantalla de la interfaz y sus UIs web), el comando de ejemplo
    (los de bash se mandan a la terminal integrada), con qué no confundirla y
    con quién habla.
  - **Recorridos guiados** sobre el mapa ("De un CSV a un tablero" y "Una
    consulta, tres motores"), paso a paso con el comando de cada paso.
  - **¿Cuál uso?**: las seis preguntas (lenguajes, motores, almacenamiento,
    una máquina contra el cluster, quién coordina, cómo entran los datos),
    cada una abre su tabla en Comparar.
  - El contenido sale de `docs/maquetas/ecosistema.html`.
- **Pantalla Comparar** (`full`, `G K`): la misma cuenta de ventas por
  producto en MapReduce a mano, Pig, Hive y PySpark, con el código real de
  `datos/ejemplos` (la parte que hace la cuenta o el archivo entero). Arriba,
  el flujo: el dato una sola vez en HDFS, cuatro lenguajes, tres motores y
  cuatro resultados, con los cables que se mueven mientras corre cada versión.
  Cada columna dice qué motor la ejecuta, cuántas líneas hacen la cuenta,
  qué fases arma (las de la última corrida si YARN las trae) y cuánto tardó
  la última vez, en la misma escala para las cuatro. MapReduce, Hive y Spark
  se lanzan desde ahí (las mismas plantillas de Trabajos); las cuatro tienen
  su comando para la terminal y uno final para ver que dieron lo mismo.
  Abajo, las seis tablas de "¿Cuál uso?" (`#comparar/quien-hace-el-trabajo`).
  - **Lo que movió cada corrida**, en la misma escala para las cuatro:
    leído de HDFS, shuffle, disco local de los nodos y memoria × tiempo en
    YARN (Pig suma sus varios trabajos). Debajo, "Qué muestran los números"
    lo dice en palabras. Con las salidas reales: MapReduce a mano manda
    3,2 MB por el shuffle y PySpark 3 KB, porque Spark suma antes de mandar; y
    PySpark lee la entrada tres veces (inferSchema, show y write). Tez sin
    Timeline Server no deja contadores: de Hive se ve el tiempo y la memoria.
- **`GET /api/yarn/metrics?apps=…`** (servidor): lo que costó cada trabajo,
  igual para los tres motores. Tiempo, MB·s y vcores·s salen del RM; cuando
  terminó, lo leído y escrito en HDFS, el shuffle, el disco local y las tareas
  salen de JobHistory (MapReduce) o de Spark History (sin las etapas SKIPPED).
  Hasta 12 trabajos por pedido; uno que no existe vuelve con `error`.
- **La barra lateral sigue las capas del mapa**: Empezar, Almacenamiento
  (HDFS, Tablas, Bases), Recursos (Trabajos), Procesamiento (Lenguajes,
  Comparar, Machine Learning), Ingesta (Pipeline) y Operar, cada capa con su
  color. Arriba de cada pantalla se ve en qué capa está (Almacenamiento › HDFS).
- **Pantalla Tablas** (`full`, `G T`): lo que anota el Metastore de cada tabla
  de Hive. Para la tabla elegida: adónde apunta en HDFS (con enlace a la
  carpeta), si es externa o administrada y qué pasa con DROP TABLE, las
  columnas, quién la puede leer (Hive y Spark por el nombre, Pig por la
  carpeta, con el script que arma el esquema y saltea el encabezado), una
  muestra y el CREATE TABLE. "Consultarla en Hive" y "Leerla con Pig" la abren
  en Lenguajes.
- **Vista Aula rehecha como plano del laboratorio** (`empresa`): el maestro
  adelante, cada fila como un rack con sus PCs, y en cada PC su lámpara, la
  memoria de YARN que presta y usa, sus bloques y sus contenedores. Arriba, el
  aula en números y "¿Ya pueden apagar?"; al costado, los pasos para sumar PCs
  por Veyon y el detalle de la PC elegida.

### Cambiado

- **Consultas se partió en Lenguajes y Bases** (`full`): Lenguajes (`G L`)
  tiene Hive y Pig, que corren en el cluster; Bases (`G B`) tiene MariaDB y
  MongoDB, de una sola máquina. Es el mismo editor (documentos, ejemplos,
  plan, trace, historial y guardadas, que se conservan), con una explicación
  arriba de qué tiene de distinto cada una. `#lenguajes/pig` o
  `#bases/mongodb` abren directo ese motor (Comparar ya lleva a Pig), y
  `#datos` sigue andando: lleva a Lenguajes, o a Bases si era MariaDB o
  MongoDB.
- **Tema claro en toda la interfaz** (D-06): tokens nuevos (fondo blanco,
  grises y estados con contraste ≥ 4,5:1 sobre blanco), la terminal integrada,
  el editor del estudio de ML y los gráficos. `tema.test.ts` pasa a exigir
  claro.

- **`empresa` con las PCs del laboratorio** (etapa 2, rama `empresa-aula`),
  con lo que midió la sonda el 27/10:
  - `RED=wireguard`: túnel WireGuard con hub en la PC del profe (UDP 51820) e
    inscripción con un código de la clase (TCP 8099). Cada PC reserva su
    nombre (`pcNN`), se conecta **hacia** el profe y se anuncia a HDFS y YARN
    con su IP del túnel (`10.13.0.x`). Las PCs no publican ningún puerto (no
    aparece el cartel del firewall). MTU 1380, con respaldo a 1280 por PC.
    Módulo del kernel o `wireguard-go`.
  - Imagen **`trabajador`** para las PCs: Java 8, Hadoop recortado al
    DataNode y al NodeManager, Python con numpy (el mismo que el maestro) y
    WireGuard; Spark y Tez llegan desde HDFS. 192 MB comprimida, contra
    1,6 GB de `empresa`. amd64 y arm64.
  - Cada PC presta dos tercios de la RAM de Docker (2048 MB en las de 8 GB,
    5120 en las de 16) y sus cores; `TRABAJADOR_RAM` y `TRABAJADOR_CORES` lo
    pisan. YARN reparte por memoria y por cores y da por perdida una PC al
    minuto.
  - El maestro corre la interfaz con la vista **Aula**: cada PC una lámpara
    (sumándose, arriba, sin respuesta, caída) con lo que presta y sus
    bloques, la IP, el código y la línea para Veyon, y el aviso "ya pueden
    apagar" cuando el maestro tiene una copia de cada bloque.
  - `empresa-profe.cmd` (arranca el maestro, muestra la línea para Veyon y
    carga datasets midiendo la velocidad) y `empresa-alumno.cmd` (carga la
    imagen de su carpeta o de una ruta de red y suma la PC). Release
    `aula-v1` con las imágenes en `.tar.gz`.
  - Guía 3 reescrita como el paso a paso de la clase, con tiempos y una tabla
    de tamaños de dataset para esta red.
- Sonda: `sonda-alumno.cmd IP sin-b`, sin la prueba B (no publica el 8098 y
  no aparece el cartel del firewall).
- Pruebas `aula-wg`, `aula-wg-caida` y `aula-wg-cero`: las PCs en redes de
  Docker separadas, unidas solo por el túnel, sin puertos publicados.

- Terminal integrada en la interfaz de `full` (``Ctrl+` `` o el ícono de arriba):
  bash del contenedor por websocket (`/api/terminal`), solo desde `localhost`
  (chequea Host y Origin). `TERMINAL=0` la apaga; `TERMINAL_HOSTS` suma
  nombres permitidos.
- Prácticas: *Correr en la terminal* en cada paso con comando. Se tipea en la
  terminal, toma lo que imprimió y el código de salida y, si el paso tiene
  verificación, la corre igual que antes.
- Prácticas: autoevaluación al final de cada una (2-3 preguntas y un desafío
  con pista y solución).
- Prácticas: exportar e importar el avance como JSON (al importar se queda,
  de cada práctica, la versión más avanzada).
- Prácticas: en cada tarjeta, qué servicios necesita (con su estado) y qué
  práctica conviene hacer antes.
- Prueba de humo de `full`: abre la terminal, corre comandos (`whoami`,
  `pwd`, `hdfs`) y comprueba que rechaza otro origen.
- Estudio de ML, etapa (a) (motor y primeras pantallas en `full`):
  - `sandbox_ml` en `ml` y `full` (`/opt/sandbox/ml`, en el `PYTHONPATH`):
    catálogo de 48 modelos de scikit-learn, XGBoost y Spark MLlib con cada
    hiperparámetro explicado, recetas validadas contra el catálogo (avisa de
    fugas, columnas id y desbalance), el script que reproduce la corrida
    (scikit-learn o PySpark con `pyspark.ml.Pipeline`, también como
    notebook), perfil de los datos y registro de experimentos en
    `/hadoop/ml/experimentos`.
  - Rutas del servidor: `/api/ml/catalog`, `sources`, `profile`, `check`,
    `code`, `experiments` y `runs` (correr con `python3` o `spark-submit` en
    YARN, con límite de tiempo y memoria, avance en vivo y cancelar).
  - Pantalla de ML: las fuentes de `/datos`, HDFS y Hive, el perfil de cada
    dataset, la receta revisada paso a paso, el código generado (editable) y
    la tabla de experimentos con las corridas de la sesión. Si una ruta falla,
    el panel lo dice con el mensaje del servidor. El recorrido de clase
    anterior sigue en *Guiado*.
- Estudio de ML, etapa (b) (datos en HDFS, perfil y limpieza en `full`):
  - Datos en HDFS en cualquier formato: Parquet, ORC, Avro, JSON (documento o
    JSON lines), CSV y TSV, y texto. También comprimidos (gzip, bz2, snappy),
    carpetas de partes, particionadas (`anio=/mes=`) y tablas de Hive
    (`sandbox_ml/fuentes.py`). Se ven el formato, la compresión, los
    archivos, el tamaño y las particiones. El esquema inferido se puede
    editar (cada tipo cambiado es un cast al leer) y hay filtro de
    particiones. Si el separador elegido no es el del archivo, se sugiere
    otro.
  - Perfil a escala con Spark (`perfil_spark.py`, con `spark-submit` en YARN),
    sobre una muestra o con pasada completa: nulos, distintos aproximados,
    mínimo y máximo, cuantiles del 1 al 99 %, extremos, histogramas, top de
    categorías y fechas, en pocas pasadas. El perfil con pandas sigue para lo
    chico de `/datos`.
  - Receta de limpieza columna por columna (`limpieza.py`), con versiones
    (`/api/ml/cleaning`, en `/hadoop/ml/limpiezas`):
    - pasos de tipo, texto, regex, fechas, nulos (con columna indicadora),
      extremos, categorías raras, mapeos, columnas derivadas, duplicados y
      filtros;
    - lo que es solo de entrenamiento (duplicados, filtros, filas que se
      sacan) se aplica antes de partir;
    - el resto va adentro del modelo, en el paso `Limpiar` del Pipeline
      (`transformadores_spark.py`), que se guarda con el `PipelineModel` y
      limpia igual los datos nuevos. Lo que aprende (medianas, bordes,
      categorías) sale solo del entrenamiento.
  - Vista previa en Spark local sobre una muestra
    (`/api/ml/cleaning/preview`): filas afectadas, lo aprendido y ejemplos
    antes y después de cada paso. Un paso que falla queda marcado y los demás
    siguen.
  - Cada paso genera su PySpark (`POST /api/ml/code` con `parte` igual a
    `entrenamiento`, `perfil` o `limpieza`): scripts completos para correr con
    `spark-submit` en YARN. El de la limpieza guarda los datos limpios y el
    paso `Limpiar` en HDFS.
  - Los errores de Spark y de HDFS se muestran en una frase (ruta que no
    existe, formato equivocado, columna o tabla que no está, sintaxis de
    SQL, memoria, modo seguro…) con la línea original abajo.
  - Pantallas: el paso *Datos* lee cualquier formato y perfila con Spark; hay
    un paso nuevo, *Limpieza*; y *Código* muestra también el del perfil y el
    de la limpieza. La demo trae perfiles y una vista previa reales de
    `ventas_sucias` en HDFS.
  - Humo de `full`: datos de ejemplo en HDFS (`ml/preparar_demo_hdfs.py`),
    perfil en YARN de Parquet particionado, CSV con gzip, ORC y Avro, la vista
    previa y un entrenamiento con la limpieza adentro del modelo.
- `spark-avro` en `ml` y `full`, para leer y escribir Avro con Spark.
- XGBoost (`xgboost-cpu`, 18 MB, amd64 y arm64) en las imágenes `ml` y `full`.

### Corregido

- Código de Spark del estudio: el recorte de extremos usaba
  `least`/`greatest`, que se saltean los nulos, así que un nulo terminaba en
  el borde de abajo antes de imputarse. Ahora es un `CASE` y el nulo sigue
  nulo hasta el `Imputer`.
- `spark-libs.jar` (lo que los trabajos de YARN bajan de HDFS) se vuelve a
  armar si cambian los jars de Spark de la imagen. Antes, en un volumen viejo,
  quedaba el de la primera vez.

### Seguridad

- La API de `full` solo atiende a la propia interfaz, con el mismo criterio
  que la terminal: Host `localhost`, `127.0.0.1` o `[::1]` (más
  `SANDBOX_HOSTS`/`TERMINAL_HOSTS`); POST, PUT, PATCH y DELETE con Origin o
  Referer de otra página reciben 403 `forbidden`, y los cuerpos tienen que ir
  como `application/json` (415). Antes cualquier página abierta en el mismo
  navegador podía, por ejemplo, mandar `POST /api/cluster/reset`. curl y los
  scripts, que no mandan Origin, siguen andando.

## [1.3.0] - 2026-10-27

Documentación completa para cada versión, las Prácticas de `full` te hacen
pensar el comando antes de correrlo, y sale `empresa` en beta.

### Agregado

- **Documentación por versión** en `guias/base`, `guias/ml`, `guias/full` y
  `guias/empresa`: paso a paso, referencia (qué hace cada cosa, dónde se usa y
  cómo), teoría y evaluación (opción múltiple con el porqué de cada respuesta,
  preguntas de desarrollo con respuesta modelo y ejercicios sobre la imagen
  con solución y rúbrica). El [índice de guías](guias/README.md) dice qué
  versión usar. Las guías 03 a 10 terminan con un *Para profundizar*.
- **`empresa` en beta** (tag `empresa`, amd64 y arm64): varias compus arman un
  solo cluster, con la del profe como maestro y cada PC como DataNode y
  NodeManager, racks por fila y una copia de cada bloque en el maestro. Hoy
  anda el aula simulada en una sola compu (`empresa/aula-simulada.yml`); la
  red entre PCs reales viene después, con lo que mida la sonda del
  laboratorio. Guía para probarla en clase:
  [`guias/empresa/03-laboratorio.md`](guias/empresa/03-laboratorio.md).

- **Pregunta antes de ejecutar** en cada paso que corre un comando (guías 03 a
  10): tres o cuatro opciones, y al elegir te dice por qué esa sí o por qué no
  y cuál era. *Ejecutar* se habilita después de responder; la barra lateral
  cuenta cuántas acertaste al primer intento y, si ya hiciste la práctica,
  podés ver la respuesta directo.
- **Dónde queda**: después de cada paso, qué hay en el contenedor, en HDFS, en
  la base y en tu compu, y cómo llegar a mirarlo en la interfaz.
- **Salida de la terminal**: lo que imprimiría el comando, tal cual, con el
  código de salida y lo que va a stderr marcado aparte.
- **Qué hiciste**: al terminar una práctica, cada paso con su comando y dónde
  quedó el resultado.
- **Volver al paso**: si saltás a otra pantalla desde un paso ("Ver en HDFS",
  "Ver el trabajo"), arriba queda un botón que te devuelve al mismo paso.
- **Antes de empezar**: cada práctica lista lo que necesita andando (y en qué
  paso), con el motivo y el botón que lo arregla, y las prácticas previas.

### Cambiado

- La interfaz es **oscura siempre**: no sigue al tema de Windows/macOS ni
  tiene interruptor.
- El comando que muestra cada paso es el que corre de verdad (el DataNode o
  NameNode que se apaga, el `setrep -w`, la carpeta exacta).
- *Bajarlo a tu compu* dice la verdad: el botón descarga por el navegador
  (WebHDFS); `hdfs dfs -get` baja al contenedor, y se explica la diferencia.
- La verificación automática espera espaciado (de 3 s a 10 s) y sin apilar
  pedidos, en vez de un fsck por segundo que llenaba la Consola.
- La versión `full` también monta tu carpeta `datos/` en `/datos` en el
  `docker run` del README.

### Arreglado

- **Salud** de HDFS ya no se contradice: si hay bloques sub-replicados que no
  tienen adónde copiarse (piden más copias que DataNodes vivos), el resumen y
  la cola lo dicen igual, en vez de "re-replicando" con la cola vacía.
- En la demo, al volver un DataNode se podían borrar copias de más dos veces y
  quedaban bloques sub-replicados para siempre.

## [1.2.0] - 2026-10-23

Cada modelo de Machine Learning por dentro: el modelo entrenado dibujado en 3D
con lo que de verdad aprendió y la cuenta de una fila hecha en el navegador,
igual a la del servidor. Además, el humo de `full` entrena todos los modelos
en los dos motores y prueba las prácticas de Spark desde la interfaz.

### Cambiado

- El archivo del aula (release `imagen`) carga un solo nombre,
  `franki678/bigdata-sandbox:base`, y las guías, el README y el
  `docker-compose.yml` usan ese mismo con el tag escrito, para que todo ande
  sin internet después del `docker load`.

### Agregado

- **Por dentro de cada modelo** en la pantalla de Machine Learning: el modelo
  entrenado dibujado en 3D con lo que de verdad aprendió, y la cuenta de una
  fila hecha delante tuyo, con reproducir, pausa, paso a paso, velocidad y
  cámara que se gira. La red neuronal (scikit-learn y MLlib) muestra capas,
  conexiones según su peso, el dato pasando capa por capa, las neuronas que se
  activan y las probabilidades de salida, y época por época con la curva de
  pérdida; el árbol, el camino de la fila hasta la hoja; KMeans, los puntos en
  3D y los centros moviéndose por iteración; la regresión lineal y la
  logística, su superficie con los residuos. Sin WebGL dice por qué y deja la
  cuenta en texto; con «reducir movimiento», paso a paso.
- `GET /api/ml/models/{id}/viz`: lo de adentro de cada modelo (pesos, nodos,
  centros, coeficientes) y una muestra con lo que predijo, para los últimos 30.
- La red neuronal también se ofrece con Spark MLlib en la recomendación.
- El humo rehace la cuenta de cada modelo con lo que devuelve `/viz` y la
  compara con lo que predijo el servidor (1e-6), y en la interfaz revisa que
  el dibujo 3D se vea y que la cuenta del navegador dé lo mismo.
- El humo de `full` entrena desde la API todos los modelos de ML en los dos
  motores (regresión, árbol, logística, red, tonto y KMeans) y revisa que la
  métrica quede en un rango razonable y que la regresión aprenda la regla real.
- Desde la interfaz: el pipeline entero desde el riel (con PySpark, Spark SQL,
  Spark MLlib y Sqoop), la práctica de Spark, y regresión, árbol con MLlib y
  KMeans desde la pantalla de ML.

### Arreglado

- La práctica de Spark ya no dice «No existe el trabajo» al lanzar SparkPi o las
  ventas: el servidor devuelve el id recién cuando el ResourceManager conoce la
  aplicación (spark-submit lo imprime antes de que YARN la acepte).
- El paso «Mirar el DAG» de la práctica de Spark espera a que Spark History
  cargue el trabajo recién terminado en vez de mostrar 0 etapas.

## [1.1.0] - 2026-10-23

La interfaz de `full`, rediseñada: tema claro, una pantalla de inicio que dice
qué se puede hacer y qué no, y prácticas guiadas contra el cluster.

### Agregado

- **Inicio**: el estado del cluster y "Qué podés hacer ahora", con cada
  capacidad lista o con el motivo por el que no está y cómo arreglarlo
  (activar MongoDB, borrar el volumen para alta disponibilidad...), y la guía
  que la explica.
- **Prácticas** guiadas paso a paso, una por guía de la 03 a la 10 (HDFS,
  MapReduce, Pig, Hive, MariaDB y Sqoop, Spark, alta disponibilidad,
  MongoDB), que se hacen desde la interfaz y chequean cada paso contra el
  cluster.
- **HDFS**: árbol de carpetas, ver, bajar y mover archivos, réplica por fila
  y, si la carpeta está vacía, dónde están los archivos.
- **Trabajos**: plantillas con parámetros (wordcount, pi, grep, ventas con
  MapReduce, Hive sobre Tez y Spark), detalle con avance, contenedores y logs
  en vivo, y el comando equivalente.
- **Consultas** sobre Hive, MariaDB, MongoDB y Pig: catálogo, ejemplos,
  guardadas, historial, plan y exportar a CSV; "Crear tabla ventas desde
  HDFS" cuando Hive no tiene tablas.
- En Cluster, MongoDB y JupyterLab no incluidos se pueden elegir y activar
  desde el detalle.
- Server: ver, bajar y mover en HDFS, plantillas de trabajos con parámetros y
  Pig desde la API.

### Cambiado

- Tema claro con tipografía IBM Plex; el color queda para estados y
  motores, y el acento solo para lo que se toca o se elige.
- Cada pantalla, con el cluster apagado o arrancando, dice qué vas a poder
  hacer y cuánto falta; cada botón deshabilitado dice por qué y cómo
  habilitarlo.
- Cabeceras de una línea con estado y ayuda, tablas y vacíos con el mismo
  componente, skeletons mientras carga una pantalla.
- Pipeline y Machine Learning con los componentes nuevos; ML recomienda qué
  modelo conviene y lo compara con la regla real.
- Las capturas del README son de la interfaz nueva (demo).

### Arreglado

- El estilo de una pantalla ya no pisa el de otra (ML heredaba tarjetas de
  HDFS y YARN); un test lo controla.
- Con un DataNode caído, HDFS ya no dice "sano" mientras la barra dice
  "Degradado".
- Textos encimados en el sinóptico y en Configuración a 1100 px.
- Humo de `full` más estable en arm64: el `-put` grande ya no falla por los
  reintentos normales del cliente y el wordcount espera a los DataNodes y al
  log del cliente.

## [1.0.0] - 2026-10-22

Primera versión estable: tres versiones de la imagen, todas probadas en
GitHub Actions en Intel/AMD y ARM antes de publicarse.

### Agregado

- **Versiones de la imagen**, cada una un `--target` del `Dockerfile`:
  - `base` (y `latest`, la misma imagen): Ubuntu 24.04 con Hadoop 3.3.6
    (HDFS, YARN, MapReduce), Hive 4.0 sobre Tez, Spark 3.5, Pig, Sqoop con
    MySQL (MariaDB 10.11), ZooKeeper y MongoDB 8.0 (`MONGODB=si`).
  - `ml`: `base` + pandas, numpy, scikit-learn, matplotlib, pymongo y
    JupyterLab.
  - `full`: `ml` + una interfaz web en el puerto 8080 para configurar,
    prender y mirar el cluster desde el navegador: arquitectura en vivo,
    HDFS (explorador, bloques, re-replicación, fsck), YARN (contenedores,
    colas, DAG de Tez y Spark, logs), un pipeline de seis etapas, consultas a
    Hive, MySQL y MongoDB, y entrenamiento de modelos con scikit-learn o
    Spark MLlib. Con `AUTOSTART=1` el cluster arranca solo.
- El servidor de `full` (`server/`), con su API documentada en
  `server/README.md` y tests con pytest (`server.yml`).
- Arquitectura de HDFS elegible al crear el contenedor: 1 a 9 DataNodes,
  réplicas, tamaño de bloque y alta disponibilidad del NameNode
  (`NAMENODES=2` o `3`, con ZooKeeper, JournalNodes y ZKFC).
- Guías nuevas, de la instalación de Docker a MongoDB (`guias/01` a `11`),
  con todos sus comandos probados contra la imagen en cada cambio
  (`pruebas/tutoriales.py`).
- Mapa interactivo de la arquitectura en GitHub Pages (`docs/index.html`) y
  [demo de la interfaz](https://franki-678.github.io/bigdata-sandbox/demo/)
  con un cluster simulado en el navegador (`docs/demo/`).
- Archivo de la imagen para repartir en el aula sin internet (release
  `imagen`, workflow `aula.yml`).
- Humo de `full` en el CI contra el contenedor real: la API chequeo por
  chequeo y la interfaz en Chromium con Playwright, con capturas de cada
  pantalla.
- `docker-compose.yml` con todos los parámetros del cluster.
- `README.en.md`, la traducción al inglés del README, y licencia Apache 2.0.

### Cambiado

- `latest` pasa a ser `base` (Ubuntu 24.04, Python 3.12, con MongoDB).
- CI más rápido: cada arquitectura se arma en su máquina nativa (sin
  emular), con cache de capas en ghcr.io compartida entre ramas; un commit
  que ya pasó en verde en otra rama se publica sin volver a armarlo; un
  cambio solo de documentación no rearma la imagen y corre las guías contra
  la publicada.
- Se publica solo desde `main` y solo con todos los escenarios en verde
  (reinicios, alta disponibilidad, caídas, cortes de luz, volúmenes de la
  imagen anterior), en amd64 y arm64; se verifica que lo publicado sea lo que
  se probó.
- Apagado en orden con `docker stop`: primero Hive y Spark, con HDFS todavía
  arriba.

### Eliminado

- La imagen anterior sobre Ubuntu 20.04 (tag `ubuntu20`) y su respaldo en el
  release del aula. Un volumen de esa imagen se sigue abriendo con `base`
  (guía 11).

### Arreglado

- Con el cluster apagado, la interfaz de `full` ya no pide
  `/api/yarn/apps` cada 2 segundos (la consola del navegador se llenaba de
  409 y el estado quedaba en "Sin conexión con el cluster"). El humo de la
  interfaz lo prueba y después vuelve a iniciar el cluster con el botón
  "Iniciar cluster".
- MySQL de un volumen de la imagen anterior: se pone al día con
  `mariadb-upgrade` y, si se apagó de golpe, el arranque explica cómo
  arreglarlo.
- `Cluster LISTO` recién cuando todos los DataNodes se anotaron.
- Primeros arranques cortados a la mitad: el siguiente arranque los
  recupera.

[Sin publicar]: https://github.com/Franki-678/bigdata-sandbox/compare/v1.3.0...main
[1.3.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.3.0
[1.2.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.2.0
[1.1.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.1.0
[1.0.0]: https://github.com/Franki-678/bigdata-sandbox/releases/tag/v1.0.0
