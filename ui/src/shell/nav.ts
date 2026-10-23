import { Boxes, Brain, Database, GraduationCap, HardDrive, Home, Server, Settings2, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import type { PageId } from '../state/ui';

/** Empezar: dónde estoy y qué hago. Trabajar: lo que se hace con los datos. Operar: el cluster en sí */
export const NAV_GROUPS = ['Empezar', 'Trabajar', 'Operar'] as const;
export type NavGroup = typeof NAV_GROUPS[number];

export interface NavItem { id: PageId; label: string; icon: LucideIcon; key: string; group: NavGroup; title: string }

export const NAV: NavItem[] = [
  { id: 'inicio', label: 'Inicio', icon: Home, key: 'i', group: 'Empezar', title: 'Inicio' },
  { id: 'practicas', label: 'Prácticas', icon: GraduationCap, key: 'r', group: 'Empezar', title: 'Prácticas guiadas' },
  { id: 'hdfs', label: 'HDFS', icon: HardDrive, key: 'h', group: 'Trabajar', title: 'HDFS' },
  { id: 'yarn', label: 'Trabajos', icon: Boxes, key: 'y', group: 'Trabajar', title: 'Trabajos en YARN' },
  { id: 'datos', label: 'Consultas', icon: Database, key: 'd', group: 'Trabajar', title: 'Consultas: Hive, MariaDB, MongoDB y Pig' },
  { id: 'pipeline', label: 'Pipeline', icon: Workflow, key: 'p', group: 'Trabajar', title: 'Pipeline' },
  { id: 'ml', label: 'Machine Learning', icon: Brain, key: 'm', group: 'Trabajar', title: 'Machine Learning' },
  { id: 'cluster', label: 'Cluster', icon: Server, key: 'c', group: 'Operar', title: 'Cluster' },
  { id: 'consola', label: 'Consola', icon: SquareTerminal, key: 'o', group: 'Operar', title: 'Consola' },
  { id: 'config', label: 'Configuración', icon: Settings2, key: 's', group: 'Operar', title: 'Configuración' },
];
export const navById = (id: PageId) => NAV.find(n => n.id === id)!;
