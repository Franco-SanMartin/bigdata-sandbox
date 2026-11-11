/* Las prácticas guiadas, en el orden de las guías. */
import { hdfsBasico, hdfsFalla } from './03-hdfs';
import { mapreduce } from './04-mapreduce';
import { pig } from './05-pig';
import { hive } from './06-hive';
import { mysqlSqoop } from './07-mysql-sqoop';
import { spark } from './08-spark';
import { ha } from './09-ha';
import { mongodb } from './10-mongodb';
import type { Practice } from './tipos';
import type { CapaId } from '../ecosistema';

export const PRACTICES: Practice[] = [hdfsBasico, hdfsFalla, mapreduce, pig, hive, mysqlSqoop, spark, ha, mongodb];

/** Cómo se muestran: por capa, como la barra y el mapa de Inicio. Los ids y el orden de
    PRACTICES (el de las guías de la materia) no cambian: lo usan el humo y el avance guardado */
export const POR_CAPA: { capa?: CapaId; titulo: string; sub: string; ids: string[] }[] = [
  { capa: 'datos', titulo: 'Almacenamiento', sub: 'Dónde viven los datos: HDFS y una base de documentos', ids: ['hdfs-basico', 'hdfs-falla', 'mongodb'] },
  { capa: 'recursos', titulo: 'Recursos', sub: 'YARN reparte la máquina: el primer trabajo', ids: ['mapreduce'] },
  { capa: 'motores', titulo: 'Procesamiento', sub: 'Lenguajes y motores: la misma idea, escrita de otra forma', ids: ['pig', 'hive', 'spark'] },
  { capa: 'puente', titulo: 'Ingesta', sub: 'Cómo entran los datos desde una base', ids: ['mysql-sqoop'] },
  { titulo: 'Alta disponibilidad', sub: 'Qué pasa cuando se cae el NameNode', ids: ['ha'] },
];

/** Las de procesamiento terminan con la misma cuenta en las otras herramientas: la pregunta de Comparar que abren */
export const PROBALO: Record<string, string> = { mapreduce: 'quien-hace-el-trabajo', pig: 'como-lo-pido', hive: 'como-lo-pido', spark: 'quien-hace-el-trabajo' };

export const practiceById = (id: string) => PRACTICES.find(p => p.id === id);

export * from './tipos';
export * from './motor';
export * from './autoeval';
