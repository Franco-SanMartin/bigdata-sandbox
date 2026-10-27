# 3. Prueba en el laboratorio con el profe

`empresa` es la versión del sandbox en la que **todas las PCs del
laboratorio arman un solo cluster de Hadoop**: la PC del profe es el
maestro (NameNode, ResourceManager, Hive, Spark History) y cada PC de alumno
suma un DataNode y un NodeManager.

[← 2. Sumar PCs](02-sumar-pcs.md) · [Índice de `empresa`](README.md)

Esta guía tiene dos pruebas, que se pueden hacer en la misma clase:

| Prueba | Qué responde | Dónde | Cuánto tarda | Está lista |
|---|---|---|---|---|
| **1. Sonda del laboratorio** | ¿Las PCs del aula se pueden ver entre sí? ¿Cómo hay que armar la red del cluster? | PC del profe + 3 a 20 PCs | 20-30 min | Sí (release `sonda-v1`) |
| **2. Aula simulada** | ¿Cómo se ve un cluster de varias PCs? Racks, réplicas, trabajos repartidos, una PC que se cae | Solo la PC del profe | 30-40 min | Sí (tag `empresa` en Docker Hub, beta) |

Lo que **todavía no existe** es el cluster con las PCs de verdad (se arma
después, con lo que diga la sonda) y una pantalla para manejarlo: hoy cada
contenedor elige su papel con la variable `ROL`, sin interfaz. Ver [Lo que
viene](#lo-que-viene).

La PC del profe suele ser Windows: los comandos de la compu de esta guía son
de **PowerShell**, y los de las PCs de alumnos se mandan con **Veyon**, el
programa con el que el profe maneja el laboratorio. Los comandos de Hadoop
son los mismos de la [guía 1](01-aula-simulada.md), que es donde se
explican y se prueban.

---

## Antes de la clase

**Qué llevar en un pendrive** (del release
[`sonda-v1`](https://github.com/Franki-678/bigdata-sandbox/releases/tag/sonda-v1)):

- `bigdata-sandbox-sonda.tar.gz` (8 MB)
- `sonda-profe.cmd`
- `sonda-alumno.cmd`
- [`aula-simulada.yml`](../../empresa/aula-simulada.yml) (para la prueba 2)

**Qué preguntarle al profe (o a sistemas) antes**: las respuestas valen
tanto como la sonda.

1. ¿La PC del profe tiene permisos de administrador o puede pedir que le
   abran el firewall de entrada (UDP 51820-51821 y TCP 8099)?
2. ¿Cuánta RAM tiene la PC del profe y cuánta le da a Docker Desktop? La
   prueba 2 necesita **unos 8 GB libres** para Docker (una PC de 16 GB).
3. ¿Las PCs se resetean todos los días? ¿Se borran también las imágenes de
   Docker?
4. ¿Hay internet en la PC del profe? La prueba 2 baja la imagen de Docker
   Hub una sola vez (~1,6 GB). Si no hay, llevarla en el pendrive (ver [Sin
   internet en la PC del profe](#sin-internet-en-la-pc-del-profe)).

---

## Prueba 1: sonda del laboratorio

**Qué**: un programa chico que se corre a la vez en la PC del profe y en
las de los alumnos, y mide si se pueden ver entre ellas.

**Por qué**: Hadoop necesita que cada nodo pueda abrir conexiones hacia los
otros (el cliente hacia cada DataNode, un DataNode hacia otro para copiar
bloques, el ApplicationMaster hacia cada NodeManager). En un laboratorio con
Windows, Docker Desktop y un firewall que los alumnos no controlan, eso no
está garantizado. La sonda dice cuál de las dos formas de armar la red anda
en **este** laboratorio (ver [teoría: redes](teoria/06-redes.md)).

El paso a paso completo está en el [LEEME de la sonda](../../sonda/LEEME.md).
Lo corto:

1. **PC del profe**: copiar `bigdata-sandbox-sonda.tar.gz` y
   `sonda-profe.cmd` a la misma carpeta, abrir Docker Desktop y hacer doble
   clic en `sonda-profe.cmd`. Muestra su IP en la red del aula, la línea
   para Veyon y `Profe listo`. Si aparece el cartel del **Firewall de
   Windows**, anotar si dejó aceptar o pidió contraseña de administrador: es
   un dato.
2. **Veyon → Transferencia de archivos** a las PCs:
   `bigdata-sandbox-sonda.tar.gz` y `sonda-alumno.cmd`.
3. **Veyon → Ejecutar programa** con la línea que mostró el profe (abajo,
   un ejemplo con la IP `192.168.0.10`).
4. Esperar 1 a 5 minutos. En la ventana del profe van entrando las PCs y
   aparece `-> VEREDICTO por ahora: ...`. También en el navegador del
   profe: <http://localhost:8099/cgi-bin/resumen>.
5. **Copiar `C:\Users\<usuario del profe>\sonda-profe` al pendrive antes de
   apagar.** Ahí están `resumen.txt` y `planilla.csv`, que es lo que hace
   falta para seguir.
6. **Al día siguiente**, sin volver a pasar el `.tar.gz`, correr la sonda en
   modo `dia2` (ver el LEEME): dice si el reset borra las imágenes de
   Docker.

La línea del paso 3 (la de verdad la muestra `sonda-profe.cmd`, con la IP
del profe):

<!-- prueba: no (se pega en Veyon, Ejecutar programa) -->
```bat
cmd /c ""%USERPROFILE%\sonda-alumno.cmd" 192.168.0.10"
```

Qué significa el veredicto (la sonda cuenta solo las PCs que llegaron a
mandar resultado):

| Veredicto | Qué quiere decir | Cómo sigue el cluster |
|---|---|---|
| **A** | En el 80% o más de las PCs se pudo abrir un túnel hacia el profe | Túnel WireGuard: no hay que tocar el firewall de las PCs de alumnos |
| **B** | El túnel no llegó al 80%, pero el profe pudo entrar a 80% o más de las PCs | Red directa: hay que abrir puertos en todas las PCs |
| **SIMULADO** | Ninguna de las dos llegó al 80% | Cada PC corre su cluster simulado sola (como la prueba 2) |
| **SIN DATOS** | No llegó nada al profe | Casi seguro el firewall de la PC del profe, o la IP no era la del aula |

Qué mide la sonda en detalle y cómo decide: [referencia, la
sonda](referencia.md#la-sonda-del-laboratorio).

---

## Prueba 2: aula simulada en la PC del profe

Un maestro y dos "PCs" (cada una es un contenedor) en la misma compu. Es el
mismo cluster que se armaría con el laboratorio, en chico. Es la [guía
1](01-aula-simulada.md) resumida para hacerla con el profe desde
PowerShell: la explicación de cada paso, y qué tendría que salir, están ahí.

### Arrancarla

Abrir una **PowerShell** en una carpeta (por ejemplo el Escritorio) y bajar
el archivo (o copiarlo del pendrive):

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
curl.exe -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
```

Arrancar (la primera vez baja la imagen; si no hay internet, ver [más
abajo](#sin-internet-en-la-pc-del-profe)) y mirar el arranque del maestro:

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker compose -f aula-simulada.yml up -d
docker compose -f aula-simulada.yml logs -f maestro
```

Esperar a que el maestro diga **`Cluster LISTO`** (2 a 4 minutos) y cortar
con Ctrl+C (el cluster sigue andando). Después, ver qué quedó:

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker exec maestro estado
```

Y en el navegador:

- NameNode: <http://localhost:9870> → **Datanodes**: tienen que aparecer
  `maestro`, `pc01` y `pc02`.
- YARN: <http://localhost:8088> → **Nodes**: `pc01` y `pc02` (el maestro no
  corre trabajos: `MAESTRO_NM=no` de fábrica).

### Qué mirar con el profe

Todo se corre "sentado en una PC del aula":

<!-- prueba: no (PowerShell en la PC del profe; abre una consola en pc01) -->
```powershell
docker exec -it pc01 bash
```

Los bloques de esta sección van en esa consola. No se prueban acá porque el
cluster lo arranca la PowerShell de arriba; son los mismos comandos de la
guía 1, que sí se prueban.

**a) Racks por fila.** Hadoop sabe en qué fila está cada PC, para no
guardar todas las copias de un archivo en la misma fila:

<!-- prueba: no (consola de pc01 abierta desde PowerShell; se prueba en la guía 1) -->
```bash
hdfs dfsadmin -printTopology
```

El maestro está en `/profe` y las PCs en `/fila1`, `/fila2`... (de a 2 PCs
por fila en este archivo: `PCS_POR_FILA: "2"`, así que pc01 y pc02 quedan
las dos en `/fila1`).

**b) Dónde quedan los bloques.** Subir un archivo con bloques de 1 MB para
que se corte en varios, y ver en qué nodo quedó cada copia y de qué tipo es:

<!-- prueba: no (consola de pc01 abierta desde PowerShell; se prueba en la guía 1) -->
```bash
yes "hdfs yarn hive spark bloque rack fila profe" | head -c 8M > /tmp/texto.txt
hdfs dfs -mkdir -p /aula
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/texto.txt /aula/texto.txt
hdfs fsck /aula/texto.txt -files -blocks -locations
```

Cada bloque tiene 3 copias (`Live_repl=3`) y **una siempre está en el
maestro**, marcada `ARCHIVE` (las otras dos dicen `DISK`): si se apaga el
aula entera, los datos siguen en la PC del profe. Es la política `WARM` que
el maestro le pone a todo HDFS (ver [teoría: políticas de
almacenamiento](teoria/04-politicas-de-almacenamiento.md)).

Con `-racks` se ve, en lugar del tipo de disco, el rack de cada copia:

<!-- prueba: no (consola de pc01 abierta desde PowerShell; se prueba en la guía 1) -->
```bash
hdfs fsck /aula/texto.txt -files -blocks -racks
```

Cada bloque tiene una copia en `/profe/...` y las otras en `/fila1/...`: nunca
las tres en el mismo rack.

**c) Un trabajo repartido entre las PCs:**

<!-- prueba: no (consola de pc01 abierta desde PowerShell; se prueba en la guía 1) -->
```bash
hdfs dfs -rm -r -f -skipTrash /aula/conteo
yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /aula/texto.txt /aula/conteo
hdfs dfs -cat /aula/conteo/part-r-00000
```

(La primera línea borra el resultado de una corrida anterior: MapReduce no
escribe sobre una carpeta que ya existe.) Mientras corre, en
<http://localhost:8088> se ve el trabajo; al terminar, en
<http://localhost:19888> (JobHistory) → el trabajo → **Map** se ve en qué PC
corrió cada pedazo: en `pc01` y `pc02`, nunca en el maestro.

**d) Hive y Spark desde una PC, contra el maestro:**

<!-- prueba: no (consola de pc01 abierta desde PowerShell; se prueba en la guía 1) -->
```bash
beeline -u jdbc:hive2://maestro:10000 -n root -e "CREATE TABLE IF NOT EXISTS prueba (n INT); INSERT INTO prueba VALUES (1),(2),(3); SELECT COUNT(*) FROM prueba;"
spark-submit --master yarn --class org.apache.spark.examples.SparkPi "$SPARK_HOME"/examples/jars/spark-examples_*.jar 20
```

HiveServer2 y el Metastore corren en el maestro: la tabla queda registrada
ahí, la vea quien la vea. Spark pide sus executors al ResourceManager del
maestro y corren en las PCs.

**e) Una PC que se cae.** Salir de pc01 (`exit`) y, desde la PowerShell:

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker kill pc02
```

A los ~40 segundos el NameNode la marca muerta (<http://localhost:9870> →
Datanodes). Con solo dos PCs no hay otra donde hacer la tercera copia, así
que los bloques quedan **sub-replicados**, pero el archivo se sigue
leyendo:

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker exec pc01 hdfs dfs -cat /aula/texto.txt | Measure-Object -Line
docker exec maestro hdfs fsck /
docker start pc02
```

**Qué tendría que salir**: el `cat` lee el archivo entero. El fsck dice
`Under-replicated blocks` mayor que 0, pero igual termina en `is HEALTHY`:
para fsck "sano" quiere decir que no falta ni está roto ningún bloque, no
que tengan todas sus copias. Cuando pc02 vuelve (unos segundos después de
`docker start`), sus copias cuentan otra vez y `Under-replicated blocks`
vuelve a 0.

Para ver la **re-replicación** (HDFS haciendo solo la copia que falta en
otra PC) hace falta una tercera PC, `pc03` (unos 2 GB más): está en la
[guía 1, sección
8](01-aula-simulada.md#8-con-una-tercera-pc-re-replicación-y-sobre-replicación).
Los detalles de qué pasa cuando un nodo se cae: [teoría:
fallas](teoria/03-fallas.md).

### Apagar y borrar todo

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker compose -f aula-simulada.yml down -v
```

`down -v` borra los contenedores **y** los volúmenes (los bloques de HDFS de
cada nodo). Sin `-v` los datos quedan para la próxima.

### Sin internet en la PC del profe

En una compu con internet:

<!-- prueba: no (PowerShell en otra compu, con internet) -->
```powershell
docker pull franki678/bigdata-sandbox:empresa
docker save franki678/bigdata-sandbox:empresa -o bigdata-sandbox-empresa.tar
```

Llevar el `.tar` en el pendrive y, en la PC del profe:

<!-- prueba: no (PowerShell en la PC del profe) -->
```powershell
docker load -i bigdata-sandbox-empresa.tar
```

---

## Qué anotar al terminar

- El `resumen.txt` y la `planilla.csv` de la sonda (y el de `dia2` del día
  siguiente).
- Las respuestas del profe a las 4 preguntas de [Antes de la
  clase](#antes-de-la-clase).
- En la prueba 2: si arrancó, cuánto tardó en decir `Cluster LISTO` y
  cuánta RAM usaba Docker (Docker Desktop → **Contenedores**).

---

## Lo que viene

Nada de esto existe todavía: es el plan, y depende del veredicto de la
sonda.

- **Etapa 2, la red del aula.** El profe arranca el maestro con un `.cmd` y
  en su pantalla aparecen la **IP** y un **código de la clase**. Por Veyon
  se corre en todas las PCs un `.cmd` de alumno con esa IP y ese código:
  cada PC se suma sola como DataNode y NodeManager, por un túnel WireGuard
  (veredicto A) o por la red directa (veredicto B). Hoy, con `RED` distinto
  de `docker`, el contenedor no arranca.
- Una vista **Aula** en la interfaz muestra el laboratorio como un rack:
  cada PC una lámpara (ámbar mientras se suma, verde cuando ya es parte del
  cluster), y se proyecta con la Demostración de Veyon.
- Al cierre, la interfaz espera a que todo tenga copia en el maestro y
  avisa "ya pueden apagar".
- **Etapas 3 a 6**: Kafka con Spark Streaming (datos en tiempo real),
  métricas de la clase, seguridad (permisos, cuotas por alumno) y un
  almacenamiento tipo S3 local.

[← 2. Sumar PCs](02-sumar-pcs.md) · [Índice de `empresa`](README.md)
