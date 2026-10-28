<# : empresa-profe.cmd - BigData Sandbox, el cluster del aula: PC del profe (ver guias/empresa/03-laboratorio.md)
@echo off
rem Uso:
rem   empresa-profe.cmd                      arranca el maestro (o muestra el que ya anda): IP, codigo y la linea para Veyon
rem   empresa-profe.cmd cargar RUTA [HDFS]   sube un archivo o una carpeta (pendrive o carpeta compartida) a HDFS, midiendo
rem   empresa-profe.cmd estado               como esta el cluster
rem   empresa-profe.cmd apagar               apaga el maestro en orden (los datos quedan hasta el reset)
rem   empresa-profe.cmd cero                 borra el maestro y su HDFS y arranca de nuevo (otra clase)
rem   empresa-profe.cmd hardware             solo muestra los datos de esta PC (sin Docker)
rem Publica UDP 51820 (el tunel) y TCP 8099 (la inscripcion de las PCs): el firewall de Windows pregunta una vez.
rem La interfaz queda en http://localhost:8080 (vista Aula), solo para esta PC.
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
$imagen = 'franki678/bigdata-sandbox:empresa'
$archivoImagen = 'bigdata-sandbox-empresa.tar.gz'
$archivoTrabajador = 'bigdata-sandbox-trabajador.tar.gz'
$contenedor = 'bigdata-maestro'
$volumen = 'bigdata_aula'

$argumentos = @(("$env:AULA_ARGS" -split '\s+') | Where-Object { $_ })
$modo = 'arrancar'
if ($argumentos.Count -ge 1 -and $argumentos[0] -match '^(cargar|estado|apagar|cero|hardware)$') { $modo = $argumentos[0] }
$carpeta = "$env:AULA_DIR".TrimEnd('\')
$datos = Join-Path $env:USERPROFILE 'bigdata-aula'
New-Item -ItemType Directory -Force -Path $datos | Out-Null

function Decir($t) { Write-Host "[aula] $t" }
function Linea { Write-Host ('=' * 66) }

function IpDeLaPc {
    try {
        $c = Get-NetIPConfiguration -ErrorAction Stop |
            Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
        if ($c) { return @($c.IPv4Address)[0].IPAddress }
    } catch {}
    try {
        $a = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback|Docker' } |
            Select-Object -First 1
        if ($a) { return $a.IPAddress }
    } catch {}
    return ''
}

function TodasLasIps {
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Loopback' } |
            ForEach-Object { "$($_.IPAddress) ($($_.InterfaceAlias))" }
    } catch {}
}

function Hardware {
    $d = [ordered]@{}
    $d.nombre = $env:COMPUTERNAME
    $d.ip_pc = IpDeLaPc
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
    Decir 'Docker Desktop no termino de arrancar. Abrilo a mano, espera a que diga que anda, y volve a correr esto.'
    return $false
}

function ImagenCargada { docker image inspect $imagen *> $null; return ($LASTEXITCODE -eq 0) }

function BuscarArchivo($nombre) {
    $lugares = @($carpeta, $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Desktop'),
        [Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'Documents'))
    foreach ($l in $lugares) {
        if ($l) { $f = Join-Path $l $nombre; if (Test-Path $f) { return $f } }
    }
    return $null
}

function Contenedor {   # 'corriendo', 'parado' o 'no'
    $e = "$(docker inspect -f '{{.State.Running}}' $contenedor 2>$null)".Trim()
    if ($LASTEXITCODE -ne 0) { return 'no' }
    if ($e -eq 'true') { return 'corriendo' }
    return 'parado'
}

function EnElMaestro([string]$comando) { docker exec $contenedor bash -c $comando 2>$null }

# La carpeta de esta PC vista desde las PCs: Veyon deja los archivos en la misma carpeta de donde se mandan
function CarpetaParaVeyon {
    $u = $env:USERPROFILE.TrimEnd('\')
    if ($carpeta.StartsWith($u, [StringComparison]::OrdinalIgnoreCase)) { return '%USERPROFILE%' + $carpeta.Substring($u.Length) }
    return $carpeta
}

function CodigoNuevo {
    $letras = 'ACDEFHJKMNPRTUVWXY34679'
    -join (1..4 | ForEach-Object { $letras[(Get-Random -Maximum $letras.Length)] })
}

function Arrancar {
    $d = Hardware
    Decir "PC del profe $($d.nombre), IP $($d.ip_pc), $($d.ram_gb) GB de RAM, $($d.cpu)"
    if (-not (DockerAnda)) { exit 1 }
    $ram = [math]::Round([double]"$(docker info --format '{{.MemTotal}}' 2>$null)" / 1MB)
    Decir "Docker tiene $ram MB"
    if ($ram -lt 6000) { Decir "OJO: el maestro usa unos 5 a 6 GB y Docker tiene $ram MB: puede quedarse corto." }

    if (-not (ImagenCargada)) {
        $tar = BuscarArchivo $archivoImagen
        if ($tar) {
            Decir "Cargando la imagen del maestro desde $tar (1,6 GB: unos minutos)..."
            $t = Measure-Command { docker load -i $tar | Out-Host }
            Decir ("Imagen cargada en {0:N0} s" -f $t.TotalSeconds)
        } else {
            Decir "No esta $archivoImagen al lado de este .cmd: la bajo de Docker Hub (hace falta internet)..."
            docker pull $imagen | Out-Host
        }
        if (-not (ImagenCargada)) { Decir "No se pudo cargar $imagen."; exit 1 }
    }
    $trab = Join-Path $carpeta $archivoTrabajador
    $alumno = Join-Path $carpeta 'empresa-alumno.cmd'
    foreach ($f in @($trab, $alumno)) {
        if (-not (Test-Path $f)) { Decir "OJO: falta $(Split-Path $f -Leaf) en esta carpeta: Veyon tiene que mandarlo desde aca." }
    }

    $estado = Contenedor
    if ($estado -eq 'parado') {
        Decir 'El maestro estaba apagado: lo prendo (con lo que tenia).'
        docker start $contenedor | Out-Null
    } elseif ($estado -eq 'no') {
        $codigo = CodigoNuevo
        $ip = $d.ip_pc
        if (-not $ip) { Decir 'No encuentro la IP de esta PC en la red del aula (sin red?).'; exit 1 }
        docker run --rm --device /dev/net/tun --entrypoint true $imagen *> $null
        $tun = @()
        if ($LASTEXITCODE -eq 0) { $tun = @('--device', '/dev/net/tun') }
        $local = @()
        foreach ($p in @(8080, 9870, 8088, 19888, 18080, 10000, 8888)) { $local += @('-p', "127.0.0.1:$($p):$($p)") }
        $dargs = @('run', '-d', '--name', $contenedor, '--hostname', 'maestro', '--cap-add', 'NET_ADMIN') + $tun + @(
            '--sysctl', 'net.ipv4.ip_forward=1', '--stop-timeout', '20',
            '-p', '51820:51820/udp', '-p', '8099:8099') + $local + @(
            '-v', "$($volumen):/hadoop", '-v', "$($datos):/datos",
            '-e', 'ROL=maestro', '-e', 'RED=wireguard', '-e', "CODIGO=$codigo", '-e', "IP_AULA=$ip",
            '-e', "PC_NOMBRE=$($d.nombre)", '-e', "CARPETA_VEYON=$(CarpetaParaVeyon)", $imagen)
        & docker @dargs | Out-Null
        if ($LASTEXITCODE -ne 0) { Decir 'No se pudo crear el maestro (mira el mensaje de Docker arriba).'; exit 1 }
        Decir 'Maestro creado: arranca el tunel, la inscripcion y despues Hadoop.'
    }
    # El codigo y la linea los guarda el contenedor (son los mismos aunque se corra esto otra vez)
    $codigo = ''
    for ($i = 0; $i -lt 60 -and -not $codigo; $i++) {
        $codigo = "$(EnElMaestro 'cat /hadoop/aula/codigo')".Trim()
        if (-not $codigo) {
            if ((Contenedor) -ne 'corriendo') { docker logs --tail 30 $contenedor; Decir 'El maestro se apago solo (arriba, lo que dijo).'; exit 1 }
            Start-Sleep 1
        }
    }
    if (-not $codigo) { docker logs --tail 30 $contenedor; Decir 'El maestro no abrio la inscripcion.'; exit 1 }
    $ip = "$(EnElMaestro 'echo $IP_AULA')".Trim()
    $linea = "cmd /c `"`"$(CarpetaParaVeyon)\empresa-alumno.cmd`" $ip $codigo`""

    Write-Host ''
    Linea
    Write-Host '  BigData Sandbox - el cluster del aula'
    Write-Host "    IP de esta PC en el aula: $ip"
    Write-Host "    Codigo de la clase:       $codigo"
    Write-Host '  En Veyon, con las PCs seleccionadas:'
    Write-Host "    1. Transferencia de archivos: $archivoTrabajador y empresa-alumno.cmd"
    Write-Host "       (desde esta carpeta: $carpeta)"
    Write-Host '    2. Ejecutar programa:'
    Write-Host "       $linea"
    Write-Host '  Interfaz (vista Aula): http://localhost:8080/#aula'
    Linea
    Write-Host 'IPs de esta PC (si la de arriba no es la de la red del aula, cambiala en la linea):'
    TodasLasIps | ForEach-Object { Write-Host "   $_" }
    Set-Content -Path (Join-Path $datos 'veyon.txt') -Value $linea -Encoding ASCII
    Write-Host "(la linea queda tambien en $(Join-Path $datos 'veyon.txt'), para copiar y pegar)"
    Write-Host ''

    # Hasta que Hadoop esta listo (en el primer arranque, 2 a 4 minutos)
    if (-not ((docker logs $contenedor 2>&1 | Out-String) -match 'Cluster LISTO')) {
        Decir 'Esperando a que arranque Hadoop en el maestro (2 a 4 minutos la primera vez)...'
        $t0 = Get-Date
        while ($true) {
            Start-Sleep 5
            $l = docker logs $contenedor 2>&1 | Out-String
            if ($l -match 'Cluster LISTO') { break }
            if ((Contenedor) -ne 'corriendo') { docker logs --tail 40 $contenedor; Decir 'El maestro se apago solo.'; exit 1 }
            if (((Get-Date) - $t0).TotalMinutes -gt 10) { Decir 'Tarda mas de 10 minutos: mira docker logs bigdata-maestro'; break }
        }
        Decir ("Maestro listo en {0:N0} s." -f ((Get-Date) - $t0).TotalSeconds)
    } else {
        Decir 'El maestro ya estaba andando.'
    }
    Start-Process 'http://localhost:8080/#aula'
    Decir 'Ya podes mandar el .cmd por Veyon. Esta ventana se puede cerrar: el maestro sigue andando.'
}

function Cargar {
    if ($argumentos.Count -lt 2) { Write-Host 'Uso: empresa-profe.cmd cargar RUTA [CARPETA_EN_HDFS]   (un archivo o una carpeta)'; exit 2 }
    $origen = $argumentos[1]
    if (-not (Test-Path $origen)) { Decir "No existe $origen"; exit 1 }
    if ((Contenedor) -ne 'corriendo') { Decir 'El maestro no esta andando: primero empresa-profe.cmd'; exit 1 }
    $item = Get-Item $origen
    $destino = $(if ($argumentos.Count -ge 3) { $argumentos[2] } else { '/aula/datos/' + $item.Name })
    if ($item.PSIsContainer) {
        $archivos = @(Get-ChildItem $origen -File -Recurse)
        $base = $item.FullName.TrimEnd('\')
    } else {
        $archivos = @($item)
        $base = $item.DirectoryName.TrimEnd('\')
        if ($argumentos.Count -lt 3) { $destino = '/aula/datos' }
    }
    $total = ($archivos | Measure-Object Length -Sum).Sum
    Decir ("{0} archivo(s), {1:N0} MB, de {2} a HDFS {3}" -f $archivos.Count, ($total / 1MB), $origen, $destino)
    $rep = "$(EnElMaestro 'hdfs getconf -confKey dfs.replication')".Trim()
    Decir "Replicacion $($rep): cada bloque va a una PC y al maestro (la copia del maestro no pasa por la red)."
    $t0 = Get-Date
    $hechos = 0
    foreach ($a in $archivos) {
        $rel = $a.FullName.Substring($base.Length).TrimStart('\') -replace '\\', '/'
        $dest = ($destino.TrimEnd('/') + '/' + $rel)
        $dir = $dest.Substring(0, $dest.LastIndexOf('/'))
        EnElMaestro "hdfs dfs -mkdir -p '$dir'" | Out-Null
        $t = Measure-Command {
            # cmd /c con '<': pasa el archivo tal cual (binario), aunque este en un pendrive o en \\servidor\carpeta
            cmd /c "docker exec -i $contenedor hdfs dfs -put -f - `"$dest`" < `"$($a.FullName)`""
        }
        if ($LASTEXITCODE -ne 0) { Decir "Fallo al subir $($a.FullName)"; exit 1 }
        $hechos += $a.Length
        $mbs = $(if ($t.TotalSeconds -gt 0) { $a.Length / 1MB / $t.TotalSeconds } else { 0 })
        Decir ("{0}: {1:N1} MB en {2:N1} s ({3:N1} MB/s, {4:N0} Mbit/s)" -f $rel, ($a.Length / 1MB), $t.TotalSeconds, $mbs, ($mbs * 8.39))
    }
    $s = ((Get-Date) - $t0).TotalSeconds
    $mbs = $(if ($s -gt 0) { $hechos / 1MB / $s } else { 0 })
    Linea
    Decir ("Listo: {0:N0} MB en {1:N0} s = {2:N1} MB/s ({3:N0} Mbit/s)" -f ($hechos / 1MB), $s, $mbs, ($mbs * 8.39))
    Decir 'Como quedaron repartidos los bloques (cuantos tiene cada PC):'
    EnElMaestro "/opt/sandbox/aula/bloques.sh '$destino'" | Out-Host
    Add-Content -Path (Join-Path $datos 'cargas.txt') -Value ("{0:yyyy-MM-dd HH:mm} {1} -> {2}: {3:N0} MB en {4:N0} s ({5:N1} MB/s)" -f (Get-Date), $origen, $destino, ($hechos / 1MB), $s, $mbs)
    Decir "(anotado en $(Join-Path $datos 'cargas.txt'))"
}

switch ($modo) {
    'hardware' {
        $d = Hardware
        $d.docker = $(if (DockerAnda -sinAbrir) { 'si' } else { 'no (cerrado o no instalado)' })
        $d.carpeta_veyon = CarpetaParaVeyon
        $d.Keys | ForEach-Object { Write-Host "$_=$($d[$_])" }
        exit 0
    }
    'estado' {
        if (-not (DockerAnda)) { exit 1 }
        if ((Contenedor) -ne 'corriendo') { Decir 'El maestro no esta andando.'; exit 1 }
        docker exec $contenedor estado
        exit 0
    }
    'apagar' {
        if (-not (DockerAnda -sinAbrir)) { exit 0 }
        Decir 'Apagando el maestro en orden (hasta 20 s)...'
        docker stop -t 20 $contenedor | Out-Null
        Decir 'Apagado. Lo que tenia HDFS sigue en el volumen hasta el reset de la PC.'
        exit 0
    }
    'cero' {
        if (-not (DockerAnda)) { exit 1 }
        Decir 'Esto borra el maestro y TODO lo que tiene HDFS. Las PCs se vuelven a sumar con el codigo nuevo.'
        $r = Read-Host 'Escribi SI para seguir'
        if ($r -ne 'SI') { Decir 'No se borro nada.'; exit 0 }
        docker rm -f $contenedor *> $null
        docker volume rm $volumen *> $null
        Decir 'Borrado. Arranco de nuevo:'
        Arrancar
        exit 0
    }
    'cargar' { if (-not (DockerAnda)) { exit 1 }; Cargar; exit 0 }
    default { Arrancar; exit 0 }
}
