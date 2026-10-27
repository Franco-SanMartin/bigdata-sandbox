# 6. Redes: por qué el aula simulada anda y el laboratorio todavía no

[← 5. Localidad y YARN](05-localidad-y-yarn.md) · [Teoría](README.md) · Siguiente: [7. RAM por rol →](07-ram-por-rol.md)

Hoy `empresa` solo arranca con `RED=docker`: todos los nodos en una misma
red de Docker, o sea en una sola compu. Con otro valor se corta con `RED=...:
por ahora solo docker`. Este tema explica qué le falta a la red de un
laboratorio de verdad, y qué mide la sonda para decidir cómo armarla.

## Lo que Hadoop le pide a la red

Hadoop asume que **cualquier nodo puede abrir una conexión hacia cualquier
otro**, por nombre, en puertos conocidos (y algunos aleatorios). No alcanza
con que las PCs lleguen al maestro: también el maestro y las otras PCs
tienen que poder llegar a cada PC.

| Quién | Hacia quién | Puerto | Para qué |
|---|---|---|---|
| Clientes y DataNodes | NameNode (maestro) | 9000 | Metadatos, heartbeats, block reports |
| Clientes | Cada DataNode | 9866 | Leer y escribir bloques |
| Un DataNode | Otro DataNode | 9866 | La cañería de escritura y la re-replicación |
| NodeManagers | ResourceManager (maestro) | 8031 | Anotarse y heartbeats |
| ApplicationMasters | ResourceManager | 8030 | Pedir contenedores |
| Clientes (`yarn`, `spark-submit`) | ResourceManager | 8032 | Lanzar trabajos |
| ApplicationMasters | Cada NodeManager | 8041 | Lanzar contenedores |
| Reduces | Cada NodeManager | 13562 | Leer la salida de los maps (shuffle) |
| Executors de Spark | Driver (en la PC que lanzó) | aleatorio | Recibir tareas, devolver resultados |
| Driver y executors | Executors | aleatorio | Bloques de Spark |
| Clientes | HiveServer2 (maestro) | 10000 | `beeline` |

Hay dos requisitos que se olvidan fácil:

1. **Bidireccional**: muchas flechas van **hacia** las PCs de alumnos (al
   DataNode, al NodeManager, al driver de Spark).
2. **Nombres que se puedan alcanzar**: cada DataNode se anuncia con un
   nombre (`dfs.datanode.hostname`, que es `NODO`). El NameNode les pasa
   ese nombre a los clientes y a los otros DataNodes, y ellos se conectan
   ahí. Si ese nombre (o la IP que hay detrás) no se puede alcanzar desde
   las otras PCs, la lectura o la escritura falla, aunque el DataNode
   figure "vivo" en el NameNode (porque el heartbeat va de la PC al
   maestro, que sí anda).

## Por qué en el aula simulada anda

En una red de Docker definida por el usuario (la red `aula` del compose):

- Cada contenedor tiene su IP en la misma red y **todos los puertos
  abiertos entre ellos**: no hay firewall entre contenedores.
- Docker tiene un DNS interno: `pc01`, `maestro`... resuelven a la IP del
  contenedor, desde cualquier otro. Y al revés (IP → nombre), que es lo que
  usa el script de racks.
- No hay NAT entre ellos.

O sea: se cumplen los dos requisitos sin hacer nada. Por eso los puertos
del compose (`9870`, `8088`...) solo se publican para mirar las interfaces
desde el navegador: los nodos no los necesitan.

## Por qué con PCs de verdad no

En un laboratorio con Windows y Docker Desktop, cada contenedor corre
adentro de una máquina virtual (WSL2), detrás de una **NAT**:

- **Salir** anda: el contenedor puede abrir conexiones hacia afuera (la
  NAT traduce su IP a la de la PC).
- **Entrar** no: desde otra PC solo se llega a los puertos **publicados**
  (`-p`), y solo si el **firewall de Windows** de esa PC lo deja. Los
  alumnos no suelen poder tocar ese firewall.
- La IP interna del contenedor no existe para las otras PCs. Un DataNode
  que se anuncie con ella es inalcanzable.
- Los puertos aleatorios (Spark) no se pueden publicar de antemano.

Hay dos formas conocidas de resolverlo. La sonda prueba las dos.

## Opción A: una red encima (overlay WireGuard)

Se arma una **red privada virtual** encima de la del laboratorio, con
**WireGuard**: cada PC abre un túnel UDP **hacia** el maestro (51820), y el
maestro hace de **hub**: todo el tráfico entre PCs pasa por él.

- Del lado de las PCs solo hace falta **salir** por UDP, que es lo que la
  NAT y el firewall suelen dejar. El túnel se mantiene abierto con
  paquetes periódicos.
- Adentro del túnel, cada nodo tiene una IP fija (en la sonda,
  `10.13.0.0/24`: el profe `.1`, los alumnos desde `.11`) y **todos los
  puertos**, en las dos direcciones. Para Hadoop es como la red de Docker.
- Lo que hay que abrir es la **entrada a la PC del profe** (UDP 51820), una
  sola regla en una sola PC.

Costos:

- Todo el tráfico entre PCs pasa por la PC del profe: su placa de red es
  el límite (la sonda mide `iperf_par_mbps`: alumno a alumno pasando por
  el hub).
- El contenedor necesita permisos de red (`NET_ADMIN`) y WireGuard: el del
  kernel o `wireguard-go` con `/dev/net/tun` (la sonda anota `wg_kernel`,
  `wg_go` y `dev_net_tun`).

## Opción B: red directa

Sin túnel: cada PC publica sus puertos en su IP del laboratorio, con
números **fijos**, y los nodos se anuncian con la IP de la PC.

- Hay que fijar todos los puertos, incluidos los que hoy son aleatorios
  (Spark), y publicarlos en cada PC.
- Hay que abrir el **firewall de entrada en todas las PCs**: hace falta
  sistemas o un administrador.
- A cambio, el tráfico va directo de PC a PC, sin pasar por el profe.

## Qué decide la sonda

La sonda mide justo lo que distingue las dos opciones, en **ese**
laboratorio:

| Pregunta | Columna | Opción |
|---|---|---|
| ¿Pudo cada PC levantar un túnel WireGuard hacia el profe? | `tunel` | A |
| ¿Pudo el profe abrir una conexión **hacia** el puerto publicado de la PC (TCP 8098)? | `tcp_entrante` | B |

Y decide con el **80% de las PCs que mandaron resultado** como umbral:

1. Túnel en el 80% o más: **A**. Es la primera opción porque no necesita
   tocar las PCs de los alumnos.
2. Si no, entrada directa en el 80% o más: **B**.
3. Si no: **SIMULADO**. Cada PC usa su propia aula simulada.
4. Si no llegó ninguna PC: **SIN DATOS** (casi siempre el firewall de la
   PC del profe).

Antes de todo eso, cada PC tiene que poder **llegar** al profe: el eco UDP
(51821, `udp_profe`) y la inscripción por TCP (8099, `inscripcion`). Si eso
falla en todas, no hay nada que medir.

Por qué el 80% y no el 100%: en un laboratorio siempre hay alguna PC rota,
sin Docker o con otro perfil de red. Un cluster que necesite el 100% no
arranca nunca.

## Lo que todavía falta

Nada de esto está en la imagen: `RED` solo acepta `docker`. La etapa 2 del
plan es implementar la red que diga la sonda (ver [Lo que viene en la guía
3](../03-laboratorio.md#lo-que-viene)).

## En la industria

- En un datacenter propio, los nodos de un cluster están en la misma red,
  sin NAT entre ellos, y el firewall se configura por puertos entre las
  subredes del cluster: es la "red directa", con red de verdad.
- Cuando los nodos están en redes distintas (varias oficinas, nube y
  datacenter propio), se usan VPNs u overlays como WireGuard.
- Kubernetes resuelve lo mismo con su propia red overlay: cada pod tiene su
  IP y todos se ven con todos.

## Resumen

- Hadoop necesita que todos los nodos se puedan conectar con todos, por
  nombre o IP alcanzable, en puertos fijos y aleatorios.
- La red de Docker lo da gratis; un laboratorio con NAT y firewall, no.
- Opción A: túnel WireGuard hacia el profe (solo hay que abrir la PC del
  profe; el profe es el cuello de botella).
- Opción B: red directa (puertos fijos y firewall abierto en todas las PCs).
- La sonda prueba las dos y decide con el 80%.

Preguntas: [evaluación, redes y dimensionamiento](../evaluacion/05-redes-y-dimensionamiento.md).

[← 5. Localidad y YARN](05-localidad-y-yarn.md) · [Teoría](README.md) · Siguiente: [7. RAM por rol →](07-ram-por-rol.md)
