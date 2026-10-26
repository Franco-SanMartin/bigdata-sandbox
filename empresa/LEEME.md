# Versión empresa: el cluster del aula

> Para probarla en el laboratorio con el profe: [GUIA-AULA.md](GUIA-AULA.md).

La imagen `franki678/bigdata-sandbox:empresa` es la `full` más un modo de
cluster de verdad: cada compu del aula corre un contenedor y entre todas arman
**un solo cluster** de Hadoop.

| `ROL` | Qué corre | Para quién |
|---|---|---|
| `solo` (o sin `ROL`) | Igual que la `full`: la interfaz en `:8080` | Cada uno en su compu |
| `maestro` | NameNode + Secondary, ResourceManager, JobHistory, MariaDB (tienda y Metastore de Hive), Hive Metastore + HiveServer2, Spark History y un DataNode de archivo | La compu del profe |
| `trabajador` | Un DataNode y un NodeManager | Cada PC del aula |

## Cómo se reparte

- **Racks por fila**: el maestro es `/profe` y las PCs `pcNN` van de a
  `PCS_POR_FILA` por fila (`/fila1`, `/fila2`...). HDFS deja las copias de un
  bloque en más de una fila: si se apaga una fila entera, no se pierde nada.
- **Una copia de todo en el maestro**: HDFS usa la política `WARM` y el
  DataNode del maestro es de tipo `ARCHIVE`, así que cada bloque tiene una
  réplica ahí. Se puede apagar el aula entera y los datos siguen.
- **Los trabajos corren en las PCs**: el maestro no tiene NodeManager (salvo
  `MAESTRO_NM=si`). Cada PC presta `TRABAJADOR_RAM` MB (2048 de fábrica).

## Variables

| Variable | De fábrica | Qué hace |
|---|---|---|
| `ROL` | `solo` | `solo`, `maestro` o `trabajador` |
| `MAESTRO` | `maestro` | Nombre del maestro (lo usan las PCs) |
| `RED` | `docker` | Por ahora solo `docker`: todos en la misma red de Docker |
| `PCS_POR_FILA` | `5` | PCs por fila, para los racks |
| `TRABAJADOR_RAM` | `2048` | MB que cada PC presta para trabajos (1024 a 65536) |
| `MAESTRO_NM` | `no` | `si`: el maestro también corre trabajos |
| `REPLICATION` | `3` | Réplicas de cada bloque |

## Probarlo en una sola compu

Alcanza con bajar [`aula-simulada.yml`](aula-simulada.yml), sin clonar el repo:

```bash
curl -fsSLO https://raw.githubusercontent.com/Franki-678/bigdata-sandbox/empresa/empresa/aula-simulada.yml
docker compose -f aula-simulada.yml up -d
docker exec maestro estado
docker exec -it pc01 bash
hdfs dfsadmin -printTopology
```

Las pruebas automáticas están en `pruebas/aula.sh` (escenarios `aula` y
`aula-caida`) y las corre el workflow **Empresa**.
