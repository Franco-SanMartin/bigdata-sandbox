/* Autoevaluación de cada práctica: 2-3 preguntas de concepto (no de comando: esas ya están en los pasos)
   y un desafío para hacer solo en la terminal, con pista y una solución que se ve si hace falta. */
import { VENTAS_DIR } from './comun';
import { SPARK_JAR } from '../jobs';

export interface AutoPregunta {
  enunciado: string;
  opciones: string[];
  /** Índice de la correcta */
  correcta: number;
  /** Por qué es esa (se muestra al responder) */
  porque: string;
}

export interface Desafio {
  enunciado: string;
  pista: string;
  /** Una solución posible */
  solucion: string;
  /** Dónde se escribe si no es la terminal del contenedor (beeline, mongosh, grunt>) */
  en?: string;
}

export interface Autoeval { preguntas: AutoPregunta[]; desafio: Desafio }

export const AUTOEVAL: Record<string, Autoeval> = {
  'hdfs-basico': {
    preguntas: [
      {
        enunciado: 'ventas_grandes.csv pesa unos 6 MB. Con bloques de 128 MB y réplica 3, ¿cuánto ocupa en los discos de los DataNodes?',
        opciones: ['Unos 6 MB', 'Unos 18 MB', '128 MB', '384 MB'], correcta: 1,
        porque: 'Un bloque ocupa lo que tiene adentro, no los 128 MB enteros: un bloque de 6 MB copiado 3 veces son unos 18 MB.',
      },
      {
        enunciado: '¿Quién sabe en qué DataNodes está cada bloque de un archivo?',
        opciones: ['Cada DataNode, que se lo pasa a los demás', 'El NameNode', 'El ResourceManager de YARN', 'El cliente que subió el archivo'], correcta: 1,
        porque: 'El NameNode guarda los metadatos (archivos, bloques y dónde está cada copia). Los DataNodes solo guardan bloques y le avisan qué tienen.',
      },
      {
        enunciado: 'Al leer un archivo con hdfs dfs -cat, ¿por dónde pasan los datos?',
        opciones: ['Del DataNode al cliente, directo', 'Todos por el NameNode', 'Por YARN', 'Por el disco local del contenedor'], correcta: 0,
        porque: 'El NameNode solo le dice al cliente dónde está cada bloque; los bytes los manda el DataNode. Así el NameNode no es un cuello de botella.',
      },
    ],
    desafio: {
      enunciado: 'Creá /user/root/prueba, subí ahí /datos/ejemplos/texto.txt y mostrá en cuántos bloques quedó y en qué DataNodes está cada copia.',
      pista: 'Son tres comandos: hdfs dfs -mkdir, hdfs dfs -put y hdfs fsck con -files -blocks -locations.',
      solucion: 'hdfs dfs -mkdir -p /user/root/prueba\nhdfs dfs -put -f /datos/ejemplos/texto.txt /user/root/prueba/\nhdfs fsck /user/root/prueba -files -blocks -locations',
    },
  },
  'hdfs-falla': {
    preguntas: [
      {
        enunciado: '¿Cómo se entera el NameNode de que un DataNode se cayó?',
        opciones: ['El DataNode le avisa antes de apagarse', 'Deja de recibir sus latidos (heartbeats)', 'Lo detecta el cliente al leer', 'Se lo avisa ZooKeeper'], correcta: 1,
        porque: 'Cada DataNode manda un latido cada pocos segundos. Si dejan de llegar, primero lo marca stale y, pasado el plazo, dead.',
      },
      {
        enunciado: 'Con 2 DataNodes y réplica 2, se apaga uno. ¿Qué pasa con el archivo?',
        opciones: ['Se pierde', 'Se sigue leyendo, pero sus bloques quedan sub-replicados', 'HDFS lo borra por seguridad', 'Pasa a solo lectura hasta que vuelva'], correcta: 1,
        porque: 'Queda una copia viva de cada bloque: se lee igual. fsck lo marca Under replicated porque no hay otro DataNode donde reponer la copia.',
      },
      {
        enunciado: 'Con 3 DataNodes o más, ¿qué hace el NameNode cuando uno queda dead?',
        opciones: ['Nada hasta que vuelva', 'Copia sus bloques a otros DataNodes para volver a la réplica pedida', 'Baja la réplica del archivo', 'Reinicia el DataNode'], correcta: 1,
        porque: 'Busca los bloques con menos copias y ordena copiarlos desde una copia viva a otro DataNode. Cuando termina, fsck vuelve a quedar sano solo.',
      },
    ],
    desafio: {
      enunciado: 'Sin apagar nada: averiguá cuántos DataNodes están vivos y si hay bloques sub-replicados en todo HDFS.',
      pista: 'hdfs dfsadmin -report da los DataNodes vivos; hdfs fsck / da el resumen de todo el sistema de archivos.',
      solucion: 'hdfs dfsadmin -report | grep -E "Live datanodes|Dead datanodes"\nhdfs fsck / | grep -iE "under.replicated|status"',
    },
  },
  mapreduce: {
    preguntas: [
      {
        enunciado: 'En wordcount, ¿qué emite cada map por cada palabra que lee?',
        opciones: ['La palabra y la cantidad total', 'El par (palabra, 1)', 'La línea entera', 'Nada: el reduce lee el archivo'], correcta: 1,
        porque: 'El map no sabe cuántas hay en total: emite (palabra, 1). El shuffle junta todos los pares de la misma palabra y el reduce los suma.',
      },
      {
        enunciado: '¿Qué pasa si volvés a correr el trabajo con la misma carpeta de salida?',
        opciones: ['Pisa el resultado', 'Agrega al resultado anterior', 'Falla: la carpeta de salida ya existe', 'Crea wc-out-2'], correcta: 2,
        porque: 'MapReduce no pisa resultados: si la salida existe falla con FileAlreadyExistsException. Hay que borrarla (hdfs dfs -rm -r) o usar otra.',
      },
      {
        enunciado: '¿Quién reparte los contenedores del trabajo entre los NodeManagers?',
        opciones: ['El NameNode', 'El ResourceManager de YARN', 'El DataNode', 'hadoop jar'], correcta: 1,
        porque: 'El ResourceManager asigna los recursos; el ApplicationMaster del trabajo le pide contenedores y lanza ahí los map y los reduce.',
      },
    ],
    desafio: {
      enunciado: 'Contá las palabras de texto.txt de nuevo, pero dejá el resultado en /user/root/wc-out2 y mostrá las 5 palabras más repetidas.',
      pista: 'El mismo hadoop jar con otra carpeta de salida; después hdfs dfs -cat del part-r-00000, ordenado por la segunda columna.',
      solucion: 'hadoop jar hadoop-mapreduce-examples-3.3.6.jar wordcount /user/root/texto.txt /user/root/wc-out2\nhdfs dfs -cat /user/root/wc-out2/part-r-00000 | sort -k2 -nr | head -5',
    },
  },
  pig: {
    preguntas: [
      {
        enunciado: '¿Cuándo corre de verdad un script de Pig?',
        opciones: ['En cada línea que se escribe', 'Recién con DUMP o STORE', 'Al hacer LOAD', 'Al salir de grunt'], correcta: 1,
        porque: 'Pig va armando el plan con cada sentencia y recién lo ejecuta cuando le pedís un resultado (DUMP o STORE). Ahí lo convierte en trabajos.',
      },
      {
        enunciado: '¿Por qué el script hace FILTER ventas BY fecha != \'fecha\'?',
        opciones: ['Para sacar las fechas vacías', 'Para sacar el encabezado del CSV', 'Para ordenar por fecha', 'Porque Pig lo pide siempre'], correcta: 1,
        porque: 'PigStorage lee el archivo tal cual: la primera línea (fecha,sucursal,…) llegaría como una venta más.',
      },
    ],
    desafio: {
      enunciado: 'En grunt>: cuántas ventas (filas) hay por sucursal.',
      pista: 'Después del LOAD y el FILTER del encabezado: GROUP filas BY sucursal y un FOREACH con COUNT.',
      en: 'En la consola de Pig (pig, el prompt grunt>)',
      solucion: `ventas = LOAD '${VENTAS_DIR}' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray, cantidad:int, precio:int);
filas = FILTER ventas BY fecha != 'fecha';
por_sucursal = GROUP filas BY sucursal;
cuentas = FOREACH por_sucursal GENERATE group AS sucursal, COUNT(filas) AS ventas;
DUMP cuentas;`,
    },
  },
  hive: {
    preguntas: [
      {
        enunciado: 'La tabla ventas es EXTERNAL. ¿Qué pasa con los archivos de HDFS si hacés DROP TABLE ventas?',
        opciones: ['Se borran', 'Quedan: solo se borra la definición de la tabla', 'Se mueven a la papelera de Hive', 'Hive no deja borrarla'], correcta: 1,
        porque: 'En una tabla externa Hive solo guarda el esquema en el metastore; los datos son de quien los puso en HDFS. Con una tabla administrada sí se borrarían.',
      },
      {
        enunciado: '¿Dónde se guarda el esquema (columnas y tipos) de la tabla?',
        opciones: ['En el CSV', 'En el metastore de Hive', 'En el NameNode', 'En beeline'], correcta: 1,
        porque: 'El CSV no tiene tipos. Hive los guarda en el metastore y los aplica al leer (schema on read).',
      },
      {
        enunciado: '¿Por qué SELECT * FROM ventas LIMIT 5 contesta mucho más rápido que el GROUP BY?',
        opciones: ['Porque usa un índice', 'Porque lee unas filas directo, sin lanzar un trabajo en YARN', 'Porque está en caché', 'Porque usa otro motor de base'], correcta: 1,
        porque: 'Una lectura simple con LIMIT la resuelve Hive leyendo el archivo (fetch task). Agrupar necesita recorrer todo y lanza un trabajo de Tez en YARN.',
      },
    ],
    desafio: {
      enunciado: 'En beeline: qué sucursal vendió más unidades del producto que más facturó.',
      pista: 'Sacá primero el producto con más facturado (ya lo viste en un paso) y después filtrá por él agrupando por sucursal.',
      en: 'En beeline, la consola de Hive (beeline -u jdbc:hive2://localhost:10000)',
      solucion: `WITH top AS (
  SELECT producto FROM ventas GROUP BY producto
  ORDER BY SUM(CAST(cantidad AS BIGINT) * precio) DESC LIMIT 1
)
SELECT v.sucursal, SUM(v.cantidad) AS unidades
FROM ventas v JOIN top t ON v.producto = t.producto
GROUP BY v.sucursal
ORDER BY unidades DESC
LIMIT 1;`,
    },
  },
  'mysql-sqoop': {
    preguntas: [
      {
        enunciado: 'En sqoop import, ¿qué hace -m 4?',
        opciones: ['Usa 4 GB de memoria', 'Parte la tabla en 4 y la copian 4 tareas map en paralelo', 'Hace 4 reintentos', 'Guarda 4 réplicas'], correcta: 1,
        porque: 'Sqoop lanza un trabajo de MapReduce solo con maps; cada uno lee un rango de la clave primaria. Por eso quedan 4 archivos part-m-0000N.',
      },
      {
        enunciado: '¿Qué hace --delete-target-dir?',
        opciones: ['Borra la tabla de MariaDB al terminar', 'Borra la carpeta de HDFS antes de importar, si ya existe', 'Borra los archivos temporales', 'Nada si la carpeta no existe, y si existe falla'], correcta: 1,
        porque: 'Igual que MapReduce, Sqoop falla si la carpeta de salida existe. Con esta opción la borra antes y se puede volver a correr.',
      },
    ],
    desafio: {
      enunciado: 'Importá solo la tabla productos a /user/root/tienda/productos con una sola tarea y mostrá lo que quedó.',
      pista: 'El mismo sqoop import con --table productos, -m 1 y otra --target-dir; después hdfs dfs -cat.',
      solucion: 'sqoop import --connect jdbc:mysql://localhost/tienda --username alumno --password alumno --table productos -m 1 --target-dir /user/root/tienda/productos --delete-target-dir\nhdfs dfs -cat /user/root/tienda/productos/part-m-00000 | head',
    },
  },
  spark: {
    preguntas: [
      {
        enunciado: '¿Qué corta un trabajo de Spark en etapas (stages)?',
        opciones: ['Cada línea del programa', 'Cada shuffle (cuando hay que reagrupar datos entre máquinas)', 'Cada archivo leído', 'La cantidad de ejecutores'], correcta: 1,
        porque: 'Mientras cada partición se procesa sola (map, filter) todo va en la misma etapa. Un groupBy o un join necesita reagrupar: ahí empieza otra.',
      },
      {
        enunciado: 'Corriendo en YARN, ¿qué es el driver?',
        opciones: ['El proceso que arma el plan y reparte las tareas a los ejecutores', 'Un DataNode', 'El que guarda los datos en memoria', 'El History Server'], correcta: 0,
        porque: 'El driver corre tu programa, arma el DAG y manda tareas a los ejecutores, que son contenedores de YARN.',
      },
      {
        enunciado: 'Frente a MapReduce, ¿dónde gana Spark?',
        opciones: ['Siempre, en cualquier trabajo', 'En los cálculos de varios pasos: deja los resultados intermedios en memoria', 'Solo en archivos chicos', 'En que no necesita YARN'], correcta: 1,
        porque: 'MapReduce escribe a disco entre un trabajo y el siguiente; Spark encadena etapas en memoria. En un trabajo de una pasada la diferencia es chica.',
      },
    ],
    desafio: {
      enunciado: 'Corré SparkPi con 10 particiones en vez de 2 y fijate cuántas tareas tuvo la etapa.',
      pista: 'El último argumento de SparkPi es la cantidad de particiones; las tareas se ven en el History Server (http://localhost:18080).',
      solucion: `spark-submit --class org.apache.spark.examples.SparkPi ${SPARK_JAR} 10`,
    },
  },
  ha: {
    preguntas: [
      {
        enunciado: '¿Quién decide qué NameNode pasa a activo cuando se cae el que estaba?',
        opciones: ['El DataNode que se da cuenta primero', 'El ZKFC, con un lock en ZooKeeper', 'El cliente hdfs', 'Un socio con hdfs haadmin'], correcta: 1,
        porque: 'Cada NameNode tiene un ZKFailoverController. El del activo tiene el lock en ZooKeeper; si se cae, el lock se libera y el otro lo toma y pasa a active.',
      },
      {
        enunciado: '¿Cómo tiene el standby los mismos metadatos que el activo?',
        opciones: ['Copia el fsimage cada hora', 'Lee las ediciones que el activo escribe en los JournalNodes', 'Los DataNodes se los mandan', 'No los tiene: los pide al pasar a activo'], correcta: 1,
        porque: 'El activo escribe cada cambio en los JournalNodes y el standby los va aplicando. Por eso puede tomar el control en segundos.',
      },
    ],
    desafio: {
      enunciado: 'Sin apagar nada: mostrá qué NameNode está activo y comprobá que HDFS responde por el nombre del servicio, no por una máquina.',
      pista: 'hdfs haadmin -getAllServiceState y un listado con la ruta completa hdfs://<nameservice>/ (el nameservice está en fs.defaultFS).',
      solucion: 'hdfs haadmin -getAllServiceState\nhdfs getconf -confKey fs.defaultFS\nhdfs dfs -ls "$(hdfs getconf -confKey fs.defaultFS)/user/root"',
    },
  },
  mongodb: {
    preguntas: [
      {
        enunciado: 'En pedidos, ¿por qué buscar por cliente_id revisa pocos documentos y buscar por canal los revisa todos?',
        opciones: ['Porque cliente_id es un número', 'Porque hay un índice sobre cliente_id y no sobre canal', 'Porque canal es más largo', 'Por casualidad: depende del orden'], correcta: 1,
        porque: 'Con índice, explain muestra IXSCAN y totalDocsExamined parecido a los que devuelve. Sin índice hace COLLSCAN: lee la colección entera.',
      },
      {
        enunciado: 'En el aggregate, ¿qué hace { $group: { _id: "$canal", … } }?',
        opciones: ['Ordena por canal', 'Arma un documento por cada canal distinto, con los acumuladores', 'Filtra un canal', 'Crea un índice por canal'], correcta: 1,
        porque: '$group junta los documentos con el mismo valor de _id (acá, el canal) y calcula lo que pidas: $sum, $avg, etc. Es el GROUP BY de MongoDB.',
      },
    ],
    desafio: {
      enunciado: 'En mongosh: creá un índice sobre canal y comprobá con explain que la búsqueda por canal ya no recorre toda la colección.',
      pista: 'db.pedidos.createIndex({ canal: 1 }) y después el mismo find con explain("executionStats"): mirá totalDocsExamined y la etapa.',
      en: 'En mongosh (mongosh tienda)',
      solucion: 'db.pedidos.createIndex({ canal: 1 })\ndb.pedidos.find({ canal: "telefono" }).explain("executionStats").executionStats',
    },
  },
};
