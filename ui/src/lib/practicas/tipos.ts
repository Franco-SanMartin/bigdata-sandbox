/* Prácticas guiadas: qué es una práctica, un paso y lo que deja cada paso.
   Cada paso sigue el patrón del proyecto: comando → qué entra → qué hace → resultado,
   con un Ejecutar que llama a la API de verdad (o al demo) y una verificación opcional. */
import type { ActionTrace, Cell, ClusterStatus, SandboxApi } from '../../api/types';
import type { CapId, Capability } from '../capabilities';
import type { PageId } from '../route';

/** Lo que se muestra debajo del paso después de ejecutarlo */
export type StepOut =
  | { kind: 'table'; columns: string[]; rows: Cell[][]; total?: number }
  | { kind: 'text'; text: string }
  | { kind: 'kv'; items: [string, string][] };

/** Lo que deja un paso al ejecutarse */
export interface StepResult {
  /** Una línea: qué pasó */
  summary: string;
  out?: StepOut;
  trace?: ActionTrace;
  /** Valores para los pasos siguientes (el id del trabajo, el NameNode que estaba activo…) */
  vars?: Record<string, string>;
  /** Dónde mirarlo en la interfaz */
  link?: { label: string; page: PageId; arg?: string };
  /** La salida del comando como se ve en la terminal */
  raw?: RawOut;
}

/** Salida de un comando, como en la terminal: lo que imprimió por stdout y stderr */
export interface RawOut {
  /** El comando que corrió */
  command: string;
  lines: { stream: 'out' | 'err'; text: string }[];
  exitCode?: number;
  /** proceso: lo que imprimió el comando de verdad · armada: armada con lo que respondió el servicio
      (WebHDFS, JMX, el modo demo), con el mismo formato que en la terminal · terminal: lo que imprimió
      en la terminal integrada del alumno ("Correr en la terminal") */
  origen: 'proceso' | 'armada' | 'terminal';
  /** Una aclaración corta (por qué no hay salida, de dónde salió) */
  nota?: string;
}

/** Una respuesta posible del multiple choice */
export interface Opcion {
  /** El comando (puede tener {variables}, igual que Step.command) */
  cmd: string;
  correcta?: boolean;
  /** Por qué es la correcta, o qué haría / qué error daría si no lo es */
  porque: string;
}

/** La pregunta antes de ejecutar: "ahora queremos X, ¿cuál es el comando?" */
export interface Pregunta {
  enunciado: string;
  opciones: Opcion[];
}

/** Dónde queda cada cosa después del paso */
export interface Donde {
  /** En el contenedor (rutas locales, procesos, bases) */
  contenedor?: string;
  /** En HDFS (rutas de HDFS, bloques) */
  hdfs?: string;
  /** En YARN (trabajos, contenedores, logs) */
  yarn?: string;
  /** En tu compu (el navegador, Descargas) */
  compu?: string;
}

export interface Check {
  ok: boolean;
  /** Qué se miró y qué dio */
  detail: string;
}

/** Lo que recibe un paso para correr */
export interface StepCtx {
  api: SandboxApi;
  /** El estado del cluster recién pedido */
  status: () => Promise<ClusterStatus>;
  /** Lo que dejaron los pasos anteriores */
  vars: Record<string, string>;
  /** Espera (en el demo y en los tests se puede acelerar) */
  sleep: (ms: number) => Promise<void>;
  /** Para avisar en qué está mientras espera ("esperando a que termine el trabajo…") */
  progress?: (msg: string) => void;
}

/** Requisito propio de una práctica o paso además de su capacidad (p. ej. 2 DataNodes o más) */
export type Requirement = (s: ClusterStatus) => Capability | null;

export interface Step {
  id: string;
  title: string;
  /** El comando en la terminal del contenedor. Puede tener {variables}: salen de plan() o de lo que
      dejaron los pasos anteriores, y son las mismas que usa run (una sola fuente para lo que se muestra
      y lo que corre) */
  command: string;
  /** Dónde se escribe el comando si no es la terminal del contenedor (la consola de Hive, el navegador…) */
  en?: string;
  /** Calcula, con el estado del cluster, las variables que el paso usa antes de correr (qué DataNode
      apagar, por ejemplo). Lo que ya dejó un paso anterior gana */
  plan?: (s: ClusterStatus, vars: Record<string, string>) => Record<string, string>;
  /** Lo que calcula plan() queda fijo desde que se muestra el paso (se guarda en las variables): si el
      alumno lo hace en la terminal, el cluster cambia y plan() ya no daría lo mismo (apagado el DataNode 3,
      "el último prendido" pasa a ser el 2) */
  fija?: boolean;
  /** Multiple choice antes de ejecutar */
  pregunta?: Pregunta;
  /** Dónde queda cada cosa después del paso (puede tener {variables}) */
  donde?: Donde;
  /** Qué entra */
  input: string;
  /** Qué hace, en una o dos líneas */
  does: string;
  /** Qué tiene que dar */
  expect: string;
  /** La capacidad que necesita para ejecutarse (si no, la de la práctica) */
  cap?: CapId;
  needs?: Requirement;
  /** Lo corre de verdad. Sin run, el paso es solo de verificar */
  run?: (c: StepCtx) => Promise<StepResult>;
  /** Mira que haya quedado como dice expect */
  verify?: (c: StepCtx) => Promise<Check>;
  /** Un dato para pensar, corto */
  tip?: string;
}

export interface Practice {
  id: string;
  /** Número de guía del repo (03, 04…) */
  guide: string;
  /** Nombre del archivo de la guía en guias/ */
  guideFile: string;
  title: string;
  /** Una línea: qué se aprende */
  summary: string;
  minutes: number;
  /** La capacidad principal: si no está, la práctica avisa con el arreglo */
  cap: CapId;
  needs?: Requirement;
  /** Lo que tiene que estar hecho antes, en una línea */
  before?: string;
  /** Prácticas que conviene tener hechas antes (ids) */
  after?: string[];
  /** Qué te llevás, 2-3 viñetas */
  learn: string[];
  steps: Step[];
}
