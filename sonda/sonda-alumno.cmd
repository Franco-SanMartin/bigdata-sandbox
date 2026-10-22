<# : sonda-alumno.cmd - Sonda del laboratorio, PC de alumno (ver LEEME.md)
@echo off
rem Uso:
rem   sonda-alumno.cmd IP_DEL_PROFE          la prueba de la clase
rem   sonda-alumno.cmd dia2 [IP_DEL_PROFE]   al dia siguiente: solo anota si la imagen sigue cargada
rem   sonda-alumno.cmd hardware              solo junta los datos de la PC (sin Docker)
rem No pide permisos de administrador. Deja todo en %USERPROFILE%\sonda-resultados.
setlocal
chcp 65001 > nul
set "SONDA_DIR=%~dp0"
set "SONDA_ARGS=%*"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression ([IO.File]::ReadAllText('%~f0'))"
set "RC=%ERRORLEVEL%"
if not defined SONDA_SIN_PAUSA pause
exit /b %RC%
#>

# ---- Desde aca es PowerShell (el bloque de arriba es un comentario para PowerShell) ----
$ErrorActionPreference = 'Continue'
$imagen = 'bigdata-sandbox-sonda:v1'
$archivoImagen = 'bigdata-sandbox-sonda.tar.gz'
$puerto = 8098

$modo = 'clase'; $profe = ''
foreach ($a in @(("$env:SONDA_ARGS" -split '\s+') | Where-Object { $_ })) {
    if ($a -match '^(dia2|hardware)$') { $modo = $a } else { $profe = $a }
}
$salida = Join-Path $env:USERPROFILE 'sonda-resultados'
$carpetaYaEstaba = Test-Path $salida
New-Item -ItemType Directory -Force -Path $salida | Out-Null

function Decir($t) { Write-Host "[sonda] $t" }

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

function Hardware {
    $d = [ordered]@{}
    $d.nombre = $env:COMPUTERNAME
    $d.ip_pc = IpDeLaPc
    try { $d.perfil_red = (@(Get-NetConnectionProfile -ErrorAction Stop) | ForEach-Object { "$($_.InterfaceAlias): $($_.NetworkCategory)" }) -join ' / ' } catch {}
    try {
        $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
        $cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction SilentlyContinue
        $d.windows = ('{0} {1} (build {2})' -f $os.Caption, $cv.DisplayVersion, $os.BuildNumber).Trim()
    } catch { $d.windows = '?' }
    try { $d.ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem -ErrorAction Stop).TotalPhysicalMemory / 1GB) } catch {}
    try {
        $p = @(Get-CimInstance Win32_Processor -ErrorAction Stop)
        $d.cpu = "$($p[0].Name)".Trim()
        $d.nucleos = ($p | Measure-Object NumberOfLogicalProcessors -Sum).Sum
    } catch {}
    try { $d.gpu = (@(Get-CimInstance Win32_VideoController -ErrorAction Stop) | ForEach-Object { $_.Name }) -join ' / ' } catch {}
    return $d
}

# Docker andando (si Docker Desktop esta cerrado, lo abre y espera hasta 3 minutos)
function DockerAnda($d, [switch]$sinAbrir) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { $d.docker = 'no (no esta instalado)'; return $false }
    $v = docker version --format '{{.Server.Version}}' 2>&1
    if ($LASTEXITCODE -ne 0) {
        $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
        if ((Test-Path $exe) -and -not $sinAbrir) {
            Decir 'Docker Desktop no esta andando: lo abro y espero (hasta 3 minutos)...'
            Start-Process $exe
            for ($i = 0; $i -lt 36; $i++) {
                Start-Sleep 5
                $v = docker version --format '{{.Server.Version}}' 2>&1
                if ($LASTEXITCODE -eq 0) { break }
            }
        }
    }
    if ($LASTEXITCODE -ne 0) {
        $msg = (($v | Out-String) -replace '\s+', ' ').Trim()
        if ($msg.Length -gt 200) { $msg = $msg.Substring(0, 200) }
        $d.docker = "no ($msg)"
        return $false
    }
    $d.docker_desktop = "$(docker version --format '{{.Server.Platform.Name}}' 2>$null)".Trim()
    $i = "$(docker info --format '{{.MemTotal}}|{{.NCPU}}|{{.KernelVersion}}' 2>$null)" -split '\|'
    if ($i.Count -ge 3) {
        $d.docker_ram_mb = [math]::Round([double]$i[0] / 1MB)
        $d.docker_cpus = $i[1]
        $d.docker_kernel = $i[2]
    }
    return $true
}

function ImagenCargada { docker image inspect $imagen *> $null; return ($LASTEXITCODE -eq 0) }

function BuscarArchivoImagen {
    $lugares = @($env:SONDA_DIR, $env:USERPROFILE, (Join-Path $env:USERPROFILE 'Desktop'),
        [Environment]::GetFolderPath('Desktop'), (Join-Path $env:USERPROFILE 'Downloads'),
        (Join-Path $env:USERPROFILE 'Documents'))
    foreach ($l in $lugares) {
        if ($l) { $f = Join-Path $l $archivoImagen; if (Test-Path $f) { return $f } }
    }
    return $null
}

function Guardar($d, $ruta) {
    $lineas = foreach ($k in $d.Keys) { "$k=" + ("$($d[$k])" -replace '[\r\n]+', ' ') }
    [IO.File]::WriteAllLines($ruta, [string[]]$lineas)
}

# POST al profe; devuelve $true si contesto "ok"
function Mandar($ruta, $texto) {
    if (-not $profe) { return $false }
    try {
        [Net.WebRequest]::DefaultWebProxy = New-Object Net.WebProxy
        $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://$($profe):8099$ruta" `
            -Body ([Text.Encoding]::UTF8.GetBytes($texto)) -ContentType 'text/plain' -TimeoutSec 10
        return ("$($r.Content)" -match '^ok')
    } catch { return $false }
}

$d = Hardware
Decir "PC $($d.nombre), IP $($d.ip_pc), $($d.ram_gb) GB de RAM, $($d.cpu)"
Decir "GPU: $($d.gpu)"

if ($modo -eq 'hardware') {
    DockerAnda $d -sinAbrir | Out-Null
    Guardar $d (Join-Path $salida 'pc.txt')
    Get-Content (Join-Path $salida 'pc.txt')
    exit 0
}

if ($modo -eq 'dia2') {
    $hayDocker = DockerAnda $d
    $antes = 'no'
    if ($hayDocker -and (ImagenCargada)) { $antes = 'si' }
    $r = [ordered]@{ nombre = $d.nombre; fecha = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss');
        imagen_cargada_antes = $antes; carpeta_resultados = $(if ($carpetaYaEstaba) { 'si' } else { 'no' });
        docker = $(if ($hayDocker) { 'si' } else { $d.docker }) }
    $f = Join-Path $salida "sonda-dia2-$($d.nombre).txt"
    Guardar $r $f
    $texto = [IO.File]::ReadAllText($f)
    $enviado = Mandar '/cgi-bin/dia2' $texto
    Write-Host ''
    Write-Host '========= DIA SIGUIENTE ========='
    Write-Host "La imagen de la sonda seguia cargada: $antes"
    Write-Host "La carpeta sonda-resultados seguia:   $($r.carpeta_resultados)"
    Write-Host "Enviado al profe: $(if ($enviado) { 'si' } elseif ($profe) { 'no (no contesta)' } else { 'no (sin IP del profe)' })"
    Write-Host '================================='
    exit 0
}

# ---- La prueba de la clase ----
if (-not $profe) {
    Write-Host 'Falta la IP de la PC del profe:  sonda-alumno.cmd 192.168.X.Y'
    exit 2
}
$pcTxt = Join-Path $salida 'pc.txt'
if (-not (DockerAnda $d)) {
    Decir "Docker no anda en esta PC: $($d.docker)"
    $d.inscripcion = 'no'
    $d.notas = 'Docker no anda'
    Guardar $d (Join-Path $salida "sonda-$($d.nombre).txt")
    $ok = Mandar '/cgi-bin/resultado' ([IO.File]::ReadAllText((Join-Path $salida "sonda-$($d.nombre).txt")))
    Decir "Enviado al profe: $(if ($ok) { 'si' } else { 'no' })"
    exit 1
}
Decir "Docker: $($d.docker_desktop), $($d.docker_ram_mb) MB para Docker"

$d.imagen_cargada_antes = $(if (ImagenCargada) { 'si' } else { 'no' })
if ($d.imagen_cargada_antes -eq 'no') {
    $tar = BuscarArchivoImagen
    if (-not $tar) {
        Decir "No esta la imagen cargada ni el archivo $archivoImagen (al lado del .cmd, en la carpeta del usuario, Escritorio, Descargas o Documentos)."
        exit 1
    }
    Decir "Cargando la imagen desde $tar ..."
    $t = Measure-Command { docker load -i $tar | Out-Host }
    $d.carga_seg = [math]::Round($t.TotalSeconds)
    if (-not (ImagenCargada)) { Decir 'No se pudo cargar la imagen.'; exit 1 }
}

# Docker Desktop deja pasar /dev/net/tun al contenedor?
docker run --rm --device /dev/net/tun --entrypoint true $imagen *> $null
$tun = @()
if ($LASTEXITCODE -eq 0) { $d.tun_docker = 'si'; $tun = @('--device', '/dev/net/tun') } else { $d.tun_docker = 'no' }

Guardar $d $pcTxt
docker rm -f sonda-alumno *> $null
Decir "Arranca la prueba contra el profe ($profe). Tarda de 1 a 5 minutos."
$dargs = @('run', '--rm', '--name', 'sonda-alumno', '--cap-add', 'NET_ADMIN') + $tun + @(
    '-p', "$($puerto):$($puerto)", '-v', "$($salida):/salida",
    '-e', 'ROL=alumno', '-e', "MAESTRO=$profe", '-e', "PC_NOMBRE=$($d.nombre)",
    '-e', "IP_PC=$($d.ip_pc)", '-e', "PUERTO_PRUEBA=$puerto", $imagen)
& docker @dargs
Write-Host ''
Write-Host "Resultados de esta PC: $salida"
exit 0
