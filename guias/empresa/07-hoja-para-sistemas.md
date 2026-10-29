# 7. Hoja para sistemas

Para el área de sistemas del laboratorio: qué hace el cluster del aula en la
red y qué hace falta permitir. Es una sola regla, en una sola PC.

[← Índice de `empresa`](README.md) · [3. El laboratorio](03-laboratorio.md)

## En una línea

La **PC del profe** recibe conexiones en **TCP 8099** y **UDP 51820**. Las
PCs de los alumnos **solo salen** hacia esos dos puertos de la PC del profe:
no abren puertos, no piden permisos de administrador y no aparece el cartel
del firewall en ellas.

## Qué se pide

| Dónde | Regla | Para qué |
|---|---|---|
| PC del profe | Entrada **TCP 8099**, desde la red del aula | Inscripción de las PCs: cada una reserva su número (`pc01`, `pc02`...) y manda su clave del túnel |
| PC del profe | Entrada **UDP 51820**, desde la red del aula | El túnel WireGuard: por acá pasa todo el tráfico del cluster |
| PCs de alumnos | Salida hacia la PC del profe en TCP 8099 y UDP 51820 | Lo mismo, del otro lado (en la medición del 27/10 ya estaba permitido) |

Lo más simple es que, la primera vez, el profe acepte el cartel
**"Firewall de Windows bloqueó algunas características"** de
`com.docker.backend` tildando **redes públicas**. Si la política del
laboratorio no deja aceptarlo, la regla equivalente en PowerShell (como
administrador, en la PC del profe):

<!-- prueba: no (PowerShell como administrador en la PC del profe) -->
```powershell
New-NetFirewallRule -DisplayName 'BigData aula - inscripcion' -Direction Inbound -Protocol TCP -LocalPort 8099 -Profile Public,Private,Domain -Action Allow
New-NetFirewallRule -DisplayName 'BigData aula - tunel'       -Direction Inbound -Protocol UDP -LocalPort 51820 -Profile Public,Private,Domain -Action Allow
```

Para sacarlas después: `Remove-NetFirewallRule -DisplayName 'BigData aula*'`.

Si llega por TCP y no por UDP, cada PC lo dice:
`la inscripcion anduvo ... pero el tunel no levanta`. Es la regla de UDP
51820 la que falta.

## Lo que midió la sonda (27/10, 11 PCs y la del profe)

- La red del aula se ve en Windows como **"Pública"** (perfil `Public` en
  todas las PCs): el firewall está en su modo más estricto.
- Las PCs tienen direcciones **`192.169.0.x`** (la del profe terminaba en
  `.86`). Ojo: `192.169.0.0` **no es un rango privado** (el privado es
  `192.168.x.x`); conviene que sistemas lo sepa por si algún filtro lo trata
  como internet.
- Túnel y conexión hacia el profe: **11 de 11** PCs. Ping por el túnel: unos
  3 ms. Velocidad alumno → profe: unos 50 Mbit/s.
- Entrada directa a las PCs de alumnos: bloqueada en la mayoría. Por eso el
  diseño no la usa.

Detalle en los [resultados de la sonda](../../sonda/resultados/2026-10-27/LEEME.md).

## Qué más corre (y no sale a la red)

- **El túnel usa direcciones propias, `10.13.0.x`**, que viven adentro de
  los contenedores de Docker: el maestro es `10.13.0.1` y la PC N es
  `10.13.0.(10+N)`. No se asignan en la red del aula ni piden DHCP.
- **La interfaz web y las de Hadoop** (8080, 9870, 8088, 19888, 18080,
  10000, 8888) quedan publicadas **solo en `127.0.0.1`** de la PC del profe:
  no se ven desde la red.
- **Docker Desktop** tiene que estar instalado en todas las PCs (ya lo
  está: 4.55 en la medición). Las PCs no necesitan internet durante la
  clase: las imágenes van por Veyon o por la carpeta compartida.
- **Disco**: la PC del profe carga una imagen de ~1,6 GB y cada PC una de
  ~192 MB. El reset diario lo borra todo.
- **Carpeta compartida (opcional)**: si se puede dejar
  `bigdata-sandbox-trabajador.tar.gz` en la carpeta compartida de solo
  lectura, las PCs la leen de ahí y no hay que mandarla por Veyon a cada una.

[← 6. Plan B](06-plan-b.md) · Siguiente: [8. Hoja del alumno →](08-hoja-alumno.md)
