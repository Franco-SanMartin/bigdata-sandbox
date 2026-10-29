# Decisiones

Las decisiones del proyecto: qué se decidió, por qué y qué cambia. Las nuevas van
arriba. Una decisión que reemplaza a otra lo dice ("Reemplaza a D-NN") y la vieja
queda tachada. Lo que pasó día a día está en [EVENTOS.md](EVENTOS.md) y el plan, en
la [hoja de ruta](HOJA-DE-RUTA.md).

---

## D-07 · El hub maneja git y el CI de noche, con poco desarrollo (2026-10-29)

**Decisión:** mientras Franki duerme o no está con la compu, el *hub* (la sesión de
Claude que corre aparte) controla el repo:
- vigila el CI;
- mergea solo lo que está todo en verde;
- arregla lo mínimo para que las pruebas pasen;
- piensa y escribe el rediseño de D-05.

**No** desarrolla features grandes sin el OK de Franki.

**Por qué:** las pruebas de `full` y `empresa` tardan entre 1h40m y 2 h por vuelta, y
la PC de Franki no queda prendida. Que el desarrollo avance de a poco y revisado
gasta menos y rompe menos.

**Qué cambia:** las instrucciones concretas para el hub están en la hoja de ruta,
sección "Para el hub".

---

## D-06 · Todas las interfaces en tema claro (2026-10-29)

**Decisión:** las interfaces propias del proyecto pasan a **tema claro**:
- la interfaz de `full` (`ui/`), con el estudio de ML;
- la demo de GitHub Pages (`docs/demo`);
- el mapa interactivo (`docs/index.html`);
- la vista Aula de `empresa`.

Sigue siendo monocromo y con aspecto de sistema real: fondo blanco o gris muy claro,
texto casi negro y grises para la jerarquía. El color queda solo para los estados
(verde, ámbar y rojo de las lámparas y los errores).

**Reemplaza a** ~~"oscuro siempre, sin selector"~~ (la regla de
`ui/src/styles/tema.test.ts`). Resuelve el pendiente de la hoja de ruta: "¿oscuro
por defecto con selector de claro?".

**Por qué:** lo pidió Franki. Además, en el aula se proyecta: el claro se lee mejor
en un proyector y en una captura del portafolio.

**Qué cambia:**
- una paleta nueva en `ui/src/styles/`;
- el test del tema pasa a exigir claro;
- los gráficos (Three.js, curvas de ML y bloques de HDFS) con colores que contrasten
  sobre blanco;
- `npm run build:demo` para que la demo quede igual.

No hace falta selector de oscuro.

---

## D-05 · Rediseño 360 de `full`: almacenamiento, recursos y procesamiento (2026-10-29)

**Decisión:** reorganizar `full` (la interfaz, las guías y las prácticas) alrededor
de **qué hace cada herramienta**, separando **almacenamiento** de **procesamiento**,
como lo enseña el profe. Además, explicar en todos lados que **la misma tarea se
puede hacer con varias herramientas** y en qué se diferencian.

**Por qué:** hoy está todo muy junto. Las pantallas mezclan HDFS, Hive, Pig, Spark
y YARN, y no queda claro qué es cada cosa ni cuándo usar cuál. `full` ya es muy
completo: lo que falta es el orden.

**El modelo** (es la base del rediseño; las guías y la interfaz lo tienen que
contar igual):

### 1. Almacenamiento: dónde viven los datos

| Pieza | Qué es | Guarda datos | Ejemplo en el sandbox |
|---|---|---|---|
| **HDFS** | El sistema de archivos distribuido: parte cada archivo en bloques y los replica en varias máquinas | Sí | `hdfs dfs -ls /`, NameNode en `:9870` |
| **Formatos de archivo** | Cómo se escriben los datos adentro de HDFS: texto (CSV, JSON) o columnar (Parquet, ORC), o Avro | Son la forma de los datos | Un CSV pesa más y se lee entero; Parquet se lee solo por las columnas que hacen falta |
| **Data lake** | No es una herramienta: es HDFS + formatos + una organización por zonas (crudo → limpio → listo para usar) | Sí, es HDFS | `/datos/crudo`, `/datos/limpio`, `/datos/curado` |
| **Hive Metastore** (catálogo) | La lista de **tablas**: nombre, columnas, tipos y en qué carpeta de HDFS están. **No guarda los datos**, guarda la descripción | No, solo metadatos | Lo usan Hive, Spark SQL y Pig (con HCatalog). Por eso una tabla creada en Hive se lee desde Spark |
| **MariaDB** | Base relacional (filas, transacciones), fuera del lake | Sí | La "base de la empresa" que se importa con Sqoop |
| **MongoDB** | Base de documentos (NoSQL, JSON), fuera del lake | Sí | Datos semiestructurados, logs y eventos |

> **Ojo:** **Spark no es almacenamiento.** No guarda nada: lee y escribe en HDFS
> (o en MariaDB y MongoDB). Lo mismo Hive como motor: lo que "guarda" una tabla de
> Hive son archivos en HDFS más su descripción en el Metastore.

### 2. Recursos: quién corre dónde

| Pieza | Qué es |
|---|---|
| **YARN** | El administrador del cluster. El ResourceManager reparte memoria y CPU, y cada máquina presta lo suyo con su NodeManager. No guarda ni procesa: decide **dónde** corre cada pedazo de trabajo (contenedor), mejor si es en la máquina que tiene el bloque (localidad). Lo usan MapReduce, Tez y Spark. |

### 3. Procesamiento: cómo se transforman los datos

Hay **dos niveles** que hoy se confunden:

**3a. Motores de ejecución** (cómo corre el trabajo en el cluster):

| Motor | Cómo trabaja | Cuándo brilla |
|---|---|---|
| **MapReduce** | Dos fases fijas, *map* y *reduce*, con un *shuffle* en el medio. Entre trabajos escribe todo a disco (HDFS) | Lotes enormes y simples; es el modelo original y el que se enseña primero |
| **Tez** | Un grafo (DAG) de pasos sin pasar por HDFS entre pasos | Hive: la misma consulta, más rápida que con MapReduce |
| **Spark** | Un grafo de pasos **en memoria** (cuando entra) | Lo iterativo (ML, grafos) y lo interactivo; suele ser el más rápido |

**3b. Herramientas y lenguajes** (cómo se escribe el trabajo):

| Herramienta | Se escribe en | Corre sobre (en este sandbox) | Pensada para |
|---|---|---|---|
| **MapReduce a mano** | Java, o Python con Hadoop Streaming | MapReduce | Entender el modelo map → shuffle → reduce |
| **Hive** | SQL (HiveQL), con `beeline` | **Tez** (también podría MapReduce) | Consultas SQL sobre tablas del data lake |
| **Pig** | Pig Latin (pasos de un flujo de datos), con `grunt` | **MapReduce** (también podría Tez, `-x tez`) | ETL: limpiar, unir y transformar en pasos |
| **Spark SQL / DataFrames / PySpark** | SQL, Python o Scala | Spark | ETL, SQL interactivo y la base del ML |
| **Spark MLlib** | Python (PySpark) | Spark | ML distribuido sobre los datos de HDFS |
| **scikit-learn** | Python | Una sola máquina, sin YARN | ML sobre una muestra que entra en memoria |

**La idea clave para el rediseño:** *casi todo parte de MapReduce.* Hive y Pig
nacieron traduciendo SQL y Pig Latin a trabajos de MapReduce. Hoy pueden usar
motores más rápidos (Tez o Spark), pero la idea de fondo sigue siendo la misma:
repartir (*map*), agrupar por clave (*shuffle*) y combinar (*reduce*). Una etapa de
Spark también es un *map* o un *shuffle*. **Hive y Pig son lenguajes; MapReduce,
Tez y Spark son motores.**

### 4. Ingesta: cómo entran y salen los datos del lake

| Herramienta | De dónde a dónde |
|---|---|
| `hdfs dfs -put` / la interfaz | Archivos de la compu → HDFS |
| **Sqoop** | MariaDB ↔ HDFS o Hive (tablas enteras o consultas) |
| Spark (JDBC o conector de Mongo) | MariaDB o MongoDB ↔ HDFS, como parte de un programa |
| `mongoimport` / `mongoexport` | JSON ↔ MongoDB |

### 5. La misma tarea, con varias herramientas

| Tarea | MapReduce | Pig | Hive | Spark | Diferencia que hay que mostrar |
|---|---|---|---|---|---|
| Contar o agrupar (por ejemplo, viajes por día) | Streaming con mapper y reducer en Python | `GROUP ... BY` + `COUNT` | `SELECT ... GROUP BY` | `df.groupBy().count()` o SQL | Cuánto código hay que escribir, qué motor corre y el tiempo |
| Unir dos datasets (join) | A mano, un *reduce-side join* (difícil) | `JOIN` | `JOIN` | `df.join()` | Cuántos *shuffles* hay y cuánto viaja por la red |
| Limpiar y transformar (ETL) | Posible pero largo | Pensado para esto | `INSERT ... SELECT` con funciones | DataFrames | Pig y Spark escriben pasos; Hive escribe consultas |
| Consulta ad hoc en SQL | No | No | Sí (Tez) | Sí (Spark SQL) | **Mismo Metastore y misma tabla**: tiempos de Tez contra Spark |
| Traer una tabla de MariaDB | No | No | Con Sqoop `--hive-import` | JDBC | Sqoop es un comando; Spark es código y se puede seguir procesando |
| Entrenar un modelo | No | No | No | MLlib (distribuido) | Contra scikit-learn: distribuido y con todos los datos, o una máquina con una muestra |
| Algo iterativo (ML, grafos) | Muy lento: cada vuelta va a disco | Igual | Igual | En memoria | Por esto existe Spark |

### Cómo se traduce en `full` (lo tiene que proponer el hub y aprobarlo Franki)

1. **Navegación por capas**, no por herramienta suelta:
   - **Almacenamiento:** HDFS, Tablas (el Metastore), Bases (MariaDB y MongoDB) y Formatos;
   - **Recursos:** YARN;
   - **Procesamiento:** Motores (MapReduce, Tez y Spark) y Lenguajes (Hive, Pig, Spark SQL, PySpark y MapReduce a mano);
   - **Ingesta:** subir archivos y Sqoop;
   - **ML**;
   - **Prácticas**.
2. **Cada pantalla dice en qué capa está** y dibuja el camino de los datos: de dónde
   vienen, qué los procesa, con qué motor y dónde quedan.
3. **Una vista "Comparar"**: la misma tarea de la tabla 5, corrida con 2 a 4
   herramientas una al lado de la otra. Muestra el código de cada una, el motor que
   usó, los contenedores de YARN, cuánto fue a disco y el tiempo. Es la pieza más
   didáctica y la que más luce.
4. **Las guías y las prácticas** se reordenan igual: primero almacenamiento (HDFS,
   formatos y data lake), después recursos (YARN), después procesamiento
   (MapReduce → Hive y Pig → Spark) y al final ML.
5. **Un glosario único** con estas tablas, enlazado desde el `?` de cada pantalla.

---

## D-04 · ML: Spark sobre YARN primero, en 5 etapas con un PR cada una (2026-10-27)

**Decisión:** el estudio de ML entrena con Spark MLlib sobre los datos que ya están
en HDFS. scikit-learn queda para "probar en una muestra". Se arma en 5 etapas, un
PR cada una:
- (a) motor y primeras pantallas;
- (b) formatos, perfil y limpieza;
- (c) modelos, búsqueda y evaluación;
- (d) biblioteca, predicción y deriva;
- (e) generador a escala, guías y humo.

**Por qué:** Franki quiere entrenar sobre "billones de datos en HDFS", no sobre un
CSV en una máquina. La especificación completa está en la hoja de ruta.

---

## D-03 · `empresa` en el aula: túnel WireGuard con hub en la PC del profe (2026-10-28)

**Decisión:** opción **A** de la sonda. Cada PC de alumno arranca la imagen chica
`trabajador` (192 MB) y se suma con una conexión **saliente** al hub WireGuard de la
PC del profe (UDP 51820, inscripción en TCP 8099). Las PCs de alumnos no publican
puertos.

**Por qué:** la sonda del 27/10 dio el túnel arriba en 11 de 11 PCs. La red es lenta
(unos 50 Mbit/s) y el reset borra todo cada día, así que la imagen tiene que ser
chica y el arranque, de un paso por Veyon. Al no publicar puertos, no aparece el
cartel del firewall en las PCs de alumnos.

---

## D-02 · Cómo se trabaja en el repo (2026-10-27)

**Decisión:**
- Lo nuevo va en ramas (`ui2-*` dispara las pruebas de `full`) y entra a `main` por PR.
- Un PR se mergea solo con el CI en verde.
- Commits como `Franki <fransanmartin.ies@gmail.com>`, **sin** `Co-Authored-By` ni otra atribución a la IA.
- Los push a `main` que no cambian la imagen llevan `[skip ci]`.
- Nunca force-push ni borrar ramas sin que Franki lo pida.
- Nunca tocar los contenedores ni los volúmenes de uso diario (`bigdata`, `bigdata-full`, `bigdata_hadoop` y `bigdata_full`).

**Por qué:** cada push a `main` republica las imágenes que usa la clase.

---

## D-01 · Una imagen, varias versiones (2026-10-23)

**Decisión:** un solo Dockerfile con etapas y cuatro versiones publicadas:
- `base` (= `latest`), para la clase;
- `ml`, con scikit-learn, MLlib y JupyterLab;
- `full`, con la interfaz web en `:8080`;
- `empresa`, el cluster en varias PCs.

Todas multi-arquitectura (amd64 y arm64).

**Por qué:** la clase necesita algo liviano que no cambie. El portafolio necesita
mostrar todo. Las dos cosas salen del mismo código.
