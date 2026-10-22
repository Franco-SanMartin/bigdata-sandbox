"""El ejecutor genérico de acciones (lo van a usar también Pipeline y ML)."""
import asyncio

from sandbox_server.actions import Action, ActionRunner
from sandbox_server.events import EventBus


def correr(action, despues_esperar=0.0):
    async def main():
        bus = EventBus()
        q = bus.subscribe()
        run = await ActionRunner(bus).run(action)
        await asyncio.sleep(despues_esperar)
        eventos = []
        while not q.empty():
            eventos.append(q.get_nowait())
        return run, bus, eventos
    return asyncio.run(main())


def test_salida_en_vivo_y_antes_despues():
    datos = {"filas": 0}

    async def foto():
        return dict(datos)

    async def despues():
        datos["filas"] = 3
        return dict(datos)

    run, bus, eventos = correr(Action("Cargar ventas", "echo uno; echo dos >&2; echo tres",
                                      input="ventas.csv", action="lo sube a HDFS", before=foto, after=despues))
    assert run.state == "done" and run.exitCode == 0
    assert [(l["stream"], l["text"]) for l in run.lines if l["stream"] == "out"] == [("out", "uno"), ("out", "tres")]
    assert [l["text"] for l in run.lines if l["stream"] == "err"] == ["dos"]
    assert run.before == {"filas": 0} and run.after == {"filas": 3}
    # Línea por línea por SSE ('action') y dos entradas en la consola ('activity')
    acciones = [d for t, d in eventos if t == "action"]
    assert acciones[0]["state"] == "running" and acciones[-1]["state"] == "done"
    assert {d["text"] for d in acciones if "text" in d} == {"uno", "dos", "tres"}
    fin = bus.recent()[-1]
    assert fin["level"] == "ok" and fin["output"] == "antes: filas: 0 → después: filas: 3"
    assert fin["command"] == "echo uno; echo dos >&2; echo tres" and fin["input"] == "ventas.csv"
    assert run.to_json()["title"] == "Cargar ventas"


def test_falla_con_la_ultima_linea_de_error():
    run, bus, _ = correr(Action("Romper", ["bash", "-c", "echo 'No such file: /nada' >&2; exit 3"],
                                display="hdfs dfs -cat /nada"))
    assert run.state == "failed" and run.exitCode == 3
    fin = bus.recent()[-1]
    assert fin["level"] == "error" and fin["tech"] == "No such file: /nada"
    assert fin["command"] == "hdfs dfs -cat /nada"


def test_tiempo_maximo():
    run, _, _ = correr(Action("Lento", ["sleep", "5"], timeout=0.3))
    assert run.state == "failed" and "tardó más de 0.3 s" in run.error


def test_comando_inexistente():
    run, bus, _ = correr(Action("Nada", ["/no/existe"]))
    assert run.state == "failed" and run.exitCode is None and bus.recent()[-1]["level"] == "error"


def test_daemon_en_segundo_plano_no_traba_la_accion():
    # Como 'mysqld &' sin redirigir: el hijo sigue con la salida abierta
    run, _, _ = correr(Action("Prender", "sleep 2 & echo listo", timeout=10), despues_esperar=1.5)
    assert run.state == "done" and run.finishedAt - run.startedAt < 1800


def test_snapshot_roto_no_frena():
    async def rota():
        raise RuntimeError("sin NameNode")
    run, _, _ = correr(Action("X", "true", before=rota))
    assert run.state == "done" and run.before == "(no se pudo leer: sin NameNode)"
