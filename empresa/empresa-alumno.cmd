<# : empresa-alumno.cmd - BigData Sandbox, el cluster del aula: PC de alumno (ver guias/empresa/03-laboratorio.md)
@echo off
rem Uso:
rem   empresa-alumno.cmd IP_DEL_PROFE CODIGO [CARPETA]   suma esta PC al cluster del aula
rem   empresa-alumno.cmd estado                          como esta esta PC en el cluster
rem   empresa-alumno.cmd salir                           saca esta PC del cluster (apaga su contenedor)
rem   empresa-alumno.cmd hardware                        solo muestra los datos de esta PC (sin Docker)
rem CARPETA: donde buscar bigdata-sandbox-trabajador.tar.gz si no esta al lado de este .cmd
rem (por ejemplo la carpeta compartida de solo lectura: \\SERVIDOR\Compartida\bigdata).
rem No publica ningun puerto ni pide permisos de administrador: solo sale hacia la PC del profe.
setlocal
chcp 65001 > nul
set "AULA_DIR=%~dp0"
set "AULA_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText('%~f0'))"
set "RC=%ERRORLEVEL%"
if not defined AULA_SIN_PAUSA pause
exit /b %RC%
#>

# ---- Desde aca es PowerShell (el bloque de arriba es un comentario para PowerShell) ----
$ErrorActionPreference = 'Continue'
$imagen = 'franki678/bigdata-sandbox:trabajador'
$contenedor = 'bigdata-trabajador'
$archivoImagen = $(if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'bigdata-sandbox-trabajador-arm64.tar.gz' } else { 'bigdata-sandbox-trabajador.tar.gz' })

$argumentos = @(("$env:AULA_ARGS" -split '\s+') | Where-Object { $_ })
$modo = 'sumar'
if ($argumentos.Count -ge 1 -and $argumentos[0] -match '^(estado|salir|hardware)$') { $modo = $argumentos[0] }
$carpeta = "$env:AULA_DIR".TrimEnd('\')
$datos = Join-Path $env:USERPROFILE 'bigdata-aula'
New-Item -ItemType Directory -Force -Path $datos | Out-Null

function Decir($t) { Write-Host "[aula] $t" }
function Linea { Write-Host ('=' * 66) }

function Hardware {
    $d = [ordered]@{}
    $d.nombre = $env:COMPUTERNAME
    try { $d.ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB) } catch {}
    try {
        $p = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
        $d.cpu = "$($p[0].Name)".Trim()
        $d.nucleos = ($p | Measure-Object NumberOfLogicalProcessors -Sum).Sum
    } catch {}
    return $d
}

# Docker andando: si Docker Desktop esta cerrado lo abre (instalado para todos o para el usuario) y espera
function DockerAnda([switch]$sinAbrir) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Decir 'Docker no esta instalado en esta PC.'; return $false }
    docker version --format '{{.Server.Version}}' *> $null
    if ($LASTEXITCODE -eq 0) { return $true }
    if ($sinAbrir) { return $false }
    $exes = @((Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
              (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'))
    $exe = $exes | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $exe) { Decir 'Docker no contesta y no encuentro Docker Desktop para abrirlo.'; return $false }
    Decir 'Docker Desktop no esta andando: lo abro y espero (hasta 3 minutos)...'
    Start-Process $exe
    for ($i = 0; $i -lt 36; $i++) {
        Start-Sleep 5
        docker version --format '{{.Server.Version}}' *> $null
        if ($LASTEXITCODE -eq 0) { return $true }
    }
    Decir 'Docker Desktop no termino de arrancar en 3 minutos. Avisale al profe.'
    return $false
}

function ImagenCargada { docker image inspect $imagen *> $null; return ($LASTEXITCODE -eq 0) }

# El .tar.gz de la imagen: en la carpeta que se paso (puede ser \\servidor\carpeta), al lado de
# este .cmd (Veyon lo deja en la misma carpeta de donde lo mando el profe) o en las de siempre
function BuscarImagen($extra) {
    if ($extra -and (Test-Path $extra -PathType Leaf)) { return $extra }
    $lugares = @($extra, $carpeta, $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Desktop'),
        [Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'Documents'))
    foreach ($l in $lugares) {
        if ($l) { $f = Join-Path $l $archivoImagen; if (Test-Path $f) { return $f } }
    }
    return $null
}

function Contenedor {   # 'corriendo', 'parado' o 'no'
    $e = "$(docker inspect -f '{{.State.Running}}' $contenedor 2>$null)".Trim()
    if ($LASTEXITCODE -ne 0) { return 'no' }
    if ($e -eq 'true') { return 'corriendo' }
    return 'parado'
}

function Variable($nombre) {   # una variable del contenedor que ya existe
    $vars = docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $contenedor 2>$null
    $l = $vars | Where-Object { $_ -like "$nombre=*" } | Select-Object -First 1
    if ($l) { return $l.Substring($nombre.Length + 1) }
    return ''
}

function Sumar {
    if ($argumentos.Count -lt 2) {
        Write-Host 'Uso: empresa-alumno.cmd IP_DEL_PROFE CODIGO [CARPETA]   (los dos los muestra la PC del profe)'
        exit 2
    }
    $profe = $argumentos[0]
    $codigo = $argumentos[1].ToUpper()
    $extra = $(if ($argumentos.Count -ge 3) { $argumentos[2] } else { '' })
    $d = Hardware
    Decir "PC $($d.nombre): $($d.ram_gb) GB de RAM, $($d.cpu), $($d.nucleos) hilos"
    if (-not (DockerAnda)) { exit 1 }
    $ram = [math]::Round([double]"$(docker info --format '{{.MemTotal}}' 2>$null)" / 1MB)
    Decir "Docker tiene $ram MB"

    # Si ya esta sumada a esta misma clase, no se toca nada
    if ((Contenedor) -eq 'corriendo' -and (Variable 'MAESTRO') -eq $profe -and (Variable 'CODIGO') -eq $codigo) {
        Decir 'Esta PC ya esta en el cluster del aula:'
        docker exec $contenedor estado
        exit 0
    }

    $carga = ''
    if (-not (ImagenCargada)) {
        $tar = BuscarImagen $extra
        if (-not $tar) {
            Decir "No esta la imagen cargada ni el archivo $archivoImagen (al lado de este .cmd, en $extra o en la carpeta del usuario)."
            Decir 'Pedile al profe que lo mande por Veyon a la misma carpeta que este .cmd.'
            exit 1
        }
        $mb = [math]::Round((Get-Item $tar).Length / 1MB)
        Decir "Cargando la imagen ($mb MB) desde $tar ..."
        $t = Measure-Command { docker load -i $tar | Out-Host }
        $carga = [math]::Round($t.TotalSeconds)
        if (-not (ImagenCargada)) { Decir 'No se pudo cargar la imagen.'; exit 1 }
        Decir "Imagen cargada en $carga s"
    }

    docker rm -fv $contenedor *> $null
    # Primero el numero de esta PC en la clase (pcNN): el contenedor se tiene que llamar asi,
    # porque Tez y Spark se anuncian con el nombre de la maquina. Va por el mismo camino que
    # despues usa el tunel (si el profe todavia no arranco, espera hasta 10 minutos)
    Decir "Pidiendo el numero de esta PC a la del profe ($profe, codigo $codigo)..."
    $nodo = ''
    docker run --rm --entrypoint /opt/sandbox/aula/red.sh -e RED=wireguard -e ROL=trabajador `
        -e "MAESTRO=$profe" -e "CODIGO=$codigo" -e "PC_NOMBRE=$($d.nombre)" $imagen reservar 2>&1 | ForEach-Object {
        $l = "$_"
        if ($l -match '^NODO=(pc\d+)') { $nodo = $Matches[1] } elseif ($l -match 'ERROR|no contesta') { Write-Host $l }
    }
    if (-not $nodo) { Decir 'No se pudo pedir el numero (arriba dice por que).'; exit 1 }
    Decir "Esta PC va a ser $nodo en el cluster del aula."
    # wireguard-go necesita /dev/net/tun (si el kernel de Docker no trae el modulo WireGuard)
    docker run --rm --device /dev/net/tun --entrypoint true $imagen *> $null
    $tun = @()
    if ($LASTEXITCODE -eq 0) { $tun = @('--device', '/dev/net/tun') }
    $dargs = @('run', '-d', '--name', $contenedor, '--hostname', $nodo, '--cap-add', 'NET_ADMIN') + $tun + @(
        '--stop-timeout', '20',
        '-e', 'RED=wireguard', '-e', "MAESTRO=$profe", '-e', "CODIGO=$codigo",
        '-e', "PC_NOMBRE=$($d.nombre)", '-e', "PC_RAM_GB=$($d.ram_gb)", '-e', "PC_CPU=$($d.cpu)", $imagen)
    & docker @dargs | Out-Null
    if ($LASTEXITCODE -ne 0) { Decir 'No se pudo crear el contenedor (mira el mensaje de Docker arriba).'; exit 1 }

    # Se inscribe en el profe, levanta el tunel y prende el DataNode y el NodeManager
    Decir "Sumandose al cluster del aula (profe $profe, codigo $codigo)..."
    $t0 = Get-Date
    $nodo = ''
    while ($true) {
        Start-Sleep 3
        $l = docker logs $contenedor 2>&1 | Out-String
        if (-not $nodo -and $l -match 'Esta PC es (pc\d+) en el cluster del aula: IP del tunel ([0-9.]+)') {
            $nodo = $Matches[1]
            Decir "Inscripta: esta PC es $nodo (IP del tunel $($Matches[2])). Prendiendo el DataNode y el NodeManager..."
        }
        if ($l -match 'Cluster LISTO') { break }
        if ((Contenedor) -ne 'corriendo') {
            ($l -split "`n") | Where-Object { $_ -match 'ERROR' } | ForEach-Object { Write-Host $_ }
            Decir 'No se pudo sumar esta PC (arriba dice por que).'
            exit 1
        }
        if (((Get-Date) - $t0).TotalMinutes -gt 12) {
            docker logs --tail 15 $contenedor
            Decir 'Tarda mas de 12 minutos: el maestro sigue arrancando o no llega. Avisale al profe.'
            exit 1
        }
    }
    $s = [math]::Round(((Get-Date) - $t0).TotalSeconds)
    Write-Host ''
    Linea
    docker exec $contenedor estado | Select-Object -First 9
    Linea
    Decir "Lista en $s s$(if ($carga) { " (mas $carga s de cargar la imagen)" })."
    Decir 'Ya se puede cerrar esta ventana: la PC sigue en el cluster hasta que se apague.'
    Add-Content -Path (Join-Path $datos 'aula.txt') -Value ("{0:yyyy-MM-dd HH:mm} {1} {2} profe={3} carga_imagen_s={4} sumada_s={5}" -f (Get-Date), $d.nombre, $nodo, $profe, $carga, $s)
}

switch ($modo) {
    'hardware' {
        $d = Hardware
        $d.docker = $(if (DockerAnda -sinAbrir) { 'si' } else { 'no (cerrado o no instalado)' })
        $d.imagen = $archivoImagen
        $d.Keys | ForEach-Object { Write-Host "$_=$($d[$_])" }
        exit 0
    }
    'estado' {
        if (-not (DockerAnda -sinAbrir)) { Decir 'Docker no esta andando.'; exit 1 }
        if ((Contenedor) -ne 'corriendo') { Decir 'Esta PC no esta en el cluster.'; exit 1 }
        docker exec $contenedor estado
        exit 0
    }
    'salir' {
        if (-not (DockerAnda -sinAbrir)) { exit 0 }
        docker stop -t 20 $contenedor *> $null
        docker rm -v $contenedor *> $null
        Decir 'Esta PC salio del cluster (HDFS copia en otras PCs lo que tenia).'
        exit 0
    }
    default { Sumar; exit 0 }
}
