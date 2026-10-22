/* Ayuda contextual de cada pantalla (panel "?") */
import type { PageId } from '../state/ui';

export interface Help { intro: string; terms: [string, string][] }

export const HELP: Record<PageId, Help> = {
  cluster: {
    intro: 'El estado de todos los procesos del contenedor. Cada NameNode, DataNode y servicio es un proceso aparte, con su puerto y su página web. Desde acá se arranca, se detiene y se prende o apaga cada uno.',
    terms: [
      ['NameNode', 'Guarda los metadatos de HDFS: qué archivos hay y en qué DataNode está cada bloque. Si es uno solo y se cae, HDFS deja de responder.'],
      ['DataNode', 'Guarda los bloques. Avisa que está vivo cada 3 s (latido). Sin latidos durante 40 s, el NameNode lo da por muerto y copia sus bloques a otros nodos.'],
      ['Alta disponibilidad', 'Con 2 o 3 NameNodes, uno está activo y el resto en espera. ZooKeeper elige al activo; los JournalNodes mantienen al día a los que esperan.'],
      ['ResourceManager', 'El de YARN: reparte los 4 GB de memoria entre los trabajos.'],
      ['Arranque', 'La primera vez formatea HDFS y carga las bases de ejemplo (unos 2 minutos). Después solo levanta los procesos.'],
    ],
  },
  hdfs: { intro: 'El sistema de archivos distribuido: archivos, bloques, réplicas y DataNodes. Llega en la próxima entrega.', terms: [['Bloque', 'HDFS corta cada archivo en bloques del tamaño de BLOCK_SIZE.'], ['Réplica', 'Cada bloque se guarda en tantos DataNodes como diga REPLICATION.']] },
  yarn: { intro: 'La cola de YARN, la memoria por contenedor y el detalle de cada trabajo (DAG de Tez o de Spark). Llega en la próxima entrega.', terms: [['ApplicationMaster', 'El primer contenedor de cada trabajo: pide memoria y reparte las tareas.'], ['Contenedor', 'Un pedazo de memoria (múltiplo de 512 MB) donde corre una tarea.']] },
  pipeline: { intro: 'De un CSV a un modelo: ingesta, ETL, almacenamiento, análisis, ML y resultados, eligiendo la herramienta en cada etapa. Llega en la próxima entrega.', terms: [['Motor', 'Pig corre sobre MapReduce, Hive sobre Tez, PySpark sobre Spark y pandas en una sola máquina.']] },
  datos: { intro: 'Las tablas de Hive, la base tienda de MySQL y las colecciones de MongoDB, con consultas. Llega en la próxima entrega.', terms: [] },
  ml: { intro: 'Entrenamiento y comparación de modelos con scikit-learn y Spark MLlib. Llega en la próxima entrega.', terms: [] },
  consola: { intro: 'Todo lo que pasó en el cluster, con el comando exacto, lo que entró, lo que hizo y lo que salió. También está abajo en cualquier pantalla con Ctrl+J.', terms: [['Mis acciones', 'Lo que hiciste vos desde la interfaz.'], ['Problemas', 'Avisos y errores: nodos caídos, bloques perdidos, procesos que no responden.']] },
  config: {
    intro: 'Los parámetros del contenedor (las variables de entorno del docker-compose.yml). Se guardan y se aplican reiniciando el cluster; los datos quedan en el volumen.',
    terms: [
      ['DATANODES', 'Cuántos DataNodes levantar, de 1 a 9. Cada uno suma unos 250 MB.'],
      ['REPLICATION', 'Copias de cada bloque. Si es mayor que DATANODES, los bloques quedan sub-replicados.'],
      ['BLOCK_SIZE', 'Tamaño de bloque. Con 1m un archivo chico ya se ve repartido en varios bloques; 128m es el de un cluster real.'],
      ['NAMENODES', 'Queda fijo en el volumen. Para cambiarlo hay que borrar el volumen.'],
      ['SERVICIOS', 'hdfs: solo HDFS. mapreduce: suma YARN, MapReduce, Pig, Sqoop y MySQL. todo: suma Hive y Spark.'],
    ],
  },
};

export const SHORTCUTS: [string, string][] = [
  ['Buscar o ejecutar', 'Ctrl+K'], ['Consola', 'Ctrl+J'], ['Ayuda', '?'],
  ['Ir a Cluster', 'G C'], ['Ir a HDFS', 'G H'], ['Ir a YARN', 'G Y'], ['Ir a Configuración', 'G S'], ['Ir a la Consola', 'G O'],
];
