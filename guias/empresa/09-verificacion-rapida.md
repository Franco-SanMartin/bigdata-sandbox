# 9. Verificación de 1 minuto, sin la interfaz

Cuatro comandos en la **PC del profe** para saber si el cluster del aula
está bien armado, sin abrir el navegador. Sirven después de sumar las PCs,
después de cargar el dataset y cuando algo parece raro.

[← Índice de `empresa`](README.md) · [3. El laboratorio](03-laboratorio.md)

Se corren en una ventana de `cmd` (o PowerShell) de la PC del profe. Los
ejemplos son con **3 PCs sumadas** (`pc01` a `pc03`); con más, más filas.

## 1. El maestro y sus servicios

<!-- prueba: no (cmd en la PC del profe, con el aula andando) -->
```bat
docker exec bigdata-maestro estado
```

**Qué tendría que salir** (sin los colores):

```
  Cluster del aula: este nodo es maestro (ROL=maestro), maestro: maestro
  Replicacion: 2   Tamano de bloque: 128m   Servicios: todo
  Red del aula: tunel WireGuard (...), hub en 10.13.0.1/..., codigo K7Q2, 3 PC(s) inscriptas

   NameNode               http://maestro:9870           arriba
   Secondary NameNode     http://maestro:...            arriba
   DataNode (archivo)     http://maestro:9864           arriba
   ResourceManager        http://maestro:8088           arriba
   MapReduce JobHistory   http://maestro:19888          arriba
   MySQL (tienda + Metastore) jdbc:mysql://maestro/tienda arriba
   Hive Metastore         thrift://maestro:9083         arriba
   HiveServer2 (JDBC)     jdbc:hive2://maestro:10000    arriba
   Spark History Server   http://maestro:18080          arriba
   Segun el NameNode: DataNodes vivos 4, muertos 0 | bloques ..., sub-replicados 0
```

**Lo que importa**: todo `arriba`, **`3 PC(s) inscriptas`** y **DataNodes
vivos 4** (las 3 PCs más el del maestro), **muertos 0**. Lo mismo da
`empresa-profe.cmd estado`.

## 2. Los racks

<!-- prueba: no (cmd en la PC del profe, con el aula andando) -->
```bat
docker exec bigdata-maestro hdfs dfsadmin -printTopology
```

**Qué tendría que salir**: dos racks. `Rack: /fila1` con
`10.13.0.11:9866 (pc01)`, `10.13.0.12:9866 (pc02)` y
`10.13.0.13:9866 (pc03)`, y `Rack: /profe` con `10.13.0.1:9866 (maestro)`.
Las PCs van de a 5 por fila (`PCS_POR_FILA=5`): `pc06` ya cae en `/fila2`.
Si una PC falta acá, su DataNode no se anotó: mirar su ventana.

## 3. Lo que tiene YARN para repartir

<!-- prueba: no (cmd en la PC del profe, con el aula andando) -->
```bat
docker exec bigdata-maestro yarn node -list
```

**Qué tendría que salir**: `Total Nodes:3` y una fila por PC,
`pc01:8041`, `pc02:8041`, `pc03:8041`, todas en **`RUNNING`**. El maestro
no aparece: no presta memoria para trabajos (`MAESTRO_NM=no`).

## 4. Dónde quedaron los bloques (con el dataset cargado)

<!-- prueba: no (cmd en la PC del profe, con el dataset cargado) -->
```bat
docker exec bigdata-maestro /opt/sandbox/aula/bloques.sh /aula/datos
```

**Qué tendría que salir**: una fila por nodo con sus copias; la del
**maestro con tantas copias como bloques** (`(la del maestro: una de cada
bloque)`), el resto repartido entre las PCs, y al final
`Under-replicated blocks: 0` y `Status: HEALTHY`. Con el taxi 2024 de la
[guía 5](05-dataset.md): `12 bloques en /aula/datos (replicacion 2)`.

## Si algo no da

| Lo que sale | Qué es |
|---|---|
| `Error: No such container: bigdata-maestro` | El maestro no está creado: `empresa-profe.cmd` |
| Algún servicio `ABAJO` | Hadoop todavía arranca (2 a 4 min la primera vez) o se cayó: `docker logs --tail 40 bigdata-maestro` |
| Menos PCs inscriptas que ventanas que dijeron `Ya se puede cerrar` | Alguna se sumó a otro código (de un `empresa-profe.cmd cero`): volver a mandarle la línea de `veyon.txt` |
| DataNodes `muertos` mayor que 0 | Una PC se apagó o perdió el túnel. Si fue a propósito, es la demo de fallas |
| `sub-replicados` mayor que 0 que no baja | Faltan PCs vivas para la segunda copia, o recién se cayó una y HDFS está copiando |
| Una PC en `yarn node -list` como `LOST` o `UNHEALTHY` | La perdió YARN (a los 60 s de apagarse) o se quedó sin disco |

Desde una PC de alumno, lo mismo con `docker exec bigdata-trabajador estado`:
dice su nombre, su IP del túnel (`10.13.0.(10+N)`), el MTU y lo que presta.

[← 8. Hoja del alumno](08-hoja-alumno.md) · [Índice de `empresa`](README.md)
