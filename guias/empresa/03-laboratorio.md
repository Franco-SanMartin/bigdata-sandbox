# 3. El cluster del aula, con las PCs del laboratorio

`empresa` es la versión del sandbox en la que **todas las PCs del
laboratorio arman un solo cluster de Hadoop**: la PC del profe es el
maestro (NameNode, ResourceManager, Hive, Spark History y la interfaz web
con la vista **Aula**) y cada PC de alumno suma un DataNode y un
NodeManager.

[← 2. Sumar PCs](02-sumar-pcs.md) · [Índice de `empresa`](README.md)

Esta guía es el paso a paso de una clase: qué corre el profe, qué se manda
por **Veyon** (el programa con el que el profe maneja el laboratorio),
cuánto tarda cada parte y qué mirar en la vista Aula. La red se armó con lo
que midió la [sonda](../../sonda/resultados/2026-10-27/LEEME.md) el 27/10.

## Lo que impone el laboratorio

| Lo que se midió | Qué se hizo |
|---|---|
| El túnel WireGuard con hub en la PC del profe anduvo en **11 de 11** PCs (veredicto **A**) | `RED=wireguard`: cada PC se conecta **hacia** el profe; nadie abre puertos en las PCs de alumnos |
| La red es lenta: unos **50 Mbit/s** alumno → profe y 31 alumno → alumno, todo pasando por la PC del profe | Réplica **2** (una copia en una PC y otra en el maestro), datasets de pocos GB y una imagen chica para las PCs |
| **El reset borra todo cada día** (imágenes, carpetas, HDFS) | Cada clase arranca de cero con dos `.cmd`; todo se puede correr de nuevo sin romper nada |
| 8 de 11 PCs tienen 8 GB (Docker con 3,8 GB) y 3 tienen 16 GB (7,8 GB) | Cada PC presta dos tercios de lo que tiene Docker: **2 GB** en las de 8 GB y **5 GB** en las de 16, con todos sus cores |
| El cartel del firewall de Windows aparece en cada PC que **publica** un puerto | Las PCs no publican nada; solo la del profe (UDP 51820 y TCP 8099), y una vez |
| Veyon deja los archivos en la misma carpeta de donde se mandan | La línea para Veyon apunta a esa carpeta (la arma `empresa-profe.cmd`) |

## Cómo queda armado

```
           PC del profe (maestro, 10.13.0.1)                PCs de alumnos
   ┌───────────────────────────────────────────┐
   │ NameNode, ResourceManager, Hive, Spark    │   UDP 51820 (túnel)   pc01  10.13.0.11
   │ DataNode "archivo": una copia de todo     │◄──────────────────── pc02  10.13.0.12
   │ hub WireGuard + inscripción (TCP 8099)    │   (salen de la PC,    pc03  10.13.0.13
   │ interfaz web :8080 (vista Aula)           │    no entran)         ...
   └───────────────────────────────────────────┘
```

Cada PC primero **reserva su número** en el profe (con el código de la
clase), arranca con ese nombre (`pc01`, `pc02`...) y se **inscribe** con su
clave del túnel. Desde ese momento el maestro la ve por su IP del túnel
(`10.13.0.(10+N)`): HDFS guarda bloques en ella y YARN le manda trabajos.
Una PC le habla a otra (copias de HDFS, shuffle de los trabajos) pasando por
el hub de la PC del profe. Los detalles están en el [LEEME de
`empresa`](../../empresa/LEEME.md) y en [teoría: redes](teoria/06-redes.md).

## La clase en una tabla

| Paso | Quién | Qué | Cuánto tarda (medido en el CI y en una PC de prueba) |
|---|---|---|---|
| 0 | Profe, antes | Bajar el release `aula-v1` al pendrive | Una vez |
| 1 | Profe | `empresa-profe.cmd`: carga la imagen del maestro y lo arranca | 2 a 4 min de `docker load` (1,6 GB) + 1 a 3 min de arranque |
| 2 | Veyon | Transferir la imagen chica (192 MB) y `empresa-alumno.cmd` | 192 MB por PC: 20 PCs × 192 MB a ~50-90 Mbit/s ≈ **6 a 10 min**; desde la carpeta compartida, menos |
| 3 | Veyon | Ejecutar `empresa-alumno.cmd` en todas | `docker load` (~20 s a 1 min) + **menos de 1 min** para sumarse |
| 4 | Profe | `empresa-profe.cmd cargar ...` (el dataset) | Unos **3 min por GB** (ver la tabla de tamaños) |
| 5 | Todos | La clase: consultas, una PC que se apaga, recursos, ML | Lo que dure |
| 6 | Profe | Esperar "Ya pueden apagar" en la vista Aula | Segundos, si no se cargó nada nuevo |

El tiempo real de cada PC queda anotado: `empresa-alumno.cmd` escribe en
`%USERPROFILE%\bigdata-aula\aula.txt` cuánto tardó en cargar la imagen y en
sumarse, y `empresa-profe.cmd cargar` deja la velocidad de cada carga en
`%USERPROFILE%\bigdata-aula\cargas.txt` de la PC del profe.

---

## 0. Antes de la clase (en casa, con internet)

Del release [`aula-v1`](https://github.com/Franco-SanMartin/bigdata-sandbox/releases/tag/aula-v1),
bajar a un pendrive:

| Archivo | Para qué | Tamaño |
|---|---|---|
| `bigdata-sandbox-empresa.tar.gz` | La imagen del maestro (PC del profe) | ~1,6 GB |
| `bigdata-sandbox-trabajador.tar.gz` | La imagen de las PCs | ~192 MB |
| `empresa-profe.cmd` | Se corre en la PC del profe | |
| `empresa-alumno.cmd` | Se corre en cada PC, por Veyon | |
| `LEEME.md` | Esta guía | |

Y el **dataset** de la clase (ver [qué tamaño elegir](#qué-tamaño-de-dataset)).

Si sistemas puede dejar `bigdata-sandbox-trabajador.tar.gz` en la **carpeta
compartida** (que para los alumnos es de solo lectura), mejor: las PCs la
leen de ahí y no hace falta mandarla por Veyon (ver el paso 2).

## 1. Arrancar el maestro (PC del profe)

1. Copiar los cuatro archivos a **una carpeta del Escritorio** (por ejemplo
   `Escritorio\aula`). Esa carpeta importa: Veyon deja los archivos en la
   misma carpeta en cada PC, y la línea para Veyon apunta ahí.
2. Doble clic en **`empresa-profe.cmd`**. Si Docker Desktop está cerrado, lo
   abre y espera. Carga la imagen del maestro si falta (2 a 4 minutos) y
   arranca el contenedor `bigdata-maestro`.
3. Si aparece el cartel **"Firewall de Windows bloqueó algunas
   características"** (`com.docker.backend`): **Permitir** en redes
   **públicas** (la red del aula se ve como Pública). Es el único cartel de
   la clase: las PCs de los alumnos no publican nada.
4. La ventana muestra:

   ```
   ==================================================================
     BigData Sandbox - el cluster del aula
       IP de esta PC en el aula: 192.169.0.86
       Codigo de la clase:       K7Q2
     En Veyon, con las PCs seleccionadas:
       1. Transferencia de archivos: bigdata-sandbox-trabajador.tar.gz y empresa-alumno.cmd
       2. Ejecutar programa:
          cmd /c ""%USERPROFILE%\Desktop\aula\empresa-alumno.cmd" 192.169.0.86 K7Q2"
     Interfaz (vista Aula): http://localhost:8080/#aula
   ==================================================================
   ```

   La línea también queda en `%USERPROFILE%\bigdata-aula\veyon.txt`, para
   copiarla. Si la IP que muestra no es la de la red del aula (la lista de
   abajo tiene todas), cambiala en la línea.
5. Cuando Hadoop termina de arrancar (`Maestro listo en ... s`, unos 2
   minutos la primera vez), se abre el navegador en la **vista Aula**. Ya se
   pueden sumar las PCs; las que lleguen antes esperan solas.

Si se cierra la ventana no pasa nada: el maestro sigue andando. Volver a
correr `empresa-profe.cmd` muestra otra vez la IP, el código y la línea, sin
tocar nada (el código es el mismo toda la clase).

## 2. Sumar las PCs por Veyon

1. En Veyon, seleccionar las PCs → **Transferencia de archivos** → elegir
   `bigdata-sandbox-trabajador.tar.gz` y `empresa-alumno.cmd` **desde la
   carpeta del paso 1**. Quedan en la misma carpeta en cada PC.
2. En Veyon → **Ejecutar programa** → pegar la línea que mostró
   `empresa-profe.cmd`.

Con la imagen en la **carpeta compartida**, alcanza con transferir solo
`empresa-alumno.cmd` y agregar la carpeta al final de la línea (la imagen se
lee desde ahí; es de solo lectura y no importa):

<!-- prueba: no (se pega en Veyon, Ejecutar programa) -->
```bat
cmd /c ""%USERPROFILE%\Desktop\aula\empresa-alumno.cmd" 192.169.0.86 K7Q2 \\SERVIDOR\Compartida\bigdata"
```

En cada PC se abre una ventana que:

1. abre Docker Desktop si está cerrado;
2. carga la imagen (192 MB) y dice cuánto tardó;
3. **pide su número** a la PC del profe (`Esta PC va a ser pc07`);
4. arranca el contenedor `bigdata-trabajador`: se inscribe, levanta el túnel,
   prende el DataNode y el NodeManager, y muestra lo que presta
   (`2048 MB y 4 cores`, o `5120 MB y 8 cores` en las de 16 GB);
5. termina con `Ya se puede cerrar esta ventana`.

**Qué mirar en la vista Aula** (proyectarla con la Demostración de Veyon,
botón *Pantalla completa*):

- cada PC aparece como una **lámpara ámbar** apenas reserva su número, y se
  pone **verde** cuando su DataNode y su NodeManager están anotados;
- debajo de cada una: su nombre en Windows (`PC121`), su IP del túnel, lo que
  presta (memoria y cores) y cuántos bloques guarda;
- arriba, **Memoria para trabajos** y **Cores para trabajos**: la suma de lo
  que prestan todas las PCs. Es lo que YARN tiene para repartir.

Si una PC no se pone verde, su ventana dice por qué (abajo, [si algo sale
mal](#si-algo-sale-mal)).

## 3. Cargar el dataset

Desde la PC del profe, con el dataset en el pendrive o en la carpeta
compartida (un archivo o una carpeta entera):

<!-- prueba: no (cmd en la PC del profe) -->
```bat
empresa-profe.cmd cargar E:\datasets\taxi /aula/datos/taxi
```

Sube cada archivo a HDFS **sin copiarlo antes al disco** (lo pasa directo al
contenedor) y muestra la velocidad de cada uno y la total, en MB/s y Mbit/s.
Al final dice **cómo quedaron repartidos los bloques**: cuántas copias tiene
cada PC y que el maestro tiene una de cada bloque.

### Qué tamaño de dataset

Con réplica 2, cada bloque va a una PC y al maestro. La copia del maestro no
pasa por la red; la de la PC sí, por el túnel: unos **50 Mbit/s ≈ 6 MB/s ≈
21 GB por hora**.

| Dataset | Tamaño en HDFS | Subirlo (a ~6 MB/s) | Cuando se cae una PC de 20 |
|---|---|---|---|
| Un mes de NYC Taxi (Parquet) | ~50 MB | segundos | nada que esperar |
| Un año de NYC Taxi (Parquet) | ~0,6 GB | ~2 min | unos 30 MB a re-copiar: segundos |
| 1 GB | 1 GB | ~3 min | ~50 MB: unos 10 s |
| 3 GB (HIGGS en Parquet o una muestra en CSV) | 3 GB | ~8 min | ~150 MB: menos de 1 min |
| 10 GB | 10 GB | ~30 min | ~500 MB: 2 a 3 min |

**Recomendación: 1 a 3 GB.** Alcanza para que cada PC tenga decenas de
bloques y los trabajos se repartan, y la carga entra en el primer recreo. Con
más, la carga se come la clase y la PC del profe (todo pasa por ella) se
vuelve el cuello de botella. Para consultas y ML, Parquet antes que CSV: pesa
menos y Spark lee solo las columnas que usa. HIGGS (2,6 GB comprimido, unos
8 GB en CSV) conviene convertirlo a Parquet en casa o llevar una muestra.

Leer el dataset para una consulta **casi no usa la red**: YARN corre cada
tarea en la PC que tiene el bloque (localidad). Lo que sí pasa por la red es
el *shuffle* (los resultados intermedios entre PCs) y la re-replicación.

## 4. La clase

Todo esto se hace desde la PC del profe, en la interfaz
(<http://localhost:8080>) o en su terminal integrada (``Ctrl+` ``).

- **Dónde quedó cada bloque**: vista Aula (bloques por PC), o
  `hdfs fsck /aula/datos -files -blocks -racks` en la terminal: cada bloque
  con una copia en `/profe` y otra en una fila.
- **Consultas**: Hive (sobre Tez), Spark SQL y Pig, en *Consultas*. Las
  tareas corren en las PCs (en *Trabajos* se ve en cuál corrió cada una).
- **Una PC que se apaga, de verdad**: apagar una PC desde Veyon (o
  desenchufarla). En la vista Aula su lámpara pasa a **ámbar "Sin
  respuesta"** a los ~10 s y a **roja "Caída"** a los **40 s**: el NameNode
  la da por muerta y empieza a copiar sus bloques en las otras PCs (el
  contador de *Bloques en HDFS* muestra cuántos tienen copias de menos, y
  baja). A los **60 s** YARN también la pierde (`LOST`) y reintenta sus
  tareas en otras PCs. Si la PC vuelve a la clase (al prenderla el reset ya
  borró todo: otra vez la transferencia y la línea de Veyon en ella), se
  suma con el mismo nombre y la misma IP.
- **Recursos**: *Memoria y Cores para trabajos* en la vista Aula, y en el
  ResourceManager (<http://localhost:8088> → *Nodes*) lo que presta y usa cada
  PC. YARN reparte por memoria **y** por cores: una PC de 16 GB recibe más
  contenedores que una de 8. Con dos trabajos a la vez se ve cómo se reparten.
- **ML distribuido**: Spark MLlib sobre YARN, desde *Machine Learning* o con
  `spark-submit` en la terminal: los executors corren en las PCs (traen
  Python con numpy). XGBoost distribuido todavía no: necesita sus librerías
  en las PCs.
- **La escala**: el mismo trabajo con 1, 5, 10 y 20 PCs (sumándolas de a
  tandas con Veyon) y anotar el tiempo de cada uno.

## 5. Al terminar: "ya pueden apagar"

En la vista Aula, la franja de abajo de los números dice **"Todavía no
apaguen las PCs"** (ámbar) mientras el maestro no tenga una copia de cada
bloque, y **"Ya pueden apagar"** (verde) cuando la tiene. Recién ahí se
apagan las PCs: el dataset sigue entero en la PC del profe hasta el reset.

Para apagar el maestro en orden: `empresa-profe.cmd apagar`. Para empezar de
cero en la misma clase (borra HDFS y cambia el código): `empresa-profe.cmd
cero`; las PCs se vuelven a sumar con la línea nueva.

## Si algo sale mal

| Lo que dice la ventana de la PC | Qué pasa | Qué hacer |
|---|---|---|
| `la PC del profe no contesta en http://IP:8099` | No llega a la inscripción | ¿Anda `empresa-profe.cmd`? ¿La IP es la de la red del aula? ¿Se permitió el cartel del firewall en la PC del profe? |
| `el codigo 'XXXX' no es el de esta clase` | El código está mal tipeado o es de otra clase | Copiar otra vez la línea de `empresa-profe.cmd` |
| `la inscripcion anduvo ... pero el tunel no levanta` | Llega por TCP pero el UDP 51820 no | El firewall de la PC del profe deja pasar TCP y no UDP: pedirle a sistemas la regla de entrada para UDP 51820 |
| `paquetes de 1380 bytes no pasan enteros` (aviso) | Algo en el camino achica los paquetes | Nada: esa PC sigue con MTU 1280 |
| `No esta la imagen cargada ni el archivo` | Veyon dejó la imagen en otra carpeta | Mandarla de nuevo a la misma carpeta que el `.cmd`, o pasar la carpeta compartida al final de la línea |
| `Docker Desktop no termino de arrancar` | Docker tardó más de 3 minutos | Abrirlo a mano y volver a ejecutar la línea |
| `este contenedor se tiene que llamar pcNN` | Se arrancó el contenedor a mano sin reservar | Correr `empresa-alumno.cmd` (reserva el nombre y lo arma bien) |
| Una PC queda ámbar "esperando su DataNode" | El maestro todavía está arrancando | Esperar: se suma sola cuando el NameNode contesta |

En cualquier PC, `empresa-alumno.cmd estado` muestra cómo está; en la del
profe, `empresa-profe.cmd estado`.

## Qué anotar para la próxima

- El tiempo de carga de la imagen en las PCs viejas y nuevas (`aula.txt` de
  cada PC, o lo que mostró su ventana).
- La velocidad de carga del dataset (`cargas.txt` de la PC del profe).
- Cuánto tardó en ponerse verde cada fila en la vista Aula.
- Si apareció algún cartel del firewall en las PCs de alumnos (no tendría).

---

## Probarlo sin el laboratorio

**En una sola compu**, el [aula simulada](01-aula-simulada.md) es el mismo
cluster con las PCs como contenedores en una red de Docker (`RED=docker`).

**Con el túnel de verdad**, el CI (workflow *Empresa*) arma el aula con
`RED=wireguard`: cada "PC" en su propia red de Docker, sin verse con las
otras ni publicar puertos, llegando al maestro solo por la IP del host, como
las PCs del aula llegan a la del profe. Se puede correr igual en cualquier
compu con Docker:

<!-- prueba: no (corre varios minutos y arma 4 contenedores) -->
```bash
IMAGEN=franki678/bigdata-sandbox:empresa IMAGEN_TRABAJADOR=franki678/bigdata-sandbox:trabajador \
  bash pruebas/aula.sh aula-wg
```

`aula-wg-caida` apaga una PC y espera la re-replicación; `aula-wg-cero`
prueba el arranque de cero de cada clase (código equivocado, wireguard-go sin
el módulo del kernel, reinicios y un maestro nuevo).

## La sonda

La [sonda del laboratorio](../../sonda/LEEME.md) ya se corrió el 27/10
(veredicto A, [resultados](../../sonda/resultados/2026-10-27/LEEME.md)). Si
se quiere volver a medir sin que aparezca el cartel del firewall en las PCs,
`sonda-alumno.cmd IP sin-b` no publica el puerto 8098 (no mide la red
directa, que con el túnel no hace falta).

[← 2. Sumar PCs](02-sumar-pcs.md) · [Índice de `empresa`](README.md)
