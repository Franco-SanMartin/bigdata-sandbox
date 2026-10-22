import { Boxes, Brain, Database, HardDrive, Server, Settings2, SquareTerminal, Workflow, type LucideIcon } from 'lucide-react';
import type { PageId } from '../state/ui';

export interface NavItem { id: PageId; label: string; icon: LucideIcon; key: string; group: 'Operación' | 'Datos' | 'Sistema'; title: string }

export const NAV: NavItem[] = [
  { id: 'cluster', label: 'Cluster', icon: Server, key: 'c', group: 'Operación', title: 'Cluster' },
  { id: 'hdfs', label: 'HDFS', icon: HardDrive, key: 'h', group: 'Operación', title: 'HDFS' },
  { id: 'yarn', label: 'YARN y trabajos', icon: Boxes, key: 'y', group: 'Operación', title: 'YARN y trabajos' },
  { id: 'pipeline', label: 'Pipeline', icon: Workflow, key: 'p', group: 'Datos', title: 'Pipeline' },
  { id: 'datos', label: 'Datos', icon: Database, key: 'd', group: 'Datos', title: 'Datos: Hive, MySQL y MongoDB' },
  { id: 'ml', label: 'Machine Learning', icon: Brain, key: 'm', group: 'Datos', title: 'Machine Learning' },
  { id: 'consola', label: 'Consola', icon: SquareTerminal, key: 'o', group: 'Sistema', title: 'Consola' },
  { id: 'config', label: 'Configuración', icon: Settings2, key: 's', group: 'Sistema', title: 'Configuración' },
];
export const navById = (id: PageId) => NAV.find(n => n.id === id)!;
