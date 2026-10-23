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
  /** El comando equivalente en la terminal del contenedor */
  command: string;
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
  /** Qué te llevás, 2-3 viñetas */
  learn: string[];
  steps: Step[];
}
