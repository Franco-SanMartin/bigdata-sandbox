# Hoja de ruta

Qué está hecho, qué está en curso y qué sigue en BigData Sandbox. Es el punto de
partida para retomar el trabajo desde cualquier sesión o compu. Última
actualización: 2026-10-29. Las decisiones están en [DECISIONES.md](DECISIONES.md)
y lo que pasó día a día, en [EVENTOS.md](EVENTOS.md).

## Para el hub (desde la noche del 2026-10-29)

Franki apaga su compu. El hub controla git y el CI mientras duerme
([D-07](DECISIONES.md)). **Desarrollo mínimo: solo lo necesario para que las pruebas
pasen.** Antes de empezar, leé [DECISIONES.md](DECISIONES.md) completo y
[EVENTOS.md](EVENTOS.md) del 29/10.

**1. Vigilar el CI (con `gh run list` y `gh pr checks`, un bucle cada 10-15 min, sin
gastar de más):**
- **Workflow Empresa** sobre `main` (lo lanzó Franki el 29/10 a las 04:50): tiene
  que publicar `:empresa` y `:trabajador` y armar el release **`aula-v1`**. Si da
  rojo, buscá la causa en el log y, si es del código, arreglala en una rama
  `empresa-fix-*` con PR. Si es del CI (por ejemplo `short read` o `unexpected
  EOF`), relanzá solo los jobs que fallaron (`gh run rerun --failed`). Franki lo
  necesita para probar en el laboratorio.
- **PR #5** (ML a) y **PR #7** (ML b): ya tienen el arreglo del humo (`92a5053`).
  Si quedan **todo en verde**, mergealos **en orden: #5 y después #7**. Si la
  falla es intermitente (`short read` o el `fsck` del apagado), relanzá. Si es
  real, arreglala en la rama de la (a) y llevala con merge (no rebase) a la (b) y
  a la (c).
- **Workflow Imagen** en `main`: falló dos veces por `short read` (infraestructura).
  Si vuelve a fallar igual, relanzá los jobs fallidos. `latest` es la imagen de la
  clase: no la dejes rota.

**2. Pensar el rediseño 360 de `full` ([D-05](DECISIONES.md)) y el tema claro
([D-06](DECISIONES.md)). Pensar y escribir, no implementar:**
- Escribí `REDISENO-FULL.md` en la raíz. Tiene que traer:
  - la navegación nueva por capas: almacenamiento, recursos, procesamiento, ingesta, ML y prácticas;
  - qué pantalla actual va a cada lugar y qué se junta, separa o borra;
  - la vista "Comparar" (la misma tarea con varias herramientas), con qué tareas, qué métricas y de dónde salen (YARN, historial de Spark y de MapReduce);
  - cómo se reordenan las guías y las prácticas;
  - la paleta clara (tokens), qué tests y gráficos cambian y el orden de trabajo en PRs chicos.
- Abrilo como **PR solo de documentación** (rama `ui2-rediseno-plan`), sin código.
  Franki lo revisa a la mañana y recién ahí se implementa.
- Si encontrás algo del modelo de D-05 que esté mal o falte, corregilo en ese PR.

**3. No hacer esta noche:**
- seguir la etapa (c) de ML (WIP en `ui2-ml-etapa-c`), ni la (d) o la (e);
- cambios grandes de interfaz;
- force-push o borrar ramas;
- tocar `ui2-ml-pro` (queda como respaldo).

**4. Al terminar:** anotá en [EVENTOS.md](EVENTOS.md) qué pasó: qué se mergeó, qué
dio rojo y por qué, qué quedó corriendo. Es un commit con `[skip ci]` a `main`.

Reglas de siempre: commits como `Franki <fransanmartin.ies@gmail.com>`, **sin**
`Co-Authored-By` ni "Generated with". Todo en castellano rioplatense.

## Dónde estamos

| Versión | Estado | Qué es |
|---|---|---|
| `base` (= `latest`) | Publicada | Hadoop, Hive + Tez, Spark, Pig, Sqoop, MariaDB y MongoDB en un contenedor (Ubuntu 24.04) |
| `ml` | Publicada | `base` + pandas, numpy, scikit-learn, Spark MLlib y JupyterLab |
| `full` | Publicada | `ml` + interfaz web en `:8080` (servidor en `server/`, app en `ui/`), con Prácticas guiadas |
| `empresa` | Beta | Varias compus arman un cluster real; la `sonda/` mide la red del aula para decidir cómo |
| `ubuntu20` | Archivada | La imagen vieja de la clase, por si hay que volver |

Documentación por versión en [`guias/`](guias/README.md); cambios en el [CHANGELOG](CHANGELOG.md).

## En curso: ML distribuido sobre HDFS (versiones `ml` y `full`)

Rama `ui2-ml-pro`, con PRs a `main` por etapa (no se mergean sin el OK de Franki).

**La idea:** entrenar modelos sobre los datos que YA están en HDFS, en el formato
que estén, eligiendo cómo limpiar cada columna, guardar cada modelo en una
biblioteca y usarlo con datos nuevos. Spark sobre YARN primero; scikit-learn
queda como "probar en una muestra en una sola máquina".

1. **Datos en HDFS en cualquier formato:** Parquet, ORC, Avro, JSON y JSON lines,
   CSV/TSV, texto, comprimidos (gzip, snappy, bz2), carpetas particionadas
   (`anio=/mes=`) y tablas de Hive. Esquema inferido y editable, filas,
   particiones y tamaño.
2. **Perfil a escala:** nulos, distintos aproximados, mín/máx, cuantiles, top de
   categorías e histogramas, calculados con Spark (muestra o pasada completa).
3. **Receta de limpieza columna por columna**, versionada: tipos, texto, regex,
   fechas, nulos (con columna indicadora), outliers, duplicados, filtros,
   categorías raras, mapeos y columnas derivadas, con vista previa antes/después
   y filas afectadas. Lo que es solo de entrenamiento (duplicados, filtros) se
   separa de lo que se aplica igual a los datos nuevos (va adentro del modelo).
4. **Variables:** codificación, hashing, escaladores, fechas, TF-IDF, selección
   y PCA, como `pyspark.ml.Pipeline`.
5. **Modelos de MLlib** con todos sus parámetros explicados (clasificación,
   regresión, clustering y ALS) y XGBoost distribuido (`xgboost.spark`).
   Búsqueda con CrossValidator/TrainValidationSplit en paralelo y recursos de
   Spark configurables.
6. **Evaluación distribuida y honesta:** train, validación y test separados de
   entrada; métricas y curvas calculadas en el cluster.
7. **Biblioteca de modelos:** versiones, estado (candidato, en producción,
   archivado), linaje completo (datos, receta, variables, parámetros, métricas,
   app de YARN) y el modelo guardado en HDFS. Comparar, promover y volver atrás
   (evaluar MLflow con MariaDB contra un registro propio).
8. **Predicción:** por lotes (datos nuevos de HDFS o Hive → misma limpieza →
   predicciones en HDFS o Hive, con validación de esquema y aviso de deriva), al
   instante (unas filas por formulario o JSON), y exportar el modelo con un
   servicio mínimo para usarlo fuera del sandbox.
9. **Código:** cada etapa genera su PySpark completo, editable y ejecutable con
   spark-submit en YARN.
10. **Generador a escala:** un trabajo de Spark que escribe en HDFS un dataset
    sintético con señal y "suciedad", del tamaño que se elija.
11. **Honestidad:** en un contenedor el límite es el hardware; el pipeline es el
    mismo que en un cluster real y en `empresa` escala a varias PCs.

Etapas (un PR cada una): **(a)** seguridad de la API + motor base, **(b)** datos
en HDFS, formatos, perfil y limpieza, **(c)** modelos, búsqueda y evaluación,
**(d)** biblioteca, predicción y deriva, **(e)** generador a escala, guías y
pruebas de humo.

- [x] **(a) Seguridad de la API + motor base.** *Hecho (PR abierto, sin
      mergear): la API cerrada a la propia interfaz (PR #4), `sandbox_ml`
      (catálogo, receta, código scikit-learn y PySpark, perfil y registro),
      las rutas `/api/ml/*` y las pantallas: fuentes de `/datos`, HDFS y Hive,
      perfil, receta revisada, código generado, experimentos y corridas.*
- [ ] **(b)** Formatos de HDFS (Parquet, ORC, Avro, JSON, comprimidos,
      particiones y Hive) con esquema editable, perfil calculado con Spark a
      escala y la receta de limpieza columna por columna (puntos 1 a 3).
- [ ] **(c)** Modelos, búsqueda y evaluación distribuida (puntos 4 a 6).
- [ ] **(d)** Biblioteca de modelos, predicción y deriva (puntos 7 y 8).
- [ ] **(e)** Generador a escala, guías y pruebas de humo (puntos 10 y 11).

## Pendientes de la revisión (2026-10-26 y 27)

**Prácticas guiadas de `full`:**

- [x] "HDFS: se cae un DataNode": el paso 5 muestra `datanode start 2` aunque se
      apagó y prendió el DataNode 3. El comando visible tiene que salir del nodo
      elegido (el alumno lo copia en la terminal). *Hecho: el número se fija
      cuando aparece "Apagar" (`fija` en el paso) y los pasos siguientes usan el
      DataNode apagado si se perdió lo guardado.*
- [x] "HDFS: subir, mirar y replicar": usar `hdfs dfs -setrep -w 3`; sin `-w`, el
      fsck siguiente marca sub-replicados con 3 DataNodes y la pista confunde.
      *Hecho: `-w` cuando hay DataNodes para todas las copias (o no se sabe), y
      el fsck espera hasta 45 s a que terminen de copiarse.*
- [x] HDFS → Salud: "Sub-replicados: 45" junto a "Cola vacía: todos los bloques
      tienen las copias que piden". Tiene que decir que no hay a dónde copiar.
      *Hecho: la tarjeta y la cola usan el mismo número (el mayor de los dos).*
- [x] La verificación automática corre un `fsck` por segundo (un proceso Java
      cada vez): dejar de verificar cuando el paso dio bien o espaciar.
      *Hecho: con HDFS quieto (nada cambió desde el último fsck) el de fondo pasa
      a uno cada 30 s; si algo cambia vuelve enseguida.*
- [x] "Bajarlo a tu compu": explicar que `hdfs dfs -get` deja el archivo adentro
      del contenedor y que el botón lo baja por el navegador. *Hecho, con
      `hdfs dfs -get … /datos/` para que aparezca en la carpeta `datos/`.*
- [x] Mostrar la salida real del comando (como en la terminal) además de las tablas.
      *Hecho: cada paso de la terminal del contenedor tiene "Correr en la
      terminal": lo escribe en la terminal integrada, muestra lo que imprimió
      con su código de salida ("lo que imprimió en tu terminal") y después
      verifica; sin verificación alcanza con el código 0.*
- [x] Autoevaluación al final de cada práctica (2 o 3 preguntas y un desafío).
      *Hecho: preguntas de concepto con el porqué, y un desafío con pista,
      solución a la vista si hace falta y "Lo resolví" (`lib/practicas/autoeval.ts`).*
- [x] Exportar e importar el avance (hoy solo vive en el navegador).
      *Hecho: un `.json` desde la lista de Prácticas; al importar, de cada
      práctica queda la versión más avanzada (no se pierde nada).*
- [x] Revisar los requisitos de cada práctica antes de empezar (DataNodes, servicios).
      *Hecho: la tarjeta de la lista muestra los servicios que pide (prendidos
      o no) y las prácticas previas; el detalle ya tenía "Antes de empezar".*
- [x] Terminal integrada en la interfaz (recién después de cerrar la API).
      *Hecho: bash de verdad por websocket en `/api/terminal`, por el mismo
      8080 (xterm.js en un panel abajo, Ctrl+`). Solo atiende con Host local y
      Origin de la misma interfaz; `TERMINAL=0` la apaga y `TERMINAL_HOSTS`
      suma nombres. El humo de `full` la prueba contra la imagen.*
- [x] Decidir el tema: hoy sigue al de Windows; se había pedido oscuro siempre.
      *Ya está en `main`: oscuro siempre, sin selector (lo cuida
      `styles/tema.test.ts`). Ver abajo si se quiere el selector.*
- [x] Tema: ¿oscuro por defecto **con selector** de claro? *Decidido el
      2026-10-29 ([D-06](DECISIONES.md)): **todas las interfaces en claro**, sin
      selector. Falta implementarlo, dentro del rediseño de D-05.*
- [ ] Terminal en `empresa`: si el servidor se publica para otras PCs y se
      suma su nombre a `TERMINAL_HOSTS`, cualquiera que llegue tiene root en el
      contenedor. Decidir si en `empresa` va apagada de fábrica (`TERMINAL=0`).
- [x] Rearmar la demo (`docs/demo`) con la autoevaluación y exportar/importar
      (la terminal no anda en la demo: no hay contenedor; el panel lo explica).
      Ojo: el CI (Documentación → `demo`) falla si `docs/demo` no es la
      compilación de `ui/`: cada cambio de `ui/` va con `npm run build:demo`.

**Versión `full`:**

- [x] El `docker run` del README no monta `datos/` (`-v ...:/datos`) ni publica
      JupyterLab (`-p 127.0.0.1:8888:8888`). Lo mismo en el `docker-compose.yml`
      que genera la interfaz. *Hecho: README, README.en y guías de `full` con los
      dos; el compose generado publica 8888 aunque JupyterLab esté apagado (se
      puede prender después desde la interfaz).*
- [ ] El compose que genera la interfaz usa el volumen `bigdata_hadoop` (el de
      `base`), no `bigdata_full` como el `docker run`: decidir si se unifican.
- [x] Seguridad de la API: `TrustedHostMiddleware`, rechazar POST/PUT/PATCH/DELETE
      de otro origen y exigir `application/json`. *Hecho en el PR #4 (rama
      `ui2-seguridad`), que la etapa (a) del ML trae adentro: mismo criterio de
      hosts que la terminal, 403 `forbidden` y 415 si el cuerpo no es JSON.*

**Mantenimiento:**

- [ ] Correr el workflow **aula** para que el `.tar.gz` del Release coincida con `latest`.
- [ ] Borrar las ramas viejas que ya están en `main` (`full`, `ui`, `versiones`).
- [ ] Decidir si Grupo-ManIAco sigue de colaborador; pedir a GitHub Support que
      limpie la lista de contributors (commits viejos 50a18a8, 61db729, 9b4080a, 74f289a).

## Siguiente gran objetivo: `empresa` en el aula

El laboratorio, medido por la sonda el 27/10
([resultados](sonda/resultados/2026-10-27/LEEME.md)): la PC del profe (i3-12100,
16 GB) como central, con Veyon y una carpeta compartida (solo el profe escribe),
y PCs de alumnos con Windows 11 LTSC y Docker Desktop 4.55: 8 de 11 con 8 GB
(Docker con unos 3,8 GB) y 3 con 16 GB (7,8 GB); CPUs de i3-2120 a i3-12100; sin
GPU NVIDIA.

**1. ✅ Medir la red con la sonda.** Veredicto **A**: túnel WireGuard con hub en
la PC del profe, arriba en 11 de 11 PCs (módulo del kernel). Pero la red es
lenta: unos **50 Mbit/s** alumno → profe y 31 alumno → alumno por el hub.

**2. Lo que el aula impone a `empresa` (etapa 2, la red del aula):** hecho en la
rama `empresa-aula` (imagen `trabajador` de 182 MB en `.tar.gz`, `docker load` en
unos 3 s), falta estrenarlo en una clase.

- [x] **El reset borra todo cada día** (imágenes, carpetas y HDFS): cada clase
      arranca de cero. La imagen `empresa` pesa 1,59 GB comprimida porque sale de
      `full`; cargarla en 20 PCs por esta red tardaría más de una hora. Hace falta
      una **imagen de trabajador chica** (solo Java, DataNode y NodeManager, y el
      Python mínimo para los executors de PySpark; Spark y Tez llegan desde HDFS)
      que se cargue en segundos desde la carpeta compartida, y un arranque de un
      solo paso por Veyon.
- [x] **`RED=wireguard`** en `empresa/arranque.sh`: el maestro levanta el hub
      (como la sonda) y cada trabajador se suma con una conexión **saliente**, y
      anuncia su IP del túnel (10.13.0.x) a HDFS y YARN. Los trabajadores **no
      publican puertos**, así no aparece el cartel del firewall en cada PC.
- [x] **Recursos según la PC**: detectar la RAM de Docker y ajustar
      `TRABAJADOR_RAM` sola (unos 2 GB en las de 8 GB, unos 5 GB en las de 16 GB).
- [x] **`.cmd` para Veyon** (profe y alumnos), con la IP y un código de la clase,
      como planeaba la guía 3. La línea para Veyon tiene que apuntar a donde Veyon
      deja los archivos (si se transfieren desde el Escritorio, quedan en el
      Escritorio).
- [x] **Datos a la medida de la red**: datasets de pocos GB (HIGGS sí; NYC Taxi,
      algunos meses), réplica 2, y que el profe los suba una sola vez desde su PC.
- [x] **La sonda sin la prueba B**: un modo que no abra el 8098 (con A ganadora,
      no hace falta y es lo que dispara el cartel).
- [ ] Avisar a sistemas: red vista como "Pública" en todas las PCs y direcciones
      192.169.0.x, que no son un rango privado.

**3. La clase demo, paso a paso:**

1. **Carga:** desde la central del profe, subir un dataset grande a HDFS y ver
   cómo los bloques y sus réplicas quedan repartidos entre las 20 PCs.
2. **Consultas:** el mismo análisis con Hive (Tez), Spark SQL y Pig, para ver
   cuándo conviene cada uno y cuánto tarda.
3. **Caída de una PC "desde la fuente":** apagar una PC de verdad y ver al
   NameNode darla por muerta, la re-replicación de sus bloques y a YARN
   reintentar sus tareas en otras PCs.
4. **Recursos:** ver en el ResourceManager cuánta memoria y CPU aporta cada
   NodeManager (una por PC) y cómo YARN reparte los contenedores de varios
   trabajos a la vez (colas por grupo de alumnos).
5. **ML distribuido:** entrenar un modelo sobre el dataset con el estudio de ML,
   guardarlo en la biblioteca y predecir con datos nuevos.
6. **Medir la escala:** el mismo trabajo con 1, 5, 10 y 20 PCs (tiempo y
   aceleración). Es el número que más luce en el portfolio.

**Datasets candidatos** (verificar tamaño y licencia antes de usarlos):

- **HIGGS** (UCI): unos 11 millones de filas, 28 columnas, clasificación
  binaria; ideal para ML distribuido.
- **NYC Taxi (TLC Trip Records):** Parquet mensual, cientos de millones de
  viajes por año; regresión (tarifa, propina, duración) y mucha escala.
- **Criteo (Kaggle Display Advertising):** unos 45 millones de filas;
  predicción de clics con muchas categóricas (hashing).

## Reglas para trabajar en el repo

- Commits firmados como `Franki <fransanmartin.ies@gmail.com>`, **sin** líneas
  `Co-Authored-By`.
- Un push a `main` que no sea solo `.md` republica las imágenes: si el cambio no
  es de la imagen, `[skip ci]` en el mensaje. Lo nuevo va en ramas (`ui2-*`
  dispara las pruebas de `full`) y entra por PR.
- Para probar con Docker, nunca tocar los contenedores ni volúmenes de uso
  diario (`bigdata`, `bigdata-full`, `bigdata_hadoop`, `bigdata_full`).
- Si Docker Desktop no arranca con "initializing Secrets Engine ... engine.sock":
  cerrarlo, renombrar `%LOCALAPPDATA%\docker-secrets-engine` y abrirlo de nuevo.
  Nunca "Reset to factory defaults".
- Todo en castellano rioplatense, como el resto del repo.
