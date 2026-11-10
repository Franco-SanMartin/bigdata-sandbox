# 6. Plan B: si falla el release

Qué hacer si algo del release [`aula-v2`](https://github.com/Franco-SanMartin/bigdata-sandbox/releases/tag/aula-v2)
no está o no anda. Va de lo más probable a lo menos.

[← Índice de `empresa`](README.md) · [3. El laboratorio](03-laboratorio.md)

## Lo que tiene que haber

| Archivo | Tamaño | Lo usa |
|---|---|---|
| `bigdata-sandbox-empresa.tar.gz` | 1.582.406.787 bytes | `empresa-profe.cmd` (imagen `franki678/bigdata-sandbox:empresa`) |
| `bigdata-sandbox-trabajador.tar.gz` | 190.964.819 bytes | `empresa-alumno.cmd` (imagen `franki678/bigdata-sandbox:empresa-trabajador`) |
| `bigdata-sandbox-trabajador-arm64.tar.gz` | 185.787.119 bytes | `empresa-alumno.cmd` en una PC ARM |
| `empresa-profe.cmd`, `empresa-alumno.cmd` | 15 KB y 11 KB | |

Si un `.tar.gz` pesa distinto, la descarga quedó cortada: bajarlo de nuevo.

## 1. No se puede bajar el release desde el navegador

Con la [CLI de GitHub](https://cli.github.com/) (pide estar logueado) o,
sin cuenta, con `curl` (el repo es público):

<!-- prueba: no (baja ~2 GB) -->
```bash
gh release download aula-v2 --repo Franco-SanMartin/bigdata-sandbox --dir aula-v2
# o, sin gh, archivo por archivo:
curl -LO https://github.com/Franco-SanMartin/bigdata-sandbox/releases/download/aula-v2/bigdata-sandbox-trabajador.tar.gz
```

En PowerShell, `curl.exe` (con `.exe`) en vez de `curl`.

## 2. Los `.cmd`: sacarlos del repo

Si faltan los `.cmd` del release, están en el repo en
[`empresa/`](../../empresa/). **No los bajes con el botón *Raw***: GitHub
los da con saltos de línea de Linux y `cmd.exe` se confunde. Dos formas que
andan:

- En GitHub, **Code → Download ZIP** del repo, y sacar del ZIP
  `empresa/empresa-profe.cmd` y `empresa/empresa-alumno.cmd`.
- O con git en Windows: `git clone https://github.com/Franco-SanMartin/bigdata-sandbox`
  (el `.gitattributes` del repo los deja con los saltos de Windows).

Los `.cmd` buscan la imagen **al lado del `.cmd`**, en la carpeta del
usuario, el Escritorio, Descargas y Documentos, con el nombre exacto de la
tabla de arriba.

## 3. Falta el `.tar.gz` de las PCs pero hay una PC que ya lo tiene cargado

Si alguna PC ya tiene la imagen (por ejemplo la del profe, después de una
prueba), se puede volver a armar el archivo con `docker save`:

<!-- prueba: no (cmd en Windows) -->
```bat
docker save -o bigdata-sandbox-trabajador.tar.gz franki678/bigdata-sandbox:empresa-trabajador
```

Sale **sin comprimir** (más grande que los 192 MB del release; tarda más en
Veyon), pero `docker load` lo lee igual aunque se llame `.tar.gz`: mira el
contenido, no el nombre. Con el nombre exacto, `empresa-alumno.cmd` lo
encuentra solo. Lo mismo para el maestro:

<!-- prueba: no (cmd en Windows) -->
```bat
docker save -o bigdata-sandbox-empresa.tar.gz franki678/bigdata-sandbox:empresa
```

Desde Linux o Mac, comprimido como el del release:

<!-- prueba: no -->
```bash
docker save franki678/bigdata-sandbox:empresa-trabajador | gzip > bigdata-sandbox-trabajador.tar.gz
```

Para ver si una PC la tiene: `docker image ls franki678/bigdata-sandbox`.

## 4. Faltan las imágenes y hay internet

Sin los `.tar.gz`, los dos `.cmd` bajan su imagen de Docker Hub (hace
falta internet en esa PC): `empresa-profe.cmd` baja
`franki678/bigdata-sandbox:empresa` y `empresa-alumno.cmd` baja
`franki678/bigdata-sandbox:empresa-trabajador`. Son las mismas imágenes del
release cuando salieron de la misma corrida del workflow *Empresa* (el
release dice de qué commit es; la página del tag en Docker Hub, la fecha).
Antes de sumar las PCs, verificar con la [guía 9](09-verificacion-rapida.md).
Es plan B: depende de la salida a internet del laboratorio, que con 20 PCs
a la vez no está medida; repartir el `.tar.gz` por la red del aula no.

## 5. Armar las imágenes desde el repo (último recurso, en casa)

Con Docker en Linux (o WSL) y el repo clonado, el workflow *Empresa* del CI
es la receta. Lleva horas (baja Hadoop, Hive, Spark...) y depende de los
servidores de Apache: **no es para hacerlo en el aula**. Si el release
falta la noche antes, es más rápido relanzar el workflow *Empresa* desde
GitHub (Actions → Empresa → Run workflow, con *release* tildado), que lo
vuelve a armar, lo prueba y lo publica de nuevo como `aula-v2` (o el
`release_tag` que se ponga). Lo que tardó cada corrida está en la pestaña
Actions: entre 57 min y 2 h 10 min en las corridas del 27 al 29/10
(runs 40819945257 y 40714239592).

## 6. El túnel no levanta en ninguna PC

No es el release: es el firewall de la PC del profe. Ver la [hoja para
sistemas](07-hoja-para-sistemas.md). Mientras tanto se puede dar la clase
con el [aula simulada](01-aula-simulada.md) en la PC del profe (maestro y
dos PCs como contenedores, `RED=docker`), proyectada por Veyon. Usa la misma
imagen `:empresa` que ya cargó `empresa-profe.cmd`, pero pide unos 8 GB para
Docker.

[← 5. El dataset](05-dataset.md) · Siguiente: [7. Hoja para sistemas →](07-hoja-para-sistemas.md)
