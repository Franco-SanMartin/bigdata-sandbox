"""El cluster dentro del contenedor: arrancarlo, apagarlo y saber cómo está.

No reimplementa el arranque: corre /opt/entrypoint.sh (el mismo de las
versiones base y ml) con la configuración en las variables de entorno y sigue
su salida. Para apagar le manda SIGTERM, y su trap 'apagar' baja todo en orden
(primero Hive y Spark con HDFS todavía arriba, después el resto).
"""
from __future__ import annotations

import asyncio
import glob
import json
import os
import re
import shutil
import signal
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

from . import config as cfg
from . import probes
from .actions import Action, ActionRunner
from .boot import BootTracker, Volume, now_ms, plan
from .errors import ApiError
from .events import EventBus
from .proc import exited
from .specs import ProcSpec, dn_data, dn_http, nn_http, process_specs


class Conflict(ApiError):
    """La acción no se puede hacer en el estado actual (HTTP 409, 'busy' salvo
    que se diga otro código)."""
    code = "busy"


class Invalid(ApiError):
    """Pedido inválido (HTTP 400). Con 'issues' si vienen de validar la configuración."""
    code = "invalid"

    def __init__(self, message: str, issues: list[dict] | None = None):
        super().__init__(message, issues=issues or None)
        self.issues = issues or []


def _env_path(name: str, default: str) -> Path:
    return Path(os.environ.get(name, default))


@dataclass
class Settings:
    entrypoint: list[str] = field(default_factory=lambda: os.environ.get(
        "SANDBOX_ENTRYPOINT", "/opt/entrypoint.sh").split())
    hadoop_dir: Path = field(default_factory=lambda: _env_path("SANDBOX_HADOOP_DIR", "/hadoop"))
    state_file: Path | None = None
    bin_dir: Path = field(default_factory=lambda: _env_path("SANDBOX_BIN", "/opt/sandbox/bin"))
    proc_dir: Path = field(default_factory=lambda: _env_path("SANDBOX_PROC", "/proc"))
    ui_port: int = field(default_factory=lambda: int(os.environ.get("PORT", "8080")))
    # Docker da 10 s de fábrica antes de matar todo; el compose de la interfaz, 20 s
    stop_timeout: float = field(default_factory=lambda: float(os.environ.get("SANDBOX_STOP_TIMEOUT", "18")))
    poll_running: float = 2.0
    poll_starting: float = 1.0
    # Si es False no se sondea nada real (tests)
    probe: bool = True
    # AUTOSTART=1: arranca solo al prender el servidor, con la config de las variables
    autostart: bool = field(default_factory=lambda: os.environ.get("AUTOSTART", "0").strip() in ("1", "si", "true"))
    # Carpeta de trabajo de los ejemplos (/datos, con ejemplos/ adentro)
    datos_dir: Path = field(default_factory=lambda: _env_path("SANDBOX_DATOS", "/datos"))
    # Las funciones del entrypoint (apagar_en_orden)
    lib: Path = field(default_factory=lambda: _env_path("SANDBOX_LIB", "/opt/sandbox/lib.sh"))

    def __post_init__(self) -> None:
        if self.state_file is None:
            self.state_file = self.hadoop_dir / "interfaz.json"


# El apagado en orden es la función apagar_en_orden de sandbox/lib.sh, la misma
# que corre el trap 'apagar' del entrypoint con docker stop. Se usa si piden
# apagar en medio del arranque (cuando ese trap todavía no está) y después de
# apagar, por lo que se haya prendido desde la interfaz (JupyterLab, MongoDB...).
APAGAR_EN_ORDEN = '. "$SANDBOX_LIB" && apagar_en_orden'


MEM_HISTORY = 60     # muestras (10 min)
MEM_EVERY_MS = 10_000
LOG_KEEP = 2000      # líneas de log de los daemons después de "Cluster LISTO"


def _detect_versions() -> dict[str, str]:
    def ver(pattern: str, rx: str) -> str:
        for f in glob.glob(pattern):
            m = re.search(rx, os.path.basename(f))
            if m:
                return m.group(1)
        return ""
    hadoop = os.environ.get("HADOOP_HOME", "/opt/hadoop")
    hive = os.environ.get("HIVE_HOME", "/opt/hive")
    spark = os.environ.get("SPARK_HOME", "/opt/spark")
    return {
        "hadoop": ver(f"{hadoop}/share/hadoop/common/hadoop-common-*.jar", r"hadoop-common-([\d.]+)\.jar"),
        "hive": ver(f"{hive}/lib/hive-exec-*.jar", r"hive-exec-([\d.]+)\.jar"),
        "spark": ver(f"{spark}/jars/spark-core_*.jar", r"spark-core_[\d.]+-([\d.]+)\.jar"),
    }


class Cluster:
    def __init__(self, bus: EventBus, runner: ActionRunner, settings: Settings | None = None):
        self.s = settings or Settings()
        self.bus = bus
        self.runner = runner
        self.store = cfg.ConfigStore(self.s.state_file)
        self.saved = self.store.load()
        self.config = dict(self.saved)        # con la que corre (o va a correr)
        self.phase = "stopped"
        self.startedAt: int | None = None
        self.tracker: BootTracker | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.logs: deque[str] = deque(maxlen=LOG_KEEP)
        self._reader: asyncio.Task | None = None
        self._op: asyncio.Task | None = None
        self._poller: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self.processes: list[dict] = []
        self.hdfs = probes.empty_hdfs()
        self.yarn = probes.yarn_summary(None)
        self.nn_jmx: dict | None = None
        # Puerto web del NameNode activo (WebHDFS y JMX); None si no hay
        self.nn_active_port: int | None = None
        # Lo que corre después de cada sondeo (HDFS y YARN miran ahí qué cambió)
        self.watchers: list = []
        self.mem_limit, self.mem_used = 0, 0
        self.mem_history: deque[dict] = deque(maxlen=MEM_HISTORY)
        self._last_mem = 0
        self._last_sig = ""
        self._last_pub = 0
        self.image = {"name": "franki678/bigdata-sandbox", "tag": os.environ.get("SANDBOX_VERSION", "full"),
                      **_detect_versions()}

    # ------------------------------------------------------------------ util

    def volume(self) -> Volume:
        return Volume.read(self.s.hadoop_dir)

    def jupyter_installed(self) -> bool:
        return shutil.which("jupyter-lab") is not None or not self.s.probe

    def specs(self) -> list[ProcSpec]:
        sp = process_specs(self.config, self.s.ui_port)
        vol_nn = self.volume().namenodes
        if vol_nn and vol_nn != self.config["namenodes"]:
            sp = process_specs({**self.config, "namenodes": vol_nn}, self.s.ui_port)
        if not self.jupyter_installed():
            sp = [p for p in sp if p.id != "jupyter"]
        return sp

    def _status_changed(self) -> None:
        self.bus.publish("status", {})

    # --------------------------------------------------------------- config

    def check(self, raw: object) -> tuple[dict, list[dict]]:
        try:
            c = cfg.normalize(raw)
        except ValueError as e:
            raise Invalid(str(e)) from e
        return c, cfg.validate(c, self.volume().namenodes)

    def save_config(self, raw: object) -> dict:
        c, issues = self.check(raw)
        if cfg.has_errors(issues):
            raise Invalid("la configuración tiene errores", issues)
        self.store.save(c)
        self.saved = c
        if self.phase == "stopped":
            self.config = dict(c)
        self._status_changed()
        return c

    # ------------------------------------------------------------ arranque

    async def start(self, raw: object) -> None:
        async with self._lock:
            if self.phase != "stopped":
                raise Conflict(f"el cluster no está apagado (está {self.phase})")
            c = self.save_config(raw)
            self.config = dict(c)
            await self._spawn()

    async def _spawn(self) -> None:
        vol = self.volume()
        kind = "restart" if vol.formatted else "first"
        self.tracker = BootTracker(plan(self.config, vol, self.jupyter_installed()), kind)
        self.phase = "starting"
        self.startedAt = None
        self.logs.clear()
        env = dict(os.environ)
        env.update(cfg.to_env(self.config))
        self.bus.log("Cluster", "info", "Arrancando el cluster",
                     command=" ".join(f"{k}={v}" for k, v in cfg.to_env(self.config).items()) + " /opt/entrypoint.sh",
                     action="corre el mismo arranque que docker run, paso a paso")
        try:
            self.proc = await asyncio.create_subprocess_exec(
                *self.s.entrypoint, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                stdin=asyncio.subprocess.DEVNULL, env=env, start_new_session=True)
        except OSError as e:
            self.tracker.fail(f"no se pudo correr el arranque: {e}")
            self.phase = "stopped"
            self.bus.log("Cluster", "error", "No se pudo arrancar", tech=str(e))
            self._status_changed()
            return
        self._reader = asyncio.get_running_loop().create_task(self._read(self.proc, self.tracker))
        self._status_changed()

    async def _read(self, proc: asyncio.subprocess.Process, tracker: BootTracker) -> None:
        pump = asyncio.get_running_loop().create_task(self._pump(proc, tracker))
        code = await exited(proc)
        # Algún hijo en segundo plano puede seguir con la salida abierta: se le
        # da un momento para vaciarla y se sigue
        try:
            await asyncio.wait_for(asyncio.shield(pump), timeout=0.5)
        except asyncio.TimeoutError:
            pass
        if self.proc is not proc:
            return
        if self.phase == "starting":
            # Terminó antes de "Cluster LISTO": error en los parámetros o algo no levantó
            if not tracker.failed:
                tracker.fail(f"el arranque terminó con código {code}")
                self.bus.log("Cluster", "error", "El arranque se cortó", tech=tracker.failed)
            self.phase = "stopping"
            self._status_changed()
            await self._shutdown_leftovers()
            await self._kill_group(proc.pid)
            self.phase = "stopped"
            self._status_changed()
        elif self.phase == "running":
            # Alguien mató el arranque por fuera (kill desde una terminal)
            self.bus.log("Cluster", "warn", "El proceso de arranque terminó solo", tech=f"código {code}")
        try:
            await asyncio.wait_for(pump, timeout=1)
        except asyncio.TimeoutError:
            pass

    async def _pump(self, proc: asyncio.subprocess.Process, tracker: BootTracker) -> None:
        assert proc.stdout is not None
        while True:
            raw = await proc.stdout.readline()
            if not raw:
                break
            line = raw.decode("utf-8", "replace")
            if tracker.ready or tracker.failed:
                self.logs.append(line.rstrip("\n"))
                continue
            try:
                self._on_line(tracker, line)
            except Exception as e:  # noqa: BLE001 (una línea rara no puede cortar la lectura)
                self.logs.append(f"[interfaz] no se pudo procesar una línea del arranque: {e}")

    def _on_line(self, tracker: BootTracker, line: str) -> None:
        ev = tracker.feed(line)
        if ev == "ready":
            self.phase, self.startedAt = "running", tracker.startedAt
            secs = (tracker.finishedAt - tracker.startedAt) / 1000
            self.bus.log("Cluster", "ok", f"Cluster listo en {secs:.0f} s", command="estado")
            self._status_changed()
        elif ev == "failed":
            self.bus.log("Cluster", "error", "El arranque se cortó", tech=tracker.failed)
            self._status_changed()
        elif ev:
            step = next((s for s in tracker.steps if s.id == ev), None)
            if step is not None:
                self.bus.log("Cluster", "info", step.name, command=step.commands[0] if step.commands else None,
                             action=step.description)
            self._status_changed()
        elif tracker.current is not None:
            # Las líneas sueltas solo avisan que hay novedades
            self.bus.publish("status", {})

    # ------------------------------------------------------------- apagado

    async def stop(self) -> None:
        async with self._lock:
            if self.phase in ("stopped", "stopping"):
                return
            self.phase = "stopping"
            self._status_changed()
            await self._stop_now()

    async def _stop_now(self) -> None:
        self.bus.log("Cluster", "info", "Apagando el cluster en orden",
                     command="docker stop (SIGTERM al arranque)",
                     action="primero Hive y Spark con HDFS arriba; después YARN, HDFS, MySQL y MongoDB")
        proc, tracker = self.proc, self.tracker
        trap_puesto = tracker is not None and tracker.ready
        if proc is not None and proc.returncode is None:
            try:
                proc.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass
            if await exited(proc, self.s.stop_timeout) is None:
                self.bus.log("Cluster", "warn", "El apagado tardó demasiado: se cortan los que quedan")
                proc.kill()
                await exited(proc, 2)
        if tracker is not None and not tracker.ready:
            tracker.fail("apagado durante el arranque")
        if not trap_puesto:
            self.bus.log("Cluster", "info", "Se apagan en orden los procesos que alcanzaron a arrancar")
        # Con el trap ya corrido no queda nada: lo repite por lo que se haya
        # prendido después desde la interfaz (JupyterLab, MongoDB...)
        await self._shutdown_leftovers()
        if proc is not None:
            await self._kill_group(proc.pid)
        if self._reader is not None:
            try:
                await asyncio.wait_for(self._reader, timeout=2)
            except Exception:  # noqa: BLE001 (al apagar no importa cómo terminó la lectura)
                self._reader.cancel()
        self.phase = "stopped"
        self.startedAt = None
        self.bus.log("Cluster", "ok", "Cluster apagado", output="los datos quedan en el volumen /hadoop")
        self._status_changed()

    @staticmethod
    async def _kill_group(pgid: int) -> None:
        """Lo que quedó del grupo del arranque: el 'tail -F' de los logs (que
        además tiene abierta la salida que leemos) y cualquier hijo suelto. Con
        docker run esto lo hacía el fin del contenedor."""
        for sig, wait in ((signal.SIGTERM, 2.0), (signal.SIGKILL, 1.0)):
            try:
                os.killpg(pgid, sig)
            except (ProcessLookupError, PermissionError):
                return
            for _ in range(int(wait / 0.1)):
                await asyncio.sleep(0.1)
                try:
                    os.killpg(pgid, 0)
                except (ProcessLookupError, PermissionError):
                    return

    async def _shutdown_leftovers(self) -> None:
        if not self.s.probe:
            return
        p = await asyncio.create_subprocess_exec("bash", "-c", APAGAR_EN_ORDEN, stdin=asyncio.subprocess.DEVNULL,
                                                 stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                                                 env={**os.environ, "SANDBOX_LIB": str(self.s.lib)})
        try:
            await asyncio.wait_for(p.wait(), timeout=self.s.stop_timeout)
        except asyncio.TimeoutError:
            p.kill()

    async def apply(self, raw: object) -> None:
        c, issues = self.check(raw)
        if cfg.has_errors(issues):
            raise Invalid("la configuración tiene errores", issues)
        async with self._lock:
            if self.phase == "stopping":
                raise Conflict("el cluster se está apagando")
            if self.phase != "stopped":
                self.phase = "stopping"
                self._status_changed()
                await self._stop_now()
            self.save_config(c)
            self.config = dict(c)
            self.bus.log("Vos", "info", "Aplicar configuración: reinicio con los nuevos parámetros",
                         input=json.dumps(c, ensure_ascii=False))
            await self._spawn()

    async def reset(self) -> None:
        """Borra el volumen (como docker compose down -v). Solo con el cluster apagado.
        La configuración guardada de la interfaz se conserva."""
        async with self._lock:
            if self.phase != "stopped":
                raise Conflict("primero hay que apagar el cluster")
            root = self.s.hadoop_dir
            keep = {self.s.state_file.resolve()} if self.s.state_file else set()
            borrados = 0
            if root.is_dir():
                for child in root.iterdir():
                    if child.resolve() in keep:
                        continue
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child, ignore_errors=True)
                    else:
                        child.unlink(missing_ok=True)
                    borrados += 1
            self.tracker = None
            self.bus.log("Vos", "warn", "Volumen borrado", command=f"rm -rf {root}/*  # docker compose down -v",
                         action="borra HDFS, metastore, MySQL y MongoDB; el próximo arranque formatea de cero",
                         output=f"{borrados} elementos borrados")
            self._status_changed()

    async def shutdown(self) -> None:
        """Al apagar el servidor (docker stop): apaga el cluster y espera."""
        if self._poller:
            self._poller.cancel()
        if self.phase in ("starting", "running") or (self.proc and self.proc.returncode is None):
            async with self._lock:
                self.phase = "stopping"
                await self._stop_now()

    # ---------------------------------------------------- acciones sobre procesos

    def process_action_for(self, pid: str, action: str) -> Action:
        if action not in ("start", "stop"):
            raise Invalid("la acción es start o stop")
        spec = next((p for p in self.specs() if p.id == pid), None)
        m = re.fullmatch(r"dn([1-9])", pid)
        if spec is None and not m:
            raise ApiError(f"No hay un proceso {pid}", "not_found")
        if spec is not None and not spec.controllable:
            raise Invalid(f"{spec.name} no se prende ni se apaga suelto")
        if self.phase != "running":
            raise Conflict("El cluster está apagado: arrancalo desde Cluster", "cluster_stopped")
        b = str(self.s.bin_dir)
        verbo = "Prender" if action == "start" else "Apagar"
        if m:
            n = int(m.group(1))
            return Action(f"{verbo} DataNode {n}", [f"{b}/datanode", action, str(n)],
                          input=f"DataNode {n} (http://localhost:{dn_http(n)})",
                          action="el NameNode lo da por muerto a los ~40 s y re-replica sus bloques"
                          if action == "stop" else "arranca y se anota en el NameNode con los bloques que tenga",
                          before=self.hdfs_snapshot, after=self.hdfs_snapshot, process_id=pid)
        m = re.fullmatch(r"nn([1-3])", pid)
        if m:
            n = int(m.group(1))
            return Action(f"{verbo} NameNode {n}", [f"{b}/namenode", action, str(n)],
                          input=f"NameNode {n} (http://localhost:{nn_http(n)})",
                          action=("con alta disponibilidad, ZooKeeper le da el 'active' a otro NameNode"
                                  if self.config["namenodes"] > 1 else "sin alta disponibilidad, HDFS queda sin servicio")
                          if action == "stop" else "vuelve; en HA entra como standby",
                          before=self.hdfs_snapshot, after=self.hdfs_snapshot, process_id=pid)
        cmds = {
            ("mysql", "start"): ("mkdir -p /run/mysqld && chown mysql:mysql /run/mysqld && "
                                 "(mysqld > /dev/null 2>&1 &) && "
                                 "for _ in $(seq 1 60); do mysqladmin --silent ping > /dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
                                 "mysqld &"),
            ("mysql", "stop"): ("mysqladmin shutdown", "mysqladmin shutdown"),
            ("mongodb", "start"): ("(runuser -u mongodb -- mongod --config /etc/mongod.conf > /dev/null 2>&1 &) && "
                                   "for _ in $(seq 1 60); do mongosh --quiet --eval 1 > /dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
                                   "runuser -u mongodb -- mongod --config /etc/mongod.conf &"),
            ("mongodb", "stop"): ("pkill -TERM -x mongod; for _ in $(seq 1 40); do pgrep -x mongod > /dev/null || exit 0; sleep 0.25; done; exit 1",
                                  "pkill -TERM -x mongod"),
            ("hiveserver2", "start"): ('cd /hadoop && (nohup hive --service hiveserver2 > "${HIVE_HOME:-/opt/hive}/hiveserver2.log" 2>&1 &)',
                                       "hive --service hiveserver2 &"),
            ("hiveserver2", "stop"): ("pkill -TERM -f org.apache.hive.service.server.HiveServer2; "
                                      "for _ in $(seq 1 60); do pgrep -f org.apache.hive.service.server.HiveServer2 > /dev/null || exit 0; sleep 0.25; done; exit 1",
                                      "pkill -f HiveServer2"),
            ("jupyter", "start"): ("(nohup jupyter lab > /var/log/jupyter.log 2>&1 &)", "jupyter lab &"),
            ("jupyter", "stop"): ("pkill -TERM -f jupyter-lab", "pkill -f jupyter-lab"),
        }
        cmd, shown = cmds[(pid, action)]
        return Action(f"{verbo} {spec.name}", cmd, display=shown, input=spec.name,
                      action="arranca el proceso con la misma configuración del arranque" if action == "start"
                      else "lo apaga en orden; lo que depende de él va a fallar hasta que vuelva", process_id=pid)

    def process_action(self, pid: str, action: str) -> str:
        run = self.runner.start(self.process_action_for(pid, action))
        return run.id

    async def hdfs_snapshot(self) -> dict:
        if self.s.probe:
            await self.refresh()
        h = self.hdfs
        if not h["available"]:
            return {"HDFS": "sin NameNode activo"}
        return {"DataNodes vivos": h["liveDataNodes"], "muertos": h["deadDataNodes"],
                "bloques": h["blocks"], "sub-replicados": h["underReplicated"], "perdidos": h["missing"]}

    # ------------------------------------------------------------- sondeo

    def start_polling(self) -> None:
        if self._poller is None and self.s.probe:
            self._poller = asyncio.get_running_loop().create_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            try:
                await self.refresh()
            except Exception as e:  # noqa: BLE001 (el sondeo nunca tiene que morir)
                self.logs.append(f"[interfaz] error leyendo el estado: {e}")
            for watch in list(self.watchers):
                try:
                    await watch()
                except Exception as e:  # noqa: BLE001
                    self.logs.append(f"[interfaz] error mirando cambios: {e}")
            await asyncio.sleep(self.s.poll_starting if self.phase == "starting" else self.s.poll_running)

    async def refresh(self) -> None:
        running = await asyncio.to_thread(probes.scan_proc, self.s.proc_dir)
        ports = await asyncio.to_thread(probes.read_listening, self.s.proc_dir)
        roles: dict[str, str] = {}
        active_port = None
        nn_specs = [p for p in self.specs() if p.kind == "namenode"]
        for p in nn_specs:
            if p.probe not in ports:
                continue
            doc = await asyncio.to_thread(probes.get_json,
                                          f"http://localhost:{p.probe}/jmx?qry=Hadoop:service=NameNode,name=NameNodeStatus")
            role = probes.nn_role(doc or {})
            if role:
                roles[p.id] = role
            if role == "active" or (len(nn_specs) == 1 and doc):
                active_port = p.probe
        jmx = None
        if active_port:
            beans = []
            for name in ("FSNamesystemState", "FSNamesystem", "NameNodeInfo"):
                d = await asyncio.to_thread(probes.get_json,
                                            f"http://localhost:{active_port}/jmx?qry=Hadoop:service=NameNode,name={name}")
                beans += (d or {}).get("beans", [])
            jmx = {"beans": beans}
        yarn = None
        if 8088 in ports:
            yarn = await asyncio.to_thread(probes.get_json, "http://localhost:8088/ws/v1/cluster/metrics")
        limit, used = await asyncio.to_thread(probes.memory_from)
        self.nn_active_port = active_port
        self.update(running, ports, roles, jmx, yarn, limit, used)

    def update(self, running: dict[str, dict], ports: set[int], roles: dict[str, str], jmx: dict | None,
               yarn: dict | None, mem_limit: int, mem_used: int) -> None:
        """Arma el estado de los procesos con lo sondeado (separado para poder
        probarlo con datos de ejemplo)."""
        t = now_ms()
        self.nn_jmx = jmx
        self.hdfs = probes.hdfs_summary(jmx) if self.phase != "stopped" or jmx else probes.empty_hdfs()
        self.yarn = probes.yarn_summary(yarn)
        self.mem_limit, self.mem_used = mem_limit, mem_used
        if t - self._last_mem >= MEM_EVERY_MS:
            self.mem_history.append({"t": t, "usedMb": mem_used})
            self._last_mem = t
        old = {p["id"]: p for p in self.processes}
        specs = self.specs()
        # DataNodes agregados en caliente (datanode start N con N > DATANODES)
        known = {p.id for p in specs}
        for pid in sorted(running):
            m = re.fullmatch(r"dn([1-9])", pid)
            if m and pid not in known:
                n = int(m.group(1))
                at = max((i for i, p in enumerate(specs) if p.layer == "hdfs"), default=len(specs) - 1) + 1
                specs.insert(at, ProcSpec(pid, "datanode", f"DataNode {n}", "hdfs", [dn_http(n), dn_data(n)],
                                          dn_http(n), web=dn_http(n), controllable=True))
        booting = set()
        if self.tracker and self.phase == "starting":
            for st in self.tracker.steps:
                if st.state == "running":
                    booting.update(st.processes)
        out = []
        for sp in specs:
            r = running.get(sp.id)
            if sp.id == "ui":
                state = "up"
                r = {"pid": os.getpid(), "memMb": None}
            elif r and sp.probe in ports:
                state = "stopping" if self.phase == "stopping" else "up"
            elif r:
                state = "stopping" if self.phase == "stopping" else "starting"
            elif self.phase == "stopped":
                state = "off"
            elif self.phase == "starting":
                state = "starting" if sp.id in booting else "off" if not (old.get(sp.id) or {}).get("upSince") else "down"
            else:
                state = "down"
            prev = old.get(sp.id)
            up_since = prev.get("upSince") if prev and prev.get("state") == "up" else None
            if state == "up" and up_since is None:
                up_since = t
            p = {"id": sp.id, "kind": sp.kind, "name": sp.name, "layer": sp.layer, "state": state,
                 "ports": sp.ports, "controllable": sp.controllable}
            if sp.web:
                p["webUrl"] = f"http://localhost:{sp.web}"
            if sp.kind == "namenode" and state == "up" and sp.id in roles and self.config["namenodes"] > 1:
                p["role"] = roles[sp.id]
            if r and state in ("up", "starting", "stopping"):
                p["pid"] = r.get("pid")
                if r.get("memMb") is not None:
                    p["memMb"] = r["memMb"]
            if up_since:
                p["upSince"] = up_since
            out.append(p)
            # Avisos en la consola cuando algo se cae o vuelve con el cluster andando
            if self.phase == "running" and prev and prev["state"] != state:
                if state == "down" and prev["state"] == "up":
                    self.bus.log(sp.name, "warn", f"{sp.name} se apagó", processId=sp.id)
                elif state == "up":
                    self.bus.log(sp.name, "ok", f"{sp.name} arriba", processId=sp.id)
        self.processes = out
        sig = json.dumps([self.phase, [(p["id"], p["state"], p.get("role")) for p in out], self.hdfs, self.yarn],
                         sort_keys=True)
        if sig != self._last_sig or t - self._last_pub >= 10_000:
            self._last_sig, self._last_pub = sig, t
            self.bus.publish("status", {})

    # ------------------------------------------------- lo que piden las rutas

    def need_running(self) -> None:
        if self.phase != "running":
            raise ApiError("El cluster está apagado: arrancalo desde Cluster", "cluster_stopped")

    def need_hdfs(self) -> None:
        """HDFS tiene que estar respondiendo (cluster en marcha y un NameNode activo)."""
        self.need_running()
        if not self.hdfs.get("available") or (self.s.probe and not self.nn_active_port):
            raise ApiError("HDFS no responde: no hay ningún NameNode activo", "service_down")

    def need_proc(self, pid: str, name: str) -> None:
        """Un proceso tiene que estar arriba (rm, hiveserver2, sparkhistory...)."""
        self.need_running()
        p = next((x for x in self.processes if x["id"] == pid), None)
        if p is None and not any(sp.id == pid for sp in self.specs()):
            raise ApiError(f"{name} no está en esta configuración", "unsupported")
        if p is None or p["state"] != "up":
            raise ApiError(f"{name} está apagado", "service_down")

    # ------------------------------------------------------------- estado

    def status(self) -> dict:
        processes = self.processes or [
            {"id": p.id, "kind": p.kind, "name": p.name, "layer": p.layer,
             "state": "up" if p.id == "ui" else "off", "ports": p.ports, "controllable": p.controllable,
             **({"webUrl": f"http://localhost:{p.web}"} if p.web else {})}
            for p in self.specs()]
        return {
            "phase": self.phase,
            "config": self.config if self.phase != "stopped" else self.saved,
            "volumeNameNodes": self.volume().namenodes,
            "startedAt": self.startedAt,
            "now": now_ms(),
            "memory": {"limitMb": self.mem_limit or cfg.DOCKER_LIMIT_MB, "usedMb": self.mem_used,
                       "estimateMb": cfg.estimate_ram(self.config)["totalMb"], "history": list(self.mem_history)},
            "processes": processes,
            "hdfs": self.hdfs,
            "yarn": self.yarn,
            "boot": self.tracker.to_json() if self.tracker else None,
            "image": self.image,
        }
