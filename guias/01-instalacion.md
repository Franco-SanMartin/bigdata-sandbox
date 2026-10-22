# 1. Instalación: Docker y la imagen

Lo que se hace **una sola vez por compu**: instalar Docker y tener la imagen
`franki678/bigdata-sandbox`. No hace falta clonar este repo ni bajar nada más:
los ejemplos vienen adentro de la imagen.

[← Índice de guías](README.md) · Siguiente: [2. Arrancar y apagar →](02-arrancar-y-apagar.md)

## Qué necesitás

| Qué | Cuánto |
|---|---|
| Sistema | Windows 10/11 (64 bits), Linux o Mac (Intel o M1–M4) |
| RAM para Docker | **7 GB** con MongoDB (la configuración de estas guías). 6 GB sin MongoDB |
| Disco | ~4 GB libres en Windows/Mac (Docker Desktop guarda la imagen comprimida y descomprimida), ~2,5 GB en Linux |
| Procesador | Para MongoDB: Intel/AMD con **AVX** (casi todos desde 2011) o ARM moderno. Sin AVX anda todo menos MongoDB |

Lo que usa de verdad la imagen (medido por GitHub en cada versión nueva): en
reposo ~2,1 GB; con trabajos de MapReduce, Pig, Hive o Spark corriendo, hasta
~5,8 GB.

## Paso 1. Instalar Docker

### Windows

1. Bajá **Docker Desktop** de https://www.docker.com/products/docker-desktop/
   e instalalo con las opciones que trae (usa **WSL 2**). Pide reiniciar.
2. Abrilo y esperá a que abajo a la izquierda diga *Engine running*.
3. Si Windows dice que falta WSL o que la virtualización está apagada:
   en una consola **como administrador**:

   <!-- prueba: no (consola de Windows como administrador) -->
   ```powershell
   wsl --install
   ```

   y reiniciá. Si sigue, hay que activar la virtualización (*Intel VT-x* o
   *AMD-V/SVM*) en el BIOS.

**Memoria en Windows.** Con WSL 2, Docker Desktop no tiene el control de
memoria en *Settings*: la decide WSL (por defecto, la mitad de la RAM de la
compu). Si tu compu tiene 16 GB, ya alcanza. Si tiene 8 GB o querés fijarla,
creá el archivo `%UserProfile%\.wslconfig` (en el Explorador:
`C:\Users\<tu usuario>\.wslconfig`, sin extensión) con:

```text
[wsl2]
memory=7GB
```

Cerrá Docker Desktop, en una consola corré `wsl --shutdown` y volvé a abrirlo.

### Mac

Docker Desktop desde el mismo link (elegí *Apple Silicon* o *Intel* según tu
Mac). En *Settings → Resources → Memory*, **7 GB** o más.

### Linux

Docker Engine con el paquete de tu distribución o con
https://docs.docker.com/engine/install/. No tiene límite de memoria: usa la
de la compu. Para no escribir `sudo` en cada comando, sumá tu usuario al grupo
`docker` (`sudo usermod -aG docker $USER` y volvé a entrar).

### Comprobar que anda

En una terminal (en Windows: PowerShell o CMD, cualquiera de las dos):

<!-- prueba: compu | espera: Server -->
```bash
docker version
```

Tienen que aparecer dos partes, *Client* y *Server*. Si solo aparece
*Client* y un error, Docker Desktop no está abierto.

### ¿Tu procesador tiene AVX? (para MongoDB)

Casi seguro que sí. En Linux se ve así (si imprime `avx`, lo tiene):

<!-- prueba: compu | espera: avx -->
```bash
grep -o -m1 -w avx /proc/cpuinfo
```

En Windows no hace falta comprobarlo antes: si el procesador no tiene AVX,
al prender el cluster con MongoDB el log dice `AVISO: este procesador no tiene
AVX` y sigue sin MongoDB. Las Mac M1–M4 siempre andan.

## Paso 2. Tener la imagen

Hay tres formas. Las tres terminan igual: una imagen llamada
`franki678/bigdata-sandbox` en tu compu.

### A) Bajarla de Docker Hub (en tu casa)

<!-- prueba: no (en la prueba ya esta la imagen a probar: un pull la pisaria con la publicada) -->
```bash
docker pull franki678/bigdata-sandbox
```

- Baja ~1,4 GB. Sirve para Windows, Linux y Mac: Docker elige sola la versión
  de tu procesador (Intel/AMD o ARM).
- No hace falta cuenta ni `docker login`.
- Sin tag (`franki678/bigdata-sandbox`) es `:latest`, que es la versión
  `base`. Las otras versiones están en el [README](../README.md#versiones-de-la-imagen).

### B) En el aula: el archivo del profesor

Si 20 PCs bajan la imagen a la vez se satura la conexión y Docker Hub corta
las descargas sin cuenta. Por eso la imagen está lista en **un solo archivo**,
para Intel/AMD (Windows o Linux), que se actualiza cada vez que cambia la
`latest`:

https://github.com/Franki-678/bigdata-sandbox/releases/download/imagen/bigdata-sandbox.tar.gz

**1. La PC del profesor lo baja** con el navegador (~1,4 GB; queda en
Descargas). Si esa PC se borra al reiniciar, conviene tenerlo en un pendrive.

**2. Lo reparte**, de alguna de estas formas:

- **Veyon:** en Veyon Master, seleccionar todas las PCs → *Transferencia de
  archivos* → elegir `bigdata-sandbox.tar.gz` → *Solo transferir*. Queda en la
  carpeta del usuario de cada PC (`C:\Users\<usuario>`).
- **Pendrive:** copiarlo a la carpeta del usuario. Entra en uno de 4 GB,
  aunque esté en FAT32.
- **Por la red, desde la PC del profesor** (necesita la imagen ya cargada en
  esa PC, paso 3): abrir la carpeta Descargas, escribir `cmd` en la barra de
  dirección del Explorador, Enter, y ahí:

  <!-- prueba: no (CMD de Windows; deja un servidor prendido) -->
  ```bat
  docker run -d --rm --name compartir -p 8000:8000 -v "%cd%:/srv:ro" -w /srv --entrypoint python3 franki678/bigdata-sandbox -m http.server 8000
  ipconfig
  ```

  De `ipconfig` anotá la *Dirección IPv4* (por ejemplo `192.168.1.10`). Si
  Windows pregunta por el firewall: *Permitir*. Cada alumno lo baja con
  (cambiando la IP):

  <!-- prueba: no (necesita la PC del profesor en la red) -->
  ```bat
  curl.exe -o bigdata-sandbox.tar.gz http://192.168.1.10:8000/bigdata-sandbox.tar.gz
  ```

  Al terminar, el profesor lo corta con `docker stop compartir`.

**3. Cada alumno lo carga en Docker**, con Docker Desktop abierto, en una
terminal nueva (arranca en la carpeta del usuario, donde quedó el archivo):

<!-- prueba: no (en la prueba la imagen ya esta cargada; el archivo lo prueba aula.yml antes de subirlo) -->
```bash
docker load -i bigdata-sandbox.tar.gz
```

Tarda 1-2 min y termina con `Loaded image: franki678/bigdata-sandbox:latest`.
Después ya no hace falta el archivo: se puede borrar.

### C) Pasarla entre compañeros

El que la tiene la guarda en un archivo y los demás la cargan:

<!-- prueba: no (escribe un archivo de varios GB) -->
```bash
docker save franki678/bigdata-sandbox -o bigdata-sandbox.tar
docker load -i bigdata-sandbox.tar
```

## Paso 3. Comprobar que la imagen está

<!-- prueba: compu | espera: franki678/bigdata-sandbox -->
```bash
docker image ls franki678/bigdata-sandbox
```

Tiene que aparecer una línea con `franki678/bigdata-sandbox` y `latest`.
Listo: ya podés [arrancar el cluster](02-arrancar-y-apagar.md).

## Actualizarla más adelante

Cuando hay una versión nueva: el mismo `docker pull` (o cargar el archivo
nuevo del aula) y recrear el contenedor como dice
[Cambiar los parámetros](02-arrancar-y-apagar.md#cambiar-los-parámetros). Tus
datos de HDFS, Hive, MySQL y MongoDB quedan en el volumen.

¿Tenés cargada la imagen de antes de octubre de 2026 (Ubuntu 20.04, sin
MongoDB)? Mirá [Venís de la imagen anterior](11-problemas.md#venís-de-la-imagen-anterior).
