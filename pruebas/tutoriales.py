#!/usr/bin/env python3
"""Corre los comandos de las guias (guias/*.md), en orden, como los haria un
alumno: los de "tu compu" en la compu (necesita docker) y los de "adentro"
en el contenedor 'bigdata'. Es el escenario 'tutoriales' de escenarios.sh.

Cada bloque de codigo de una guia lleva antes una marca (un comentario HTML,
que GitHub no muestra) que dice como se prueba:

  <!-- prueba: compu -->                 bash en la compu, en la carpeta de trabajo
  <!-- prueba: adentro -->               bash adentro del contenedor, parado en /datos
  <!-- prueba: adentro < mysql tienda --> el bloque entra por teclado a ese comando
                                           (consolas: mysql, mongosh...)
  <!-- prueba: adentro < beeline ... -f {} --> con {}: el bloque va como archivo
                                           (consolas que no leen del teclado redirigido)
  <!-- prueba: adentro bigdata-ha -->    lo mismo, en otro contenedor (sirve con < tambien)
  <!-- prueba: no (motivo) -->           no se corre (otra consola, interactivo...)

y, opcional, despues de la marca:  | espera: <texto>  (tiene que aparecer en la
salida; se puede repetir)  y  | falla  (el comando tiene que fallar).
Sin bloque de codigo: <!-- prueba: esperar listo [contenedor] --> espera el
cartel "Cluster LISTO" del ultimo arranque del contenedor (por defecto bigdata).

Los bloques ```text (o sin lenguaje) son salidas de ejemplo: no se corren.
Un bloque de comandos sin marca es un error: asi no queda nada sin probar
por olvido.

Uso:
  python3 pruebas/tutoriales.py --revisar guias/*.md   solo revisa las marcas (sin docker)
  python3 pruebas/tutoriales.py guias/*.md             corre todo

Usa el contenedor 'bigdata' y los volumenes de las guias: si ya existe un
contenedor 'bigdata' no arranca, salvo con TUTORIALES_PISAR=si (en GitHub
Actions). Con TUTORIALES_LIMPIAR=si borra al final lo que crearon las guias
(contenedores bigdata y bigdata-ha, volumenes bigdata_hadoop y bigdata_ha).
"""
import os
import re
import subprocess
import sys
import tempfile
import time

CONTENEDOR = "bigdata"
EXTENSION = {"sql": ".sql", "js": ".js", "javascript": ".js", "python": ".py", "pig": ".pig"}
COMANDOS = {"bash", "sh", "powershell", "bat", "sql", "js", "javascript", "python", "pig"}
SALIDAS = {"", "text"}
MARCA = re.compile(r"^<!--\s*prueba:\s*(.*?)\s*-->\s*$")
ADENTRO = re.compile(r"^adentro(?:\s+([A-Za-z0-9][A-Za-z0-9_.-]*))?\s*(?:<\s*(.+))?$")
CERCO = re.compile(r"^```([A-Za-z]*)\s*$")
LIMITE = 30 * 60   # segundos por bloque


class Bloque:
    def __init__(self, archivo, linea, lenguaje, codigo, modo, opciones):
        self.archivo, self.linea, self.lenguaje = archivo, linea, lenguaje
        self.codigo, self.modo, self.opciones = codigo, modo, opciones

    def donde(self):
        return f"{self.archivo}:{self.linea}"


def leer_marca(texto):
    partes = [p.strip() for p in texto.split("|")]
    modo, opciones = partes[0], partes[1:]
    for o in opciones:
        if not (o.startswith("espera:") or o == "falla"):
            raise ValueError(f"opcion desconocida: {o!r}")
    if not (modo == "compu" or ADENTRO.match(modo) or modo.startswith("esperar listo")
            or modo == "no" or modo.startswith("no ")):
        raise ValueError(f"marca desconocida: {modo!r}")
    return modo, opciones


def leer_guias(archivos):
    """Devuelve la lista de pasos y la de errores de marcas."""
    pasos, errores = [], []
    for archivo in archivos:
        with open(archivo, encoding="utf-8") as f:
            lineas = f.read().split("\n")
        marca = None
        i = 0
        while i < len(lineas):
            m = MARCA.match(lineas[i])
            if m:
                if marca is not None:
                    errores.append(f"{archivo}:{marca[0]}: marca sin bloque de codigo abajo")
                try:
                    marca = (i + 1, leer_marca(m.group(1)))
                except ValueError as e:
                    errores.append(f"{archivo}:{i + 1}: {e}")
                    marca = None
                if marca and marca[1][0].startswith("esperar listo"):
                    pasos.append(Bloque(archivo, i + 1, "", "", marca[1][0], marca[1][1]))
                    marca = None
                i += 1
                continue
            c = CERCO.match(lineas[i])
            if c:
                inicio, lenguaje = i + 1, c.group(1).lower()
                j = i + 1
                while j < len(lineas) and not lineas[j].startswith("```"):
                    j += 1
                if j == len(lineas):
                    errores.append(f"{archivo}:{inicio}: bloque de codigo sin cerrar")
                    break
                codigo = "\n".join(lineas[i + 1:j]) + "\n"
                if lenguaje in SALIDAS:
                    if marca is not None:
                        errores.append(f"{archivo}:{marca[0]}: la marca cae sobre una salida (```{lenguaje})")
                elif lenguaje in COMANDOS:
                    if marca is None:
                        errores.append(f"{archivo}:{inicio}: bloque ```{lenguaje} sin marca de prueba")
                    else:
                        modo, opciones = marca[1]
                        if lenguaje in ("powershell", "bat") and not modo.startswith("no"):
                            errores.append(f"{archivo}:{inicio}: ```{lenguaje} no se puede correr aca: marcalo 'no'")
                        pasos.append(Bloque(archivo, inicio, lenguaje, codigo, modo, opciones))
                else:
                    errores.append(f"{archivo}:{inicio}: lenguaje desconocido ```{lenguaje}")
                marca = None
                i = j + 1
                continue
            if marca is not None and lineas[i].strip():
                errores.append(f"{archivo}:{marca[0]}: entre la marca y el bloque hay texto")
                marca = None
            i += 1
        if marca is not None:
            errores.append(f"{archivo}:{marca[0]}: marca sin bloque de codigo abajo")
    return pasos, errores


def sh(args, **kw):
    return subprocess.run(args, text=True, capture_output=True, **kw)


def esperar_listo(nombre):
    inicio = time.time()
    while time.time() - inicio < 15 * 60:
        prendido = sh(["docker", "inspect", "-f", "{{.State.Running}} {{.State.StartedAt}}", nombre])
        if prendido.returncode == 0:
            corriendo, desde = prendido.stdout.split()
            if corriendo != "true":
                logs = sh(["docker", "logs", "--tail", "60", nombre])
                return False, logs.stdout + logs.stderr + "\nel contenedor se apago solo"
            logs = sh(["docker", "logs", "--since", desde, nombre])
            if "Cluster LISTO" in logs.stdout + logs.stderr:
                return True, f"LISTO en {int(time.time() - inicio)} s"
        time.sleep(4)
    logs = sh(["docker", "logs", "--tail", "60", nombre])
    return False, logs.stdout + logs.stderr + "\nno llego a 'Cluster LISTO' en 15 minutos"


def correr(paso, trabajo, estado_pwd):
    if paso.modo.startswith("esperar listo"):
        return esperar_listo(paso.modo[len("esperar listo"):].strip() or CONTENEDOR)
    if paso.modo == "compu":
        guion = f"cd {quote(open(estado_pwd).read().strip())}\n{paso.codigo}\npwd > {quote(estado_pwd)}\n"
        r = subprocess.run(["bash", "-e", "-c", guion], text=True, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=LIMITE)
        return r.returncode == 0, r.stdout
    # adentro: el bloque se copia al contenedor y se corre ahi
    contenedor, consola = ADENTRO.match(paso.modo).groups()
    contenedor = contenedor or CONTENEDOR
    destino = "/tmp/bloque-guia" + EXTENSION.get(paso.lenguaje, ".sh")
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(paso.codigo)
    os.chmod(f.name, 0o644)
    try:
        cp = sh(["docker", "cp", f.name, f"{contenedor}:{destino}"])
        if cp.returncode != 0:
            return False, cp.stdout + cp.stderr
    finally:
        os.unlink(f.name)
    if not consola:
        orden = f"bash -e {destino}"
    else:
        orden = consola.replace("{}", destino) if "{}" in consola else f"{consola} < {destino}"
    r = subprocess.run(["docker", "exec", "-w", "/datos", contenedor, "bash", "-c", orden],
                       text=True, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=LIMITE)
    return r.returncode == 0, r.stdout


def quote(s):
    return "'" + s.replace("'", "'\\''") + "'"


def main():
    args = sys.argv[1:]
    revisar = "--revisar" in args
    archivos = [a for a in args if a != "--revisar"]
    if not archivos:
        print(__doc__)
        return 2
    pasos, errores = leer_guias(archivos)
    corren = [p for p in pasos if not p.modo.startswith("no")]
    print(f"{len(pasos)} bloques marcados en {len(archivos)} guias: {len(corren)} se corren, "
          f"{len(pasos) - len(corren)} no")
    if errores:
        print("\n".join(errores), file=sys.stderr)
        return 1
    if revisar:
        return 0

    if sh(["docker", "inspect", CONTENEDOR]).returncode == 0 and os.environ.get("TUTORIALES_PISAR") != "si":
        print(f"Ya hay un contenedor '{CONTENEDOR}': las guias lo pisarian. "
              "Corre esto en una compu de prueba (o con TUTORIALES_PISAR=si).", file=sys.stderr)
        return 1

    trabajo = tempfile.mkdtemp(prefix="guias-")
    estado_pwd = os.path.join(trabajo, ".pwd")
    with open(estado_pwd, "w") as f:
        f.write(trabajo)
    hechos = 0
    try:
        for paso in pasos:
            if paso.modo.startswith("no"):
                continue
            print(f"\n=== {paso.donde()} [{paso.modo}] ===", flush=True)
            if paso.codigo:
                print(paso.codigo.rstrip(), flush=True)
            t0 = time.time()
            try:
                ok, salida = correr(paso, trabajo, estado_pwd)
            except subprocess.TimeoutExpired:
                ok, salida = False, f"tardo mas de {LIMITE // 60} minutos"
            espera_falla = "falla" in paso.opciones
            lineas = salida.rstrip().split("\n")
            print("--- salida (ultimas 40 lineas) ---")
            print("\n".join(lineas[-40:]))
            print(f"--- {int(time.time() - t0)} s", flush=True)
            if ok == espera_falla:
                que = "termino bien y tenia que fallar" if espera_falla else "fallo"
                print(f"\nFALLA {paso.donde()}: el bloque {que}", file=sys.stderr)
                print(salida[-6000:], file=sys.stderr)
                return 1
            for o in paso.opciones:
                if o.startswith("espera:"):
                    texto = o[len("espera:"):].strip()
                    if texto not in salida:
                        print(f"\nFALLA {paso.donde()}: en la salida no aparece {texto!r}", file=sys.stderr)
                        return 1
            hechos += 1
    finally:
        if os.environ.get("TUTORIALES_LIMPIAR") == "si":
            sh(["docker", "rm", "-f", CONTENEDOR, "bigdata-ha"])
            for v in ("bigdata_hadoop", "bigdata_ha"):
                sh(["docker", "volume", "rm", "-f", v])
    print(f"\nGUIAS OK: {hechos} bloques corridos, todos bien")
    return 0


if __name__ == "__main__":
    sys.exit(main())
