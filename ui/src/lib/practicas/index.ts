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

export const PRACTICES: Practice[] = [hdfsBasico, hdfsFalla, mapreduce, pig, hive, mysqlSqoop, spark, ha, mongodb];

export const practiceById = (id: string) => PRACTICES.find(p => p.id === id);

export * from './tipos';
export * from './motor';
