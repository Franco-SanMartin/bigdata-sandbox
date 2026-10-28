# Sonda del laboratorio: clase del 27/10/2026

Primera corrida real de la sonda (`sonda-v1`) en el laboratorio: la PC del
profe (PC86) y 11 PCs de alumnos. Las IPs del aula se reemplazaron por
`aula.NNN` y no se incluyen las claves del túnel.

## Veredicto: A, túnel WireGuard con la PC del profe como central

- Túnel arriba en **11 de 11** PCs, todas con el módulo WireGuard del kernel.
- UDP e inscripción hacia el profe: 11 de 11. Ping por el túnel: unos 3 ms.
- Los alumnos solo hacen conexiones salientes: no hay que abrir su firewall.

## Lo que hay que tener en cuenta para `empresa`

| Hallazgo | Dato | Consecuencia |
|---|---|---|
| **La red es lenta** | Alumno → profe por el túnel: mediana 50 Mbit/s (37 a 89). Alumno → alumno por el hub: mediana 31 (10 a 82) | Con la opción A todo pasa por la PC del profe: es el cuello de botella. Datasets de pocos GB, réplica 2, y aprovechar la localidad de YARN |
| **El reset borra todo cada día** | Visto en el aula: cada día las PCs aparecen como nuevas (imágenes de Docker, carpetas y HDFS incluidos) | Cada clase hay que cargar la imagen y los datos de cero: hace falta una **imagen de trabajador chica** y un arranque de un solo paso |
| **La mayoría tiene 8 GB** | 8 de 11 PCs con 8 GB (Docker con unos 3,8 GB); 3 con 16 GB (Docker con 7,8 GB) | Las de 8 GB, solo como trabajadoras (DataNode + NodeManager, unos 2 GB para tareas); las de 16 GB y la del profe para lo pesado |
| **Hardware mezclado** | De i3-2120 (2011) a i3-12100 (2022) | Cada PC aporta distinto a YARN: buen caso para enseñar tareas lentas y ejecución especulativa |
| **No hay GPU NVIDIA** | Intel integradas o adaptador básico | Todo el ML va por CPU |
| **Red "Pública" en Windows** | Todas las PCs, con IPs 192.169.0.x (que no es un rango privado) | Firewall en su modo más estricto; avisar a sistemas |
| **Cartel del firewall en cada PC** | Lo dispara el puerto 8098 que abre la sonda del alumno, solo para medir la opción B | Con la opción A los alumnos no abren puertos: en `empresa` no tiene que aparecer. A la sonda le falta un modo sin la prueba B |
| **Entrada directa a los alumnos** | El profe entró a 4 de 11 PCs; 3 bloqueadas por el firewall y 4 sin terminar | La opción B no sirve sin reglas de firewall en todas las PCs |
| **Veyon deja los archivos donde estaban** | Si se transfieren desde el Escritorio, quedan en el Escritorio del alumno | La línea para Veyon tiene que apuntar a esa carpeta (o usar la carpeta compartida) |

## Archivos

- `resumen.txt`: el veredicto y los porqués, tal cual los generó la sonda.
- `planilla.csv`: una fila por PC (separador `;`).
- `eventos.log`: el orden en que se inscribieron y mandaron resultados.
- `profe.txt` y `profe-pc.txt`: la PC del profe.
- `resultados/` y `tcp/`: lo que mandó cada PC.

No se hizo la prueba del "día siguiente": el reset borra todo, así que no hacía falta.
