<# : sonda-profe.cmd - Sonda del laboratorio, PC del profe (ver LEEME.md)
@echo off
rem Uso:
rem   sonda-profe.cmd [CANTIDAD_DE_PCS]   arranca la sonda del profe (Ctrl+C para terminar)
rem   sonda-profe.cmd hardware            solo junta los datos de esta PC (sin Docker)
rem Publica UDP 51820 (WireGuard), UDP 51821 (eco) y TCP 8099 (inscripcion y resultados).
rem La planilla y el resumen quedan en %USERPROFILE%\sonda-profe.
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

$modo = 'clase'; $esperados = ''
foreach ($a in @(("$env:SONDA_ARGS" -split '\s+') | Where-Object { $_ })) {
    if ($a -eq 'hardware') { $modo = $a } elseif ($a -match '^\d+$') { $esperados = $a }
}
$datos = Join-Path $env:USERPROFILE 'sonda-profe'
New-Item -ItemType Directory -Force -Path $datos | Out-Null

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
    # Reglas de entrada del firewall para Docker (leerlas no pide admin; crearlas si)
    try {
        $reglas = @(Get-NetFirewallApplicationFilter -ErrorAction Stop |
            Where-Object { $_.Program -like '*com.docker*' -or $_.Program -like '*Docker Desktop*' } |
            Get-NetFirewallRule -ErrorAction Stop | Where-Object { "$($_.Direction)" -eq 'Inbound' })
        if ($reglas.Count) {
            $d.firewall_docker = ($reglas | ForEach-Object { "$($_.DisplayName) [$($_.Action), $($_.Profile), activa=$($_.Enabled)]" }) -join ' / '
        } else { $d.firewall_docker = 'sin reglas de entrada para Docker' }
    } catch { $d.firewall_docker = '? (no se pudo leer)' }
    return $d
}

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

$d = Hardware
Decir "PC del profe $($d.nombre), IP $($d.ip_pc), $($d.ram_gb) GB de RAM, $($d.cpu)"
Decir "Firewall (entrada) para Docker: $($d.firewall_docker)"

if ($modo -eq 'hardware') {
    DockerAnda $d -sinAbrir | Out-Null
    Guardar $d (Join-Path $datos 'profe-pc.txt')
    Get-Content (Join-Path $datos 'profe-pc.txt')
    exit 0
}

if (-not (DockerAnda $d)) {
    Guardar $d (Join-Path $datos 'profe-pc.txt')
    Decir "Docker no anda en esta PC: $($d.docker)"
    exit 1
}
$d.imagen_cargada_antes = $(if (ImagenCargada) { 'si' } else { 'no' })
if ($d.imagen_cargada_antes -eq 'no') {
    $tar = BuscarArchivoImagen
    if (-not $tar) {
        Decir "No esta la imagen cargada ni el archivo $archivoImagen al lado de este .cmd."
        exit 1
    }
    Decir "Cargando la imagen desde $tar ..."
    docker load -i $tar | Out-Host
    if (-not (ImagenCargada)) { Decir 'No se pudo cargar la imagen.'; exit 1 }
}
docker run --rm --device /dev/net/tun --entrypoint true $imagen *> $null
$tun = @()
if ($LASTEXITCODE -eq 0) { $d.tun_docker = 'si'; $tun = @('--device', '/dev/net/tun') } else { $d.tun_docker = 'no' }
Guardar $d (Join-Path $datos 'profe-pc.txt')

Write-Host ''
Write-Host 'IPs de esta PC (a los alumnos se les pasa la de la red del aula):'
TodasLasIps | ForEach-Object { Write-Host "   $_" }
Write-Host ''
Write-Host 'En Veyon: seleccionar las PCs > "Ejecutar programa" con:'
Write-Host "   cmd /c `"`"%USERPROFILE%\sonda-alumno.cmd`" $($d.ip_pc)`""
Write-Host '(si Veyon deja los archivos en otra carpeta, poner esa ruta)'
Write-Host 'Sin la prueba B (las PCs no publican el 8098 y no aparece el cartel del firewall):'
Write-Host "   cmd /c `"`"%USERPROFILE%\sonda-alumno.cmd`" $($d.ip_pc) sin-b`""
Write-Host ''

docker rm -f sonda-profe *> $null
$dargs = @('run', '--rm', '--name', 'sonda-profe', '--cap-add', 'NET_ADMIN') + $tun + @(
    '--sysctl', 'net.ipv4.ip_forward=1',
    '-p', '51820:51820/udp', '-p', '51821:51821/udp', '-p', '8099:8099',
    '-v', "$($datos):/datos",
    '-e', 'ROL=profe', '-e', "PC_NOMBRE=$($d.nombre)", '-e', "IP_PC=$($d.ip_pc)",
    '-e', "IMAGEN_ANTES=$($d.imagen_cargada_antes)", '-e', "ESPERADOS=$esperados", $imagen)
& docker @dargs
Write-Host ''
Write-Host "Planilla y resumen: $datos (planilla.csv y resumen.txt)"
exit 0
