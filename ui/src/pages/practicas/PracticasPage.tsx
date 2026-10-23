/* Prácticas guiadas. Por ahora la lista de lo que viene; las guías paso a paso las agrega su paquete. */
import { BookOpen } from 'lucide-react';
import { navigate } from '../../state/ui';
import { EmptyState, PageHeader } from '../../components/base';

const PLANEADAS = [
  'HDFS básico: subir, listar, ver bloques y réplicas',
  'HDFS ante fallas: apagar un DataNode y ver la re-replicación',
  'MapReduce: WordCount y Pi en YARN',
  'Pig Latin: LOAD, FILTER, GROUP y DUMP',
  'Hive: tablas externas y consultas en Tez',
  'MariaDB y Sqoop: de la base relacional a HDFS',
  'Spark: el mismo cálculo en memoria',
  'Alta disponibilidad: failover del NameNode con ZooKeeper',
  'MongoDB: documentos, find y aggregate',
];

export function PracticasPage() {
  return (
    <div className="page-in">
      <PageHeader title="Prácticas" sub="Recorridos paso a paso por lo que se ve en la materia." />
      <EmptyState icon={<BookOpen size={20} aria-hidden="true" />} title="Las prácticas guiadas están en camino" list={PLANEADAS}
        actions={<button type="button" className="btn btn-primary" onClick={() => navigate('inicio')}>Ver qué se puede hacer ahora</button>}>
        Mientras tanto, cada pantalla tiene su ayuda con <kbd>?</kbd>. Van a llegar estas:
      </EmptyState>
    </div>
  );
}
