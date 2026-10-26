# Guía para probar `empresa` en el aula con el profe

`empresa` es la versión del sandbox en la que **todas las PCs del laboratorio arman un solo cluster de
Hadoop**: la PC del profe es el maestro (NameNode, ResourceManager, Hive, Spark History) y cada PC de
alumno suma un DataNode y un NodeManager.

Esta guía tiene dos pruebas, que se pueden hacer en la misma clase:

| Prueba | Qué responde | Dónde | Cuánto tarda | Está lista |
|---|---|---|---|---|
| **1. Sonda del laboratorio** | ¿Las PCs del aula se pueden ver entre sí? ¿Cómo hay que armar la red del cluster? | PC del profe + 3 a 20 PCs | 20-30 min | Sí (release `sonda-v1`) |
| **2. Aula simulada** | ¿Cómo se ve un cluster de varias PCs? Racks, réplicas, trabajos repartidos, una PC que se cae | Solo la PC del profe | 30-40 min | Cuando se publique el tag `empresa` en Docker Hub |

Lo que **todavía no existe** es el cluster con las PCs de verdad (se arma después, con lo que diga la
sonda) y una pantalla para manejarlo: hoy cada contenedor elige su papel con la variable `ROL`, sin
interfaz. Ver [Lo que viene](#lo-que-viene).

---

## Antes de la clase

**Qué llevar en un pendrive** (del release
[`sonda-v1`](https://github.com/Franki-678/bigdata-sandbox/releases/tag/sonda-v1)):

- `bigdata-sandbox-sonda.tar.gz` (8 MB)
- `sonda-profe.cmd`
- `sonda-alumno.cmd`
- [`aula-simulada.yml`](aula-simulada.yml) (para la prueba 2)

**Qué preguntarle al profe (o a sistemas) antes** — las respuestas valen tanto como la sonda:

1. ¿La PC del profe tiene permisos de administrador o puede pedir que le abran el firewall de entrada
   (UDP 51820-51821 y TCP 8099)?
2. ¿Cuánta RAM tiene la PC del profe y cuánta le da a Docker Desktop? La prueba 2 necesita **unos 8 GB
   libres** para Docker (una PC de 16 GB).
3. ¿Las PCs se resetean todos los días? ¿Se borran también las imágenes de Docker?
4. ¿Hay internet en la PC del profe? La prueba 2 baja la imagen de Docker Hub una sola vez (~1,6 GB). Si
   no hay, llevarla en el pendrive (ver la prueba 2).

---

## Prueba 1 — Sonda del laboratorio

El paso a paso completo está en el [LEEME de la sonda](../sonda/LEEME.md). Lo corto:

1. **PC del profe**: copiar `bigdata-sandbox-sonda.tar.gz` y `sonda-profe.cmd` a la misma carpeta, abrir
   Docker Desktop y hacer doble clic en `sonda-profe.cmd`. Muestra su IP en la red del aula, la línea
   para Veyon y `Profe listo`.
   - Si aparece el cartel del **Firewall de Windows**: anotar si dejó aceptar o pidió contraseña de
     administrador. Es un dato.
2. **Veyon → Transferencia de archivos** a las PCs: `bigdata-sandbox-sonda.tar.gz` y `sonda-alumno.cmd`.
3. **Veyon → Ejecutar programa** con la línea que mostró el profe, por ejemplo:

   ```
   cmd /c ""%USERPROFILE%\sonda-alumno.cmd" 192.168.0.10"
   ```

4. Esperar 1 a 5 minutos. En la ventana del profe van entrando las PCs y aparece
   `-> VEREDICTO por ahora: ...`. También en el navegador del profe:
   <http://localhost:8099/cgi-bin/resumen>.
5. **Copiar `C:\Users\<usuario del profe>\sonda-profe` al pendrive antes de apagar.** Ahí están
   `resumen.txt` y `planilla.csv`, que es lo que hace falta para seguir.
6. **Al día siguiente**, sin volver a pasar el `.tar.gz`, correr la sonda en modo `dia2` (ver el LEEME):
   dice si el reset borra las imágenes de Docker.

Qué significa el veredicto:

| Veredicto | Qué quiere decir | Cómo sigue el cluster |
|---|---|---|
| **A** | Cada PC pudo abrir un túnel hacia el profe | Túnel WireGuard: no hay que tocar el firewall de las PCs de alumnos |
| **B** | El túnel no anduvo, pero el profe pudo entrar a las PCs | Red directa: hay que abrir puertos en todas las PCs |
| **SIMULADO** | Las PCs no se ven | Cada PC corre su cluster simulado sola (como la prueba 2) |
| **SIN DATOS** | No llegó nada al profe | Casi seguro el firewall de la PC del profe, o la IP no era la del aula |

---

## Prueba 2 — Aula simulada en la PC del profe

Un maestro y dos "PCs" (cada una es un contenedor) en la misma compu. Es el mismo cluster que se armaría
con el laboratorio, en chico.

### Arrancarla

1. Abrir una **PowerShell** en una carpeta (por ejemplo el Escritorio) y bajar el archivo (o copiarlo del
   pendrive):

   ```powershell
   curl.exe -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
   ```

2. Bajar la imagen (una sola vez; si no hay internet, ver abajo) y arrancar:

   ```powershell
   docker compose -f aula-simulada.yml up -d
   docker compose -f aula-simulada.yml logs -f maestro
   ```

   Esperar a que el maestro diga **`Cluster LISTO`** (2 a 4 minutos) y cortar con Ctrl+C (el cluster sigue
   andando).

3. Ver qué quedó:

   ```powershell
   docker exec maestro estado
   ```

   Y en el navegador:
   - NameNode: <http://localhost:9870> → **Datanodes**: tienen que aparecer `maestro`, `pc01` y `pc02`.
   - YARN: <http://localhost:8088> → **Nodes**: `pc01` y `pc02` (el maestro no corre trabajos).

### Qué mirar con el profe

Todo se corre "sentado en una PC del aula":

```powershell
docker exec -it pc01 bash
```

**a) Racks por fila.** Hadoop sabe en qué fila está cada PC, para no guardar todas las copias de un
archivo en la misma fila:

```bash
hdfs dfsadmin -printTopology
```

El maestro está en `/profe` y las PCs en `/fila1`, `/fila2`... (de a 2 PCs por fila en este archivo).

**b) Dónde quedan los bloques.** Subir un archivo con bloques de 1 MB para que se corte en varios:

```bash
yes "hdfs yarn hive spark bloque rack fila profe" | head -c 8M > /tmp/texto.txt
hdfs dfs -mkdir -p /aula
hdfs dfs -D dfs.blocksize=1m -put -f /tmp/texto.txt /aula/texto.txt
hdfs fsck /aula/texto.txt -files -blocks -locations -racks
```

Cada bloque tiene 3 copias y **una siempre está en el maestro** (marcada `ARCHIVE`): si se apaga el aula
entera, los datos siguen en la PC del profe.

**c) Un trabajo repartido entre las PCs:**

```bash
yarn jar "$HADOOP_HOME"/share/hadoop/mapreduce/hadoop-mapreduce-examples-*.jar wordcount /aula/texto.txt /aula/conteo
hdfs dfs -cat /aula/conteo/part-r-00000
```

Mientras corre, en <http://localhost:8088> se ve el trabajo; al terminar, en <http://localhost:19888>
(JobHistory) → el trabajo → **Map tasks** se ve en qué PC corrió cada pedazo.

**d) Hive y Spark desde una PC, contra el maestro:**

```bash
beeline -u jdbc:hive2://maestro:10000 -n root -e "CREATE TABLE IF NOT EXISTS prueba (n INT); INSERT INTO prueba VALUES (1),(2),(3); SELECT COUNT(*) FROM prueba;"
spark-submit --master yarn --class org.apache.spark.examples.SparkPi "$SPARK_HOME"/examples/jars/spark-examples_*.jar 20
```

**e) Una PC que se cae.** Salir de pc01 (`exit`) y, desde la PowerShell:

```powershell
docker kill pc02
```

A los ~40 segundos el NameNode la marca muerta (<http://localhost:9870> → Datanodes). Con solo dos PCs no
hay otra donde hacer la tercera copia, así que los bloques quedan **sub-replicados** pero el archivo se
sigue leyendo:

```powershell
docker exec pc01 hdfs dfs -cat /aula/texto.txt | Measure-Object -Line
docker exec maestro hdfs fsck /
docker start pc02
```

Al volver pc02, el fsck vuelve a dar `HEALTHY`. Para ver la **re-replicación** (HDFS copiando solo a otra
PC), sumar una `pc03` en `aula-simulada.yml` (copiar el bloque de `pc02` y cambiar el número; necesita ~2 GB
más) y repetir.

### Apagar y borrar todo

```powershell
docker compose -f aula-simulada.yml down -v
```

### Sin internet en la PC del profe

En una compu con internet:

```powershell
docker pull franki678/bigdata-sandbox:empresa
docker save franki678/bigdata-sandbox:empresa -o bigdata-sandbox-empresa.tar
```

Llevar el `.tar` en el pendrive y en la PC del profe: `docker load -i bigdata-sandbox-empresa.tar`.

---

## Qué anotar al terminar

- El `resumen.txt` y la `planilla.csv` de la sonda (y el de `dia2` del día siguiente).
- Las respuestas del profe a las 4 preguntas de [Antes de la clase](#antes-de-la-clase).
- En la prueba 2: si arrancó, cuánto tardó en decir `Cluster LISTO` y cuánta RAM usaba Docker
  (Docker Desktop → **Contenedores**).

---

## Lo que viene

Con el veredicto de la sonda se arma la red entre las PCs de verdad:

- El profe arranca el maestro con un `.cmd` y en su pantalla aparecen la **IP** y un **código de la clase**.
- Por Veyon se corre en todas las PCs un `aula-alumno.cmd` con esa IP y ese código: cada PC se suma sola
  como DataNode y NodeManager.
- Una vista **Aula** en la interfaz muestra el laboratorio como un rack: cada PC una lámpara (ámbar
  mientras se suma, verde cuando ya es parte del cluster), y se proyecta con la Demostración de Veyon.
- Al cierre, la interfaz espera a que todo tenga copia en el maestro y avisa "ya pueden apagar".

Después vienen Kafka con Spark Streaming (datos en tiempo real), métricas de la clase, seguridad
(permisos, cuotas por alumno) y un almacenamiento tipo S3 local.
