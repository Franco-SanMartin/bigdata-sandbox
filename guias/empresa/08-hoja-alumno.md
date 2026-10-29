# 8. Para el alumno: tu PC en el cluster del aula

Hoy **todas las PCs del laboratorio arman un solo cluster de Hadoop**. La PC
del profe es el **maestro**; la tuya es un **trabajador**: guarda bloques
de HDFS (DataNode) y corre tareas de los trabajos (NodeManager de YARN).

[← Índice de `empresa`](README.md)

**Qué vas a ver.** El profe manda un programa por Veyon y se abre una
ventana negra en tu PC. Carga una imagen de Docker, dice
`Esta PC va a ser pcNN` (tu nombre en el cluster) y lo que prestás
(`2048 MB` y tus cores, o `5120 MB` si tu PC tiene 16 GB). Termina con
`Ya se puede cerrar esta ventana`. **No tenés que hacer nada**: cerrala.

**Qué no hacer.**

- No cierres **Docker Desktop** ni apagues la PC hasta que el profe diga
  **"Ya pueden apagar"**: tus bloques son parte del cluster.
- No abras puertos ni aceptes carteles del firewall: tu PC solo sale hacia
  la del profe. Si aparece uno, avisá.

**Para mirar por dentro (opcional).** En una ventana de `cmd`:

<!-- prueba: no (cmd en la PC del alumno, sumada al aula) -->
```bat
docker exec -it bigdata-trabajador bash
```

Adentro, los comandos de Hadoop apuntan al maestro:

<!-- prueba: no (adentro de bigdata-trabajador) -->
```bash
estado                                   # quién sos (pcNN), tu IP del túnel, lo que prestás
hdfs dfsadmin -printTopology             # los racks: /profe y las filas
hdfs dfs -ls /aula/datos/taxi            # el dataset de la clase
hdfs fsck /aula/datos/taxi -files -blocks -locations   # en qué PCs quedó cada bloque
yarn node -list                          # las PCs que prestan memoria y cores
```

Escribí `exit` para salir. Nada de esto rompe el cluster.

**Si algo sale mal**, tu ventana dice por qué (por ejemplo
`la PC del profe no contesta`): avisale al profe. Para ver cómo está tu PC:
`empresa-alumno.cmd estado`. El tiempo que tardó tu PC queda en
`%USERPROFILE%\bigdata-aula\aula.txt`.

[← 7. Hoja para sistemas](07-hoja-para-sistemas.md) · Siguiente: [9. Verificación de 1 minuto →](09-verificacion-rapida.md)
