# Sonda del laboratorio

Una herramienta chica para correr **una clase** en el laboratorio y decidir, con datos, cómo armar el
cluster del aula (la versión `empresa`):

- **A — Túnel WireGuard con hub en la PC del profe.** Cada PC de alumno abre un túnel *saliente* hacia
  el profe; nadie tiene que abrir el firewall en las PCs de alumnos.
- **B — Red directa con puertos fijos.** Cada PC publica sus puertos y las demás entran directo; pide que
  el firewall de Windows deje entrar en **todas** las PCs.
- **Simulado.** Si no anda ni lo uno ni lo otro: cada PC corre su cluster simulado sola, como hoy.

No instala nada en Windows ni pide permisos de administrador. Lo único que queda en las PCs es la imagen
de la sonda (unos 18 MB; el `.tar.gz` pesa unos 8 MB) y una carpeta con los resultados.

> En el repo: cómo encaja la sonda en el plan del aula en la [guía 3, el laboratorio](../guias/empresa/03-laboratorio.md);
> qué mide y por qué, en [teoría, redes](../guias/empresa/teoria/06-redes.md).

## Qué hay en el release `sonda-v1`

| Archivo | Para qué |
|---|---|
| `bigdata-sandbox-sonda.tar.gz` | La imagen de la sonda (Docker). No hace falta internet: se reparte por Veyon. |
| `sonda-profe.cmd` | Se corre en la PC del profe. |
| `sonda-alumno.cmd` | Se corre en cada PC de alumno (por Veyon). |
| `LEEME.md` | Esto. |

## Antes de la clase (en casa o en la sala de profesores)

1. Bajá los cuatro archivos del release a un pendrive.
2. En la PC del profe, copiá `bigdata-sandbox-sonda.tar.gz` y `sonda-profe.cmd` a la **misma carpeta**
   (por ejemplo el Escritorio).
3. Abrí Docker Desktop en la PC del profe y esperá a que diga que está andando.

## Paso a paso en la clase

Con 3 a 5 PCs alcanza para decidir; con todas, mejor.

1. **Repartir la sonda.** En Veyon, seleccioná las PCs de los alumnos → **Transferencia de archivos** →
   elegí `bigdata-sandbox-sonda.tar.gz` y `sonda-alumno.cmd`. Veyon los deja en la carpeta del usuario
   (`C:\Users\<usuario>`), salvo que en la configuración de Veyon diga otra carpeta de destino.
2. **Que las PCs tengan Docker abierto.** Si Docker Desktop está cerrado, el `.cmd` lo abre solo y
   espera hasta 3 minutos.
3. **Arrancar la sonda del profe.** En tu PC, doble clic en `sonda-profe.cmd` (o
   `sonda-profe.cmd 20` desde una consola, si querés que el resumen diga "de 20 esperadas"). Muestra:
   - las IPs de tu PC (la que sirve es la de la red del aula, ej. `192.168.0.10`);
   - la línea exacta para Veyon;
   - `Profe listo` cuando ya escucha.

   Si Windows muestra el cartel *"Firewall de Windows bloqueó algunas características de esta app"*
   (`com.docker.backend`), eso **ya es un dato**: anotá si te dejó aceptarlo o pidió contraseña de
   administrador.
4. **Correr la sonda en las PCs.** En Veyon, seleccioná las PCs → **Ejecutar programa** → pegá la línea
   que mostró tu `.cmd`, por ejemplo:

   ```
   cmd /c ""%USERPROFILE%\sonda-alumno.cmd" 192.168.0.10"
   ```

   En cada PC se abre una ventana negra: carga la imagen (si hace falta), junta los datos de la PC y
   hace las pruebas. Tarda de 1 a 5 minutos (las mediciones de ancho de banda van de a una).
5. **Mirar el resultado.** En tu ventana van apareciendo las PCs que se inscriben y mandan resultados,
   y la línea `-> VEREDICTO por ahora: ...`. Cuando terminaron todas, cortá con **Ctrl+C**.
   El resumen también se ve en el navegador de tu PC: <http://localhost:8099/cgi-bin/resumen>.
6. **Guardar los resultados.** Copiá la carpeta `C:\Users\<tu usuario>\sonda-profe` al pendrive
   **antes de apagar**: si la PC se resetea, se pierde.

## Al día siguiente (¿el reset borra la imagen?)

1. En Veyon, transferí **solo** `sonda-alumno.cmd` (es chico; si el reset borró la carpeta del usuario,
   ya no está). **No** transfieras el `.tar.gz`: justamente se quiere ver si la imagen sigue cargada.
2. En tu PC corré `sonda-profe.cmd` (si tu imagen también se borró, la vuelve a cargar del `.tar.gz`
   que tengas al lado).
3. En Veyon → **Ejecutar programa**:

   ```
   cmd /c ""%USERPROFILE%\sonda-alumno.cmd" dia2 192.168.0.10"
   ```

   Solo se fija si la imagen sigue cargada y si la carpeta `sonda-resultados` sobrevivió, y se lo manda
   al profe. No carga nada ni hace pruebas de red. El resumen agrega la sección **Día siguiente**.

## Cómo leer el resultado

En `sonda-profe` quedan:

- **`resumen.txt`**: arriba el **VEREDICTO** (A, B o SIMULADO) y **por qué**, después el detalle de red,
  las PCs y el día siguiente.
- **`planilla.csv`**: una fila por PC (se abre con Excel; separador `;`).
- `profe.txt` y `profe-pc.txt`: datos de la PC del profe (incluye las reglas de entrada del firewall
  para Docker, si se pudieron leer). `eventos.log`: lo que fue pasando.

Cómo decide (con el 80% de las PCs que mandaron resultados como umbral):

1. Si el túnel levantó en el 80% o más → **A**.
2. Si no, pero el profe pudo entrar al puerto publicado de la PC en el 80% o más → **B**.
3. Si no → **SIMULADO**.
4. Si ninguna PC llegó a mandar nada → **SIN DATOS**: casi seguro el firewall de la PC del profe no deja
   entrar (hay que pedirle a sistemas la regla de entrada para UDP 51820-51821 y TCP 8099) o la IP que se
   pasó no era la de la red del aula. Cada PC igual dejó su copia en `C:\Users\<usuario>\sonda-resultados`.

Columnas de la planilla:

| Columna | Qué es |
|---|---|
| `nombre`, `ip_pc`, `perfil_red` | Nombre de la PC, su IP en el aula y si Windows ve la red como Pública/Privada/Dominio (el firewall cambia según eso). |
| `windows`, `docker_desktop` | Versiones. |
| `docker_ram_mb`, `docker_cpus`, `docker_kernel` | Lo que tiene asignado Docker (la VM de WSL2). |
| `ram_gb`, `cpu`, `nucleos`, `gpu` | Hardware de la PC (la GPU sale de `Win32_VideoController`). |
| `imagen_cargada_antes` | Si la imagen de la sonda ya estaba cargada antes de correr el `.cmd`. |
| `carga_seg` | Cuánto tardó el `docker load`. |
| `docker` | `si`, o `no (motivo)` si Docker no anduvo (por ejemplo, el usuario no está en el grupo `docker-users`). |
| `dev_net_tun` | Si el contenedor tiene `/dev/net/tun` (lo que necesita wireguard-go). |
| `udp_profe` | Si un paquete UDP llega al profe y vuelve (puerto 51821). |
| `inscripcion` | Si la PC llegó al profe por TCP 8099. |
| `wg_kernel`, `wg_go` | Si anda WireGuard del kernel de Docker y si anda wireguard-go. |
| `tunel`, `tunel_modo`, `tunel_motivo` | Si el túnel al profe levantó, con qué, y si no, por qué. |
| `ping_profe_ms` | Latencia por el túnel. |
| `iperf_profe_mbps` | Ancho de banda alumno → profe por el túnel (Mbit/s). |
| `iperf_par`, `iperf_par_mbps` | Ancho de banda alumno → otro alumno pasando por el hub del profe. |
| `tcp_entrante` | Si el profe pudo entrar al puerto publicado de la PC (8098): lo que necesita la opción B. `no (sin respuesta (firewall))` = el firewall lo descarta; `no (rechazada)` = no había nada escuchando o el firewall rechaza. |
| `tcp_companeros` | Lo mismo, pero desde la PC hacia dos compañeros. |
| `dia2_*` | Lo del día siguiente. |

## Si algo sale mal

- **"No esta la imagen cargada ni el archivo..."**: el `.tar.gz` no quedó al lado del `.cmd`, ni en la
  carpeta del usuario, Escritorio, Descargas o Documentos.
- **"Docker no anda en esta PC"**: queda anotado con el motivo y se le avisa al profe igual (es un dato).
- **Una PC no aparece en el profe**: mirá su ventana; si dice que no se pudo inscribir, no llega al
  puerto 8099 del profe.
- **Probar solo los datos de la PC** (sin Docker): `sonda-alumno.cmd hardware`.

## Detalles técnicos

- Imagen `bigdata-sandbox-sonda:v1` (Alpine con `wireguard-tools`, `wireguard-go`, `iperf3`, `socat` y
  `busybox httpd`). No está en Docker Hub: solo en el release.
- PC del profe: publica UDP **51820** (hub WireGuard), UDP **51821** (eco) y TCP **8099** (inscripción y
  resultados). Contenedor con `--cap-add NET_ADMIN --device /dev/net/tun --sysctl net.ipv4.ip_forward=1`.
- PC de alumno: publica TCP **8098** (prueba de entrada). Contenedor con `--cap-add NET_ADMIN` y, si
  Docker lo deja, `--device /dev/net/tun`. Red del túnel `10.13.0.0/24` (profe `.1`, alumnos `.11` en
  adelante).
- Los contenedores se borran solos al terminar (`--rm`). La PC de alumno se queda 2 minutos más
  atendiendo a los compañeros (iperf y TCP) y después se va.
- Todo se prueba en GitHub Actions (`.github/workflows/sonda.yml`) simulando PCs aisladas en redes de
  Docker separadas: con túnel del kernel, con wireguard-go, sin `/dev/net/tun` y sin puertos.
  Lo que el CI **no** puede simular: el firewall de Windows, Docker Desktop/WSL2, Veyon y el reset diario.
  Para eso es esta clase.
