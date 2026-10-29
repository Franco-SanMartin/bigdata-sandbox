# 4. Prueba piloto: 2 o 3 PCs antes de la clase

Antes de sumar las 20 PCs, armar el cluster con **la PC del profe y 2 o 3
PCs de alumnos** y anotar lo que pasa. Es la [guía 3](03-laboratorio.md) en
chico: los mismos `.cmd`, el mismo release `aula-v1`, la misma vista Aula.
Lleva unos **30 a 40 minutos**.

[← Índice de `empresa`](README.md) · [3. El laboratorio](03-laboratorio.md)

## Qué llevar

- Pendrive con el release [`aula-v1`](https://github.com/Franco-SanMartin/bigdata-sandbox/releases/tag/aula-v1):
  `bigdata-sandbox-empresa.tar.gz`, `bigdata-sandbox-trabajador.tar.gz`,
  `empresa-profe.cmd` y `empresa-alumno.cmd`.
- El dataset de prueba ya bajado: un año de NYC Taxi en Parquet, unos
  600 MB ([guía 5](05-dataset.md)).
- Esta hoja impresa (o abierta en el celular) para completar la tabla.
- Si algo falla con el release: el [plan B](06-plan-b.md).
- La [hoja para sistemas](07-hoja-para-sistemas.md), por si hay que pedir
  la regla del firewall.

## Los pasos

| # | Qué | Cómo | Qué tendría que pasar |
|---|---|---|---|
| 1 | Copiar los 4 archivos a `Escritorio\aula` en la PC del profe | A mano, desde el pendrive | La carpeta con los 4 archivos |
| 2 | Arrancar el maestro | Doble clic en `empresa-profe.cmd` | Carga la imagen (2 a 4 min), muestra IP `192.169.0.x`, código de 4 letras y la línea para Veyon |
| 3 | Cartel del firewall | **Permitir**, tildando redes **públicas** | Un solo cartel, en esta PC |
| 4 | Esperar a Hadoop | Mirar la ventana | `Maestro listo en ... s` y se abre la vista Aula |
| 5 | Mandar a 2 o 3 PCs | Veyon → Transferencia de archivos: `bigdata-sandbox-trabajador.tar.gz` y `empresa-alumno.cmd` | Los 2 archivos en `Escritorio\aula` de cada PC |
| 6 | Sumarlas | Veyon → Ejecutar programa → la línea de `veyon.txt` | En cada PC: `Esta PC va a ser pc01`... y `Ya se puede cerrar esta ventana` |
| 7 | Vista Aula | Mirar en la PC del profe | Cada PC pasa de ámbar a **verde**; arriba suman Memoria y Cores para trabajos |
| 8 | Verificación de 1 minuto | La [guía 9](09-verificacion-rapida.md) | 3 o 4 DataNodes vivos, 2 o 3 NodeManagers `RUNNING` |
| 9 | Cargar el dataset | `empresa-profe.cmd cargar E:\taxi-2024 /aula/datos/taxi` | La velocidad de cada archivo y al final cómo quedaron los bloques |
| 10 | Una consulta | La de la [guía 5](05-dataset.md#una-consulta-para-probar) | Un conteo por mes; en *Trabajos* las tareas corren en las PCs |
| 11 | Apagar una PC | Veyon → Apagar (o desenchufarla) | Ámbar a los ~10 s, **roja** a los ~40 s, los bloques sub-replicados bajan a 0 |
| 12 | Fin | Esperar **"Ya pueden apagar"** en la vista Aula | Verde: el maestro tiene una copia de cada bloque |

Si un paso no anda, la tabla [si algo sale mal](03-laboratorio.md#si-algo-sale-mal)
de la guía 3 dice qué significa cada mensaje.

## La tabla para anotar

Copiar los números que muestran las ventanas. Los tiempos también quedan
escritos en `%USERPROFILE%\bigdata-aula\aula.txt` de cada PC
(`carga_imagen_s` y `sumada_s`) y en `%USERPROFILE%\bigdata-aula\cargas.txt`
de la PC del profe.

**PC del profe**

| Dato | Valor |
|---|---|
| Nombre de la PC / RAM / Docker (MB) | |
| IP que mostró (`192.169.0.__`) ¿era la del aula? | |
| Código de la clase | |
| Imagen del maestro cargada en (s) | |
| `Maestro listo en` (s) | |
| ¿Apareció el cartel del firewall? ¿Se permitió en Públicas? | |
| Carga del dataset: MB, segundos, MB/s (de `cargas.txt`) | |
| Consulta de prueba: segundos | |
| PC apagada: ¿a los cuántos s se puso roja? ¿y sub-replicados en 0? | |
| ¿"Ya pueden apagar" en verde al final? | |

**PCs de alumnos**

| PC (Windows) | pcNN | RAM | Imagen cargada en (s) | Sumada en (s) | Presta (MB y cores) | ¿Verde? | ¿Cartel de firewall? | Notas |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |
| | | | | | | | | |

Lo esperable, por lo que midió la [sonda](../../sonda/resultados/2026-10-27/LEEME.md)
y el CI: imagen chica cargada en 20 s a 1 min, sumada en menos de 1 min,
`2048 MB` en las PCs de 8 GB y `5120 MB` en las de 16 GB, **ningún cartel**
en las PCs de alumnos y unos 6 MB/s (50 Mbit/s) de carga del dataset.

## Con qué se decide la clase grande

- **Todo verde y ningún cartel en las PCs**: se puede ir con las 20.
- **El túnel no levanta** (`la inscripcion anduvo ... pero el tunel no
  levanta`): falta la regla de UDP 51820 en la PC del profe → [hoja para
  sistemas](07-hoja-para-sistemas.md).
- **La carga va muy por debajo de 6 MB/s**: llevar un dataset más chico
  (unos meses de taxi en vez del año).
- **Algo del release no anda**: [plan B](06-plan-b.md).

[← Índice de `empresa`](README.md) · Siguiente: [5. El dataset →](05-dataset.md)
