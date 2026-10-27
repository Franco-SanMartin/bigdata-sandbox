# Evaluación 5: redes y dimensionamiento

Teoría: [redes](../teoria/06-redes.md) y [RAM por rol](../teoria/07-ram-por-rol.md).

[← 4. YARN y localidad](04-yarn-y-localidad.md) · [Evaluación](README.md) · Siguiente: [6. Prácticos →](06-practicos.md)

## Opción múltiple

**1.** ¿Qué pasa hoy si arrancás `empresa` con `RED=wireguard`?

- a) Arma el túnel WireGuard solo.
- b) Corta con `RED=...: por ahora solo docker`.
- c) Arranca igual, con red de Docker.
- d) Usa la red del laboratorio directamente.

<details><summary>Respuesta</summary>

**b)** La validación del arranque solo acepta `docker`.

- a) WireGuard solo lo prueba la sonda; la imagen no lo implementa todavía.
- c) No sigue: corta antes de prender nada.
- d) No existe esa opción todavía.

</details>

**2.** ¿Por qué en la red `aula` de Docker los nodos se ven entre sí sin
configurar nada?

- a) Porque Docker publica todos los puertos en la compu.
- b) Porque en una red de Docker todos los contenedores tienen IP en la
  misma red, todos los puertos abiertos entre ellos y un DNS interno.
- c) Porque Hadoop usa solo el puerto 9000.
- d) Porque el maestro hace de túnel.

<details><summary>Respuesta</summary>

**b)** Se cumplen solos los dos requisitos: conexión en las dos direcciones
y nombres alcanzables.

- a) Los puertos publicados son para el navegador; los nodos no los usan.
- c) Hadoop usa muchos puertos (9866, 8031, 8041, 13562...).
- d) No hay túnel en el aula simulada.

</details>

**3.** En un laboratorio con Docker Desktop, ¿por qué no alcanza con que
cada PC llegue al maestro?

- a) Porque el NameNode se conecta por SSH a cada PC.
- b) Porque muchas conexiones van **hacia** las PCs: clientes y otros
  DataNodes al DataNode, ApplicationMasters al NodeManager, executors al
  driver de Spark.
- c) Porque el maestro tiene que formatear cada PC.
- d) Alcanza: todas las conexiones salen de las PCs.

<details><summary>Respuesta</summary>

**b)** Hadoop asume que cualquier nodo se conecta con cualquier otro.

- a) Hadoop no usa SSH entre nodos acá: cada nodo arranca sus servicios.
- c) El maestro formatea solo su NameNode.
- d) Los heartbeats salen de las PCs, pero los datos no.

</details>

**4.** Un DataNode figura vivo en el NameNode, pero leer un archivo desde
otra PC falla. ¿Qué es lo más probable?

- a) El NameNode está en safe mode.
- b) El nombre o la IP con que se anunció ese DataNode no se puede alcanzar
  desde la otra PC.
- c) El archivo está corrupto.
- d) Falta memoria en YARN.

<details><summary>Respuesta</summary>

**b)** El heartbeat va de la PC al maestro y anda; la lectura va de otra PC
hacia el DataNode, a la dirección que anunció (`dfs.datanode.hostname`).

- a) Con safe mode se puede leer igual.
- c) Con una sola PC fallando y el DataNode vivo, lo esperable es un
  problema de red, no de datos.
- d) Leer un archivo no usa YARN.

</details>

**5.** En la opción A (overlay WireGuard), ¿qué hay que abrir en el
firewall?

- a) La entrada en todas las PCs de alumnos.
- b) La entrada UDP 51820 en la PC del profe.
- c) Nada en ningún lado.
- d) El puerto 9000 en cada PC.

<details><summary>Respuesta</summary>

**b)** Cada PC abre el túnel hacia el profe (salida UDP, que suele estar
permitida); adentro del túnel están todos los puertos.

- a) Eso es lo que pide la opción B.
- c) Alguien tiene que aceptar las conexiones entrantes: el profe.
- d) El 9000 es el NameNode, y va adentro del túnel.

</details>

**6.** ¿Cuál es el costo principal de la opción A?

- a) Que hay que abrir el firewall de cada PC.
- b) Que todo el tráfico entre PCs pasa por la PC del profe: su placa de
  red es el límite.
- c) Que no funciona con HDFS.
- d) Que necesita una PC por fila.

<details><summary>Respuesta</summary>

**b)** El maestro hace de hub. La sonda lo mide con `iperf_par_mbps`.

- a) Es el costo de la B.
- c) Para Hadoop, adentro del túnel es como la red de Docker.
- d) No tiene nada que ver con las filas.

</details>

**7.** De 25 PCs, 20 mandaron resultado a la sonda. 15 levantaron el túnel
y 17 aceptaron la conexión entrante. ¿Qué veredicto da?

- a) A
- b) B
- c) SIMULADO
- d) SIN DATOS

<details><summary>Respuesta</summary>

**b)** El 80% de 20 son 16. El túnel (15) no llega; la entrada directa
(17) sí.

- a) A va primero, pero necesita 16 túneles.
- c) Sería si ninguna de las dos llegara al 80%.
- d) Mandaron 20 PCs: hay datos.

</details>

**8.** ¿Por qué la sonda usa el 80% y no el 100%?

- a) Porque WireGuard pierde el 20% de los paquetes.
- b) Porque en un laboratorio siempre hay alguna PC rota, sin Docker o con
  otra red; exigir el 100% haría que nunca se pudiera.
- c) Porque Hadoop necesita 80% de nodos vivos.
- d) Es un número al azar.

<details><summary>Respuesta</summary>

**b)** El cluster se arma con las PCs que andan.

- a) No tiene que ver con pérdida de paquetes.
- c) Hadoop no tiene ese límite.
- d) Tiene un motivo.

</details>

**9.** ¿Qué es `TRABAJADOR_RAM`?

- a) La RAM total de la PC.
- b) La memoria que el NodeManager de esa PC le anuncia a YARN para
  trabajos.
- c) La memoria del DataNode.
- d) La memoria del maestro.

<details><summary>Respuesta</summary>

**b)** Se usa para `yarn.nodemanager.resource.memory-mb` y para el
contenedor más grande que acepta YARN. Va de 1024 a 65536 MB; de fábrica
2048.

- a) Tiene que ser menos: hay servicios y lo que use el alumno.
- c) El DataNode tiene su propio tope (256 MB).
- d) Es por PC.

</details>

**10.** Al NameNode, ¿con qué le crece la memoria?

- a) Con los bytes guardados en HDFS.
- b) Con la cantidad de archivos y bloques.
- c) Con la cantidad de trabajos de YARN.
- d) No crece.

<details><summary>Respuesta</summary>

**b)** Guarda en memoria el árbol de archivos y bloques. Muchos archivos
chicos le pesan más que pocos grandes.

- a) Los bytes están en los DataNodes.
- c) Eso es del ResourceManager.
- d) Crece con cada archivo y bloque nuevo.

</details>

## Desarrollo

**1.** Compará las opciones A y B para armar el aula con PCs de verdad:
qué hay que configurar, dónde está el cuello de botella y qué mide la
sonda para elegir.

<details><summary>Respuesta modelo</summary>

**A, overlay WireGuard**: cada PC abre un túnel UDP hacia el profe (puerto
51820); adentro del túnel cada nodo tiene IP fija (en la sonda,
`10.13.0.0/24`) y todos los puertos. Solo hay que abrir la entrada en la PC
del profe; necesita `NET_ADMIN` y WireGuard (kernel o `wireguard-go` con
`/dev/net/tun`). Cuello de botella: la PC del profe, por donde pasa todo.

**B, red directa**: cada PC publica puertos fijos en su IP del laboratorio
y los nodos se anuncian con esa IP. Hay que fijar los puertos aleatorios y
abrir el firewall de entrada en todas las PCs (hace falta sistemas). El
tráfico va directo, sin cuello en el profe.

La sonda mide `tunel` (A) y `tcp_entrante` (B) en cada PC y decide con el
80% de las PCs que contestaron: A si llega, si no B, si no SIMULADO.

</details>

**2.** Un laboratorio tiene PCs de 8 GB y Docker Desktop configurado con 6
GB. Proponé un `TRABAJADOR_RAM` y justificá.

<details><summary>Respuesta modelo</summary>

De los 6 GB de Docker hay que sacar los servicios de la PC (DataNode y
NodeManager, unos 0,5 a 1 GB) y dejar margen; si el alumno lanza Spark
desde ahí, el driver (512 MB y algo más) también va fuera de YARN. Queda
alrededor de 4 GB: `TRABAJADOR_RAM=4096` es razonable (múltiplo de 512).
Con 3072 es más seguro si el alumno lanza Spark desde su PC. Lo que no hay
que hacer es anunciar los 6 GB: YARN los llenaría y la PC se quedaría sin
memoria.

Puntos que no pueden faltar: restar servicios y margen; que es un número
que se anuncia; un valor dentro de 1024-65536.

</details>

**3.** ¿Por qué el maestro no corre trabajos de fábrica, y cuándo
convendría que sí?

<details><summary>Respuesta modelo</summary>

Porque concentra los servicios que, si se caen, tiran todo el cluster
(NameNode, ResourceManager, Hive). Un trabajo que lo deje sin memoria haría
caer el aula entera. Conviene prenderlo (`MAESTRO_NM=si`) cuando hay pocas
PCs y la del profe tiene RAM de sobra para los servicios más
`TRABAJADOR_RAM`.

</details>

[← 4. YARN y localidad](04-yarn-y-localidad.md) · [Evaluación](README.md) · Siguiente: [6. Prácticos →](06-practicos.md)
