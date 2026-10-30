import { Boxes, Braces, Brain, Database, GitCompareArrows, GraduationCap, HardDrive, Home, LayoutGrid, Server, Settings2, SquareTerminal, Table2, Workflow, type LucideIcon } from 'lucide-react';
import type { PageId } from '../state/ui';
import type { CapaId } from '../lib/ecosistema';

/** La barra sigue las capas del mapa de Inicio (D-05): dónde quedan los datos, quién reparte la
    máquina, qué hace las cuentas y cómo entran. Empezar va arriba; Operar (el tablero) abajo */
export const NAV_GROUPS = ['Empezar', 'Almacenamiento', 'Recursos', 'Procesamiento', 'Ingesta', 'Operar'] as const;
export type NavGroup = typeof NAV_GROUPS[number];

/** Los grupos que son una capa del mapa: su color y qué entra ahí */
export const GROUP_CAPA: Partial<Record<NavGroup, { capa: CapaId; tip: string }>> = {
  Almacenamiento: { capa: 'datos', tip: 'Dónde quedan los datos: HDFS, las tablas y las bases' },
  Recursos: { capa: 'recursos', tip: 'Quién reparte la memoria y los núcleos de la máquina: YARN' },
  Procesamiento: { capa: 'motores', tip: 'Qué hace las cuentas (MapReduce, Tez, Spark) y con qué lenguaje se las pedís' },
  Ingesta: { capa: 'puente', tip: 'Cómo entran los datos al cluster y pasan de un lado a otro' },
};

/** soloAula: solo en el maestro del cluster del aula (versión empresa, ROL=maestro) */
export interface NavItem { id: PageId; label: string; icon: LucideIcon; key: string; group: NavGroup; title: string; soloAula?: boolean }

export const NAV: NavItem[] = [
  { id: 'inicio', label: 'Inicio', icon: Home, key: 'i', group: 'Empezar', title: 'Inicio' },
  { id: 'practicas', label: 'Prácticas', icon: GraduationCap, key: 'r', group: 'Empezar', title: 'Prácticas guiadas' },
  { id: 'hdfs', label: 'HDFS', icon: HardDrive, key: 'h', group: 'Almacenamiento', title: 'HDFS' },
  { id: 'tablas', label: 'Tablas', icon: Table2, key: 't', group: 'Almacenamiento', title: 'Tablas del Metastore' },
  { id: 'bases', label: 'Bases', icon: Database, key: 'b', group: 'Almacenamiento', title: 'Bases: MariaDB y MongoDB' },
  { id: 'yarn', label: 'Trabajos', icon: Boxes, key: 'y', group: 'Recursos', title: 'Trabajos en YARN' },
  { id: 'lenguajes', label: 'Lenguajes', icon: Braces, key: 'l', group: 'Procesamiento', title: 'Lenguajes: Hive y Pig' },
  { id: 'comparar', label: 'Comparar', icon: GitCompareArrows, key: 'k', group: 'Procesamiento', title: 'Comparar herramientas' },
  { id: 'ml', label: 'Machine Learning', icon: Brain, key: 'm', group: 'Procesamiento', title: 'Machine Learning' },
  { id: 'pipeline', label: 'Pipeline', icon: Workflow, key: 'p', group: 'Ingesta', title: 'Pipeline' },
  { id: 'aula', label: 'Aula', icon: LayoutGrid, key: 'a', group: 'Operar', title: 'El aula', soloAula: true },
  { id: 'cluster', label: 'Cluster', icon: Server, key: 'c', group: 'Operar', title: 'Cluster' },
  { id: 'consola', label: 'Consola', icon: SquareTerminal, key: 'o', group: 'Operar', title: 'Consola' },
  { id: 'config', label: 'Configuración', icon: Settings2, key: 's', group: 'Operar', title: 'Configuración' },
];
export const navById = (id: PageId) => NAV.find(n => n.id === id)!;
/** Lo que va en el menú: la vista Aula solo en el maestro del aula */
export const navVisible = (aula: boolean) => NAV.filter(n => !n.soloAula || aula);
