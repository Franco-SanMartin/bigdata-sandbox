# 4. Políticas de almacenamiento y tiers

[← 3. Fallas](03-fallas.md) · [Teoría](README.md) · Siguiente: [5. Localidad y YARN →](05-localidad-y-yarn.md)

## No todos los datos valen lo mismo

En una empresa, los datos de esta semana se leen todo el tiempo; los de
hace tres años, casi nunca, pero hay que guardarlos. Pagar disco rápido
para todo es caro. La solución es tener **niveles** (*tiers*) de
almacenamiento:

| Tier | Para qué datos | Hardware típico |
|---|---|---|
| Caliente (*hot*) | Los que se leen y escriben seguido | Disco rápido o SSD, en nodos con mucha CPU |
| Tibio (*warm*) | Los que se leen de vez en cuando | Mezcla |
| Frío (*cold*) | Los que casi no se leen pero hay que guardar | Mucho disco barato, poca CPU (nodos de "archivo") |

HDFS soporta esto con dos ideas: **tipos de almacenamiento** y
**políticas**.

## Tipos de almacenamiento

Cada carpeta de datos de un DataNode se marca con un tipo, poniéndolo
adelante entre corchetes en `dfs.datanode.data.dir`:

| Tipo | Qué representa |
|---|---|
| `DISK` | Disco común (el de fábrica, si no se marca nada) |
| `SSD` | Disco de estado sólido |
| `ARCHIVE` | Almacenamiento denso y barato, para datos fríos |
| `RAM_DISK` | Memoria, para datos temporales |

En el aula:

- El DataNode del **maestro** guarda en `[ARCHIVE]/hadoop/dfs/dn1`.
- El de cada **PC**, en `[DISK]/hadoop/dfs/dn1`.

En el aula simulada son todos el mismo disco de la misma compu: el tipo es
una etiqueta. HDFS no mide la velocidad de nada; confía en lo que le
dicen.

## Políticas

Una **política de almacenamiento** dice en qué tipo va cada réplica de un
bloque, y qué hacer si no hay lugar de ese tipo. Se pone **por carpeta**
(o archivo) y la heredan los archivos y carpetas de abajo.

| Política | Réplicas (con replicación 3) |
|---|---|
| `HOT` (la de fábrica) | 3 en `DISK` |
| `WARM` | 1 en `DISK`, 2 en `ARCHIVE` |
| `COLD` | 3 en `ARCHIVE` |
| `ONE_SSD` | 1 en `SSD`, 2 en `DISK` |
| `ALL_SSD` | 3 en `SSD` |
| `LAZY_PERSIST` | 1 en `RAM_DISK` (se escribe a disco después) |

Cada política tiene además tipos de **reemplazo** (*fallback*): qué usar si
no hay nodos del tipo pedido. Para `WARM`, el reemplazo es `DISK` o
`ARCHIVE`, tanto al escribir como al re-replicar. La lista completa sale
de `hdfs storagepolicies -listPolicies`.

## `WARM` en el aula: una copia de todo en el profe

En el primer arranque el maestro corre:

```text
hdfs storagepolicies -setStoragePolicy -path / -policy WARM
```

Así **todo** HDFS es `WARM`. Con replicación 3, `WARM` quiere 1 `DISK` y 2
`ARCHIVE`. Pero hay **un solo** DataNode `ARCHIVE` (el maestro), y un nodo
no guarda dos réplicas del mismo bloque. La segunda `ARCHIVE` no tiene
dónde ir y usa el reemplazo: `DISK`. Resultado:

| Réplica | Tipo | Dónde |
|---|---|---|
| 1 | `ARCHIVE` | El maestro (`/profe`) |
| 2 y 3 | `DISK` | Dos PCs |

Las pruebas de la imagen verifican exactamente eso: una `ARCHIVE` por
bloque y 3 réplicas vivas. Con `REPLICATION=2`: una `ARCHIVE` y una `DISK`.

**Por qué se eligió así** (está en el comentario del arranque): para que
"el profe guarde una copia de cada bloque y se pueda apagar toda el aula
sin perder nada". En un laboratorio:

- Las PCs de los alumnos se apagan al terminar la clase, y en muchos
  laboratorios se **resetean** todos los días (la sonda pregunta eso en su
  `dia2`).
- La PC del profe es la que sigue: con una copia de todo ahí, la clase
  siguiente arranca con los datos completos, aunque las PCs vengan vacías.
- Al volver las PCs, HDFS re-replica desde el maestro hacia ellas.

### El costo

Nada es gratis:

- **Disco del maestro**: tiene que entrar una copia de **todo** lo que
  suba la clase.
- **Escrituras**: cada bloque nuevo pasa por el maestro (es parte de la
  cañería de escritura). Con 20 PCs escribiendo a la vez, la red y el disco
  del maestro son el cuello de botella.
- **Lecturas**: no cambian mucho: los trabajos leen la copia más cercana,
  que casi siempre es la de una PC.

## Cambiar la política no mueve lo que ya está

Poner una política nueva en una carpeta solo afecta a los bloques **que se
escriban después**. Los que ya estaban quedan donde estaban, aunque no la
cumplan. Para acomodarlos está la herramienta **mover** (`hdfs mover -p
<ruta>`), que recorre la carpeta y mueve cada réplica al tipo que pide su
política.

En una empresa es el flujo típico de los tiers: una tarea programada pasa
las particiones viejas (por ejemplo, de más de 90 días) de `HOT` a `WARM`
o `COLD` y corre el mover. La imagen no tiene esa tarea: en el aula todo
es `WARM` desde el primer arranque.

## Comprobarlo

- `hdfs storagepolicies -getStoragePolicy -path /aula`: la política
  efectiva de una carpeta (heredada de `/`).
- `hdfs fsck <archivo> -files -blocks -locations`: cada réplica termina en
  su tipo (`...,DISK]` o `...,ARCHIVE]`). Con `-racks` el tipo no se ve:
  aparece el rack en su lugar.

## En la nube

En la nube la idea es la misma con otros nombres: los almacenamientos de
objetos (tipo S3) tienen **clases** (estándar, acceso poco frecuente,
archivo) con distinto precio por GB y por lectura, y **reglas de ciclo de
vida** que pasan los objetos de una clase a otra por antigüedad. Es el
equivalente de las políticas más el mover, hecho por el proveedor.

## Resumen

- Tipos (`DISK`, `SSD`, `ARCHIVE`, `RAM_DISK`) son etiquetas de las
  carpetas de datos; políticas (`HOT`, `WARM`, `COLD`...) dicen en qué
  tipo va cada réplica.
- En el aula: el maestro es `ARCHIVE`, las PCs `DISK`, todo HDFS es
  `WARM` → una copia de cada bloque en el maestro.
- Costo: disco y red del maestro.
- Cambiar una política no mueve bloques viejos: para eso, `hdfs mover`.

Preguntas: [evaluación, almacenamiento](../evaluacion/03-almacenamiento.md).

[← 3. Fallas](03-fallas.md) · [Teoría](README.md) · Siguiente: [5. Localidad y YARN →](05-localidad-y-yarn.md)
