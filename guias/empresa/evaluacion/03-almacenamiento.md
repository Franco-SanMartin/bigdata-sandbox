# Evaluación 3: almacenamiento

Teoría: [políticas de almacenamiento y tiers](../teoria/04-politicas-de-almacenamiento.md).

[← 2. Fallas](02-fallas.md) · [Evaluación](README.md) · Siguiente: [4. YARN y localidad →](04-yarn-y-localidad.md)

## Opción múltiple

**1.** En el aula, ¿de qué tipo es el almacenamiento del DataNode del
maestro?

- a) `DISK`
- b) `SSD`
- c) `ARCHIVE`
- d) `RAM_DISK`

<details><summary>Respuesta</summary>

**c)** Su carpeta de datos está marcada `[ARCHIVE]`. Las PCs son `[DISK]`.

- a) `DISK` son las PCs.
- b) y d) La imagen no usa esos tipos.

</details>

**2.** ¿Qué política pone el maestro en `/` en el primer arranque?

- a) `HOT`
- b) `WARM`
- c) `COLD`
- d) Ninguna: queda la de fábrica

<details><summary>Respuesta</summary>

**b)** `hdfs storagepolicies -setStoragePolicy -path / -policy WARM`.

- a) `HOT` es la de fábrica de HDFS, la que habría sin ese comando.
- c) `COLD` pondría todas las réplicas en `ARCHIVE`: con un solo nodo
  `ARCHIVE`, una sola réplica.
- d) El arranque la cambia.

</details>

**3.** Con `WARM` y replicación 3 en el aula, ¿cómo quedan las réplicas de
cada bloque?

- a) 3 en `ARCHIVE`, en el maestro.
- b) 2 en `ARCHIVE` y 1 en `DISK`.
- c) 1 en `ARCHIVE` (el maestro) y 2 en `DISK` (dos PCs).
- d) 3 en `DISK`.

<details><summary>Respuesta</summary>

**c)** `WARM` pide 1 `DISK` y 2 `ARCHIVE`, pero hay un solo nodo
`ARCHIVE` y un nodo no guarda dos réplicas del mismo bloque: la segunda
`ARCHIVE` usa el reemplazo, `DISK`.

- a) Un nodo no guarda tres copias del mismo bloque.
- b) Es lo que pide `WARM`, pero no hay un segundo nodo `ARCHIVE`.
- d) Sería `HOT`.

</details>

**4.** ¿Para qué sirve, en el aula, que el maestro guarde una copia de cada
bloque?

- a) Para que las lecturas sean más rápidas.
- b) Para que se pueda apagar (o resetear) toda el aula sin perder datos:
  la PC del profe tiene todo.
- c) Para que el NameNode tenga menos trabajo.
- d) Para ahorrar disco en las PCs.

<details><summary>Respuesta</summary>

**b)** Es lo que dice el arranque: "una copia de todo en el maestro".

- a) Las lecturas eligen la réplica más cercana, casi siempre una PC.
- c) El NameNode tiene el mismo trabajo.
- d) Las PCs igual guardan dos réplicas de cada bloque.

</details>

**5.** ¿Cuál es el principal costo de esa decisión?

- a) El maestro no puede correr Hive.
- b) Cada escritura pasa por el maestro, y su disco tiene que guardar una
  copia de todo lo que suba la clase.
- c) Las PCs no pueden leer bloques.
- d) No tiene costo.

<details><summary>Respuesta</summary>

**b)** El maestro es parte de la cañería de escritura de cada bloque: su
red y su disco limitan cuánto puede escribir la clase a la vez.

- a) Hive corre en el maestro igual.
- c) Las PCs leen como siempre.
- d) Nada es gratis.

</details>

**6.** Se cambia la política de `/datos-viejos` de `HOT` a `COLD`. ¿Qué
pasa con los bloques que ya estaban?

- a) Se mueven solos a `ARCHIVE` al instante.
- b) Nada, hasta correr `hdfs mover`: la política afecta lo que se escribe
  después.
- c) Se borran.
- d) Quedan corruptos.

<details><summary>Respuesta</summary>

**b)** La herramienta mover recorre la carpeta y lleva cada réplica al
tipo que pide su política.

- a) Cambiar la política no mueve nada.
- c) y d) Los bloques siguen intactos donde estaban.

</details>

**7.** ¿Cómo se ve el tipo (`DISK` o `ARCHIVE`) de cada réplica?

- a) `hdfs fsck <archivo> -files -blocks -locations`
- b) `hdfs fsck <archivo> -files -blocks -racks`
- c) `hdfs dfs -ls <archivo>`
- d) `yarn node -list`

<details><summary>Respuesta</summary>

**a)** Cada réplica aparece como `DatanodeInfoWithStorage[ip:9866,DS-...,ARCHIVE]`.

- b) Con `-racks` aparece el rack **en lugar** del tipo.
- c) `-ls` muestra la replicación del archivo, no dónde está cada réplica.
- d) Lista NodeManagers, no bloques.

</details>

**8.** Una carpeta no tiene política propia, pero su padre es `WARM`.
¿Qué política usan sus archivos nuevos?

- a) `HOT`, la de fábrica.
- b) `WARM`: las políticas se heredan.
- c) Ninguna: no se puede escribir.
- d) Depende del cliente.

<details><summary>Respuesta</summary>

**b)** Por eso alcanza con ponerla en `/` para que valga en todo HDFS.

- a) `HOT` es si nadie hacia arriba tiene otra.
- c) Se escribe normal.
- d) La política es de la ruta, no del cliente.

</details>

## Desarrollo

**1.** Explicá qué son los tiers de almacenamiento y cómo los implementa
HDFS. Relacionalo con lo que hace la imagen en el aula.

<details><summary>Respuesta modelo</summary>

Los tiers son niveles de almacenamiento según qué tan seguido se usan los
datos: calientes en disco rápido, fríos en disco barato y denso. HDFS lo
implementa con tipos de almacenamiento (cada carpeta de datos de un
DataNode se marca `DISK`, `SSD`, `ARCHIVE` o `RAM_DISK`) y políticas por
carpeta (`HOT`, `WARM`, `COLD`, `ONE_SSD`, `ALL_SSD`...) que dicen en qué
tipo va cada réplica, con tipos de reemplazo si no hay lugar.

En el aula, el DataNode del maestro es `ARCHIVE`, los de las PCs `DISK`, y
todo HDFS es `WARM`: cada bloque tiene una réplica en el maestro y las otras
en PCs. No se usa para ahorrar plata sino para que la PC del profe tenga
una copia de todo.

</details>

**2.** Una empresa guarda los logs de cada día en `/logs/AAAA-MM-DD`.
Proponé cómo usar las políticas para que los logs de más de 90 días ocupen
almacenamiento barato.

<details><summary>Respuesta modelo</summary>

Tener DataNodes con carpetas `ARCHIVE` (nodos de archivo: mucho disco,
poca CPU). Los logs nuevos se escriben con `HOT` (o la de fábrica). Una
tarea programada (por ejemplo, diaria) busca las carpetas de más de 90
días, les pone `COLD` (o `WARM` si se siguen consultando algo) con `hdfs
storagepolicies -setStoragePolicy` y corre `hdfs mover -p` sobre ellas
para mover las réplicas que ya estaban. Hay que dimensionar el espacio
`ARCHIVE` para todo el histórico.

Puntos que no pueden faltar: nodos `ARCHIVE`; política por carpeta; que
cambiar la política no mueve lo viejo y hace falta el mover.

</details>

[← 2. Fallas](02-fallas.md) · [Evaluación](README.md) · Siguiente: [4. YARN y localidad →](04-yarn-y-localidad.md)
