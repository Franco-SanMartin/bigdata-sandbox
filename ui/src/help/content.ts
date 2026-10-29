/* Ayuda contextual de cada pantalla (panel "?") */
import type { PageId } from '../state/ui';

export interface Help { intro: string; terms: [string, string][] }

export const HELP: Record<PageId, Help> = {
  inicio: {
    intro: 'El estado del cluster en una línea, con el único botón que tiene sentido ahora (iniciar, ver el arranque, ver qué falla o detener). Abajo, qué podés hacer: cada tarjeta dice si está lista, por qué no y el botón que lo arregla.',
    terms: [
      ['Listo', 'Los procesos que hacen falta están arriba: se puede usar ya.'],
      ['Arrancando', 'Falta que termine de levantar algún proceso; se habilita solo.'],
      ['No disponible', 'Hace falta prender un servicio o cambiar la configuración. El botón de la tarjeta lo hace por vos.'],
      ['Degradado', 'Algo no responde pero no se perdió nada: por ejemplo, un DataNode caído con réplica 2. HDFS re-replica solo.'],
      ['Con fallas', 'Algo importante no anda: el NameNode, el ResourceManager o bloques sin ninguna copia.'],
      ['Lo que tenés', 'Archivos en HDFS, tablas de Hive, trabajos y modelos que ya hay en el volumen.'],
    ],
  },
  practicas: {
    intro: 'Recorridos paso a paso por lo que se ve en la materia: HDFS, MapReduce, Hive, Sqoop, Spark, alta disponibilidad. Cada paso se puede hacer desde la interfaz o copiando el comando.',
    terms: [['Práctica', 'Una guía corta con un objetivo y pasos verificables.'], ['Progreso', 'Se guarda en este navegador.']],
  },
  cluster: {
    intro: 'El estado de todos los procesos del contenedor. Cada NameNode, DataNode y servicio es un proceso aparte, con su puerto y su página web. Desde acá se arranca, se detiene y se prende o apaga cada uno.',
    terms: [
      ['NameNode', 'Guarda los metadatos de HDFS: qué archivos hay y en qué DataNode está cada bloque. Si es uno solo y se cae, HDFS deja de responder.'],
      ['DataNode', 'Guarda los bloques. Avisa que está vivo cada 3 s (latido). Sin latidos durante 40 s, el NameNode lo da por muerto y copia sus bloques a otros nodos.'],
      ['Alta disponibilidad', 'Con 2 o 3 NameNodes, uno está activo y el resto en espera. ZooKeeper elige al activo; los JournalNodes mantienen al día a los que esperan.'],
      ['ResourceManager', 'El de YARN: reparte los 4 GB de memoria entre los trabajos.'],
      ['Arranque', 'La primera vez formatea HDFS y carga las bases de ejemplo (unos 2 minutos). Después solo levanta los procesos.'],
      ['Re-replicación', 'Cuando un DataNode muere, el NameNode copia sus bloques a los vivos hasta volver a la réplica pedida. Mientras tanto el cluster figura Degradado.'],
      ['Sinóptico', 'El diagrama de arriba: cada lámpara es un proceso (verde arriba, ámbar en transición, rojo caído, gris apagado). Tocá uno para ver su detalle; queda en la dirección (#cluster/dn2) para compartirlo.'],
    ],
  },
  hdfs: {
    intro: 'El sistema de archivos distribuido. Navegá las carpetas, abrí un archivo para ver en qué bloques se cortó y en qué DataNodes está cada copia, subí o borrá archivos, corré fsck y mirá cómo el NameNode re-replica cuando apagás un DataNode.',
    terms: [
      ['Bloque', 'HDFS corta cada archivo en pedazos del tamaño de BLOCK_SIZE. El último puede ser más chico.'],
      ['Réplica', 'Cada bloque se guarda en tantos DataNodes como diga REPLICATION, nunca dos copias en el mismo nodo.'],
      ['Sub-replicado', 'Un bloque con menos copias de las pedidas: pasa cuando se cae un DataNode o hay menos nodos que REPLICATION.'],
      ['fsck', 'hdfs fsck revisa todos los bloques y dice si falta alguno, si hay copias de menos o de más.'],
      ['Re-replicación', 'Cuando el NameNode da por muerto a un DataNode (40 s sin latidos), copia sus bloques a otros nodos desde las copias que quedan.'],
    ],
  },
  yarn: {
    intro: 'Cómo YARN reparte los 4 GB y los 4 vcores del NodeManager entre los trabajos. Abrí un trabajo para ver su DAG (MapReduce, Tez o Spark), qué tarea leyó qué bloque, sus contadores y los logs de cada contenedor.',
    terms: [
      ['ApplicationMaster', 'El primer contenedor de cada trabajo: pide memoria y reparte las tareas.'],
      ['Contenedor', 'Un pedazo de memoria (múltiplo de 512 MB) y un vcore, donde corre una tarea o un executor.'],
      ['DAG', 'El grafo de etapas del trabajo. Una flecha es un shuffle: los datos se reparten por clave entre las tareas de la etapa siguiente.'],
      ['Executor', 'En Spark, un contenedor que queda vivo todo el trabajo y corre muchas tareas.'],
    ],
  },
  pipeline: {
    intro: 'De ventas_sucias.csv a un resumen y un modelo: ingesta, ETL, almacenamiento, análisis, ML y resultados. En cada etapa elegís la herramienta y ves cuándo conviene; el riel de la derecha muestra en qué etapa estás, qué sigue y qué motor está trabajando.',
    terms: [
      ['Motor', 'Sqoop corre sobre MapReduce, Hive sobre Tez, PySpark sobre Spark y pandas o scikit-learn en una sola máquina.'],
      ['ETL', 'Extraer, transformar y cargar: acá, pasar de 103.000 filas sucias a 97.200 limpias.'],
      ['Parquet', 'Formato por columnas y comprimido: se lee solo lo que se usa.'],
      ['Tabla externa', 'Hive anota dónde están los archivos y qué columnas tienen, sin moverlos. Borrar la tabla no borra los datos.'],
    ],
  },
  datos: {
    intro: 'Las tablas de Hive, la base tienda de MySQL y las colecciones de MongoDB: catálogo, esquema, consultas con resultado en tabla y el plan de cada consulta, con el motor que la resuelve.',
    terms: [
      ['Hive', 'SQL sobre archivos de HDFS. Si hay que agrupar o unir, lanza un trabajo Tez en YARN; un SELECT con LIMIT lo lee directo.'],
      ['MySQL', 'Base relacional de una sola máquina: rápida para consultas chicas y con índices.'],
      ['MongoDB', 'Base de documentos: cada pedido trae sus ítems adentro. Sin índice, recorre toda la colección (COLLSCAN).'],
      ['Plan', 'Lo que el motor va a hacer para resolver la consulta: EXPLAIN en Hive y MySQL, explain() en MongoDB.'],
    ],
  },
  ml: {
    intro: 'Un estudio de ML de punta a punta: elegís los datos (/datos, HDFS o Hive), el objetivo y el rol de cada columna, el preprocesamiento, el modelo con todos sus hiperparámetros, la validación y la búsqueda. Cada corrida es un script de Python completo que podés ver, editar, correr y bajar como .py o notebook, y queda guardada como experimento para compararla.',
    terms: [
      ['Receta', 'Todo lo que define un experimento (datos, variables, preprocesamiento, modelo, validación y búsqueda). La misma receta da siempre el mismo resultado.'],
      ['Pipeline', 'El preprocesamiento y el modelo en un solo objeto: aprende solo con el entrenamiento y se aplica igual al predecir. Así no hay fuga de datos.'],
      ['Validación cruzada', 'Partir el entrenamiento en k partes y validar k veces: da la métrica con su desvío.'],
      ['Búsqueda de hiperparámetros', 'Probar combinaciones (grilla, al azar o successive halving) y quedarse con la mejor según la validación cruzada.'],
      ['Fuga de datos', 'Una columna que no estaría disponible al predecir (o que sale del objetivo): el modelo parece perfecto y en la vida real falla.'],
      ['Regresión', 'Predecir un número (cuánto va a gastar). Se mide con R²: 1 es perfecto.'],
      ['Clasificación', 'Predecir una categoría (si vuelve o no). Se mide con el porcentaje de aciertos.'],
      ['Agrupamiento', 'Encontrar grupos sin decirle la respuesta (KMeans). Se compara con los grupos reales con el índice de Rand ajustado.'],
      ['Entrenar y probar', 'El modelo aprende con una parte de las filas y se mide con las que no vio.'],
    ],
  },
  consola: {
    intro: 'Todo lo que pasó en el cluster. Elegí un evento a la izquierda y a la derecha ves el comando exacto (con botón para copiarlo), lo que entró, lo que hizo y lo que salió. También está abajo en cualquier pantalla con Ctrl+J.',
    terms: [
      ['Origen', 'Quién lo hizo o lo informó: Vos (tus acciones desde la interfaz), el Cluster, un NameNode, un DataNode, YARN…'],
      ['Problemas', 'Avisos y errores: nodos caídos, bloques perdidos, procesos que no responden.'],
      ['Flechas', 'Con la lista enfocada, ↑ y ↓ recorren los eventos. Cada uno tiene su dirección (#consola/<id>).'],
    ],
  },
  config: {
    intro: 'Los parámetros del contenedor (las variables de entorno del docker-compose.yml). Se guardan y se aplican reiniciando el cluster; los datos quedan en el volumen.',
    terms: [
      ['DATANODES', 'Cuántos DataNodes levantar, de 1 a 9. Cada uno suma unos 250 MB.'],
      ['REPLICATION', 'Copias de cada bloque. Si es mayor que DATANODES, los bloques quedan sub-replicados.'],
      ['BLOCK_SIZE', 'Tamaño de bloque. Con 1m un archivo chico ya se ve repartido en varios bloques; 128m es el de un cluster real.'],
      ['NAMENODES', 'Queda fijo en el volumen. Para cambiarlo hay que borrar el volumen.'],
      ['SERVICIOS', 'hdfs: solo HDFS. mapreduce: suma YARN, MapReduce, Pig, Sqoop y MySQL. todo: suma Hive y Spark.'],
      ['Antes → Después', 'Cuando cambiás algo aparece abajo una barra con cada cambio, qué implica y los botones para guardarlo o descartarlo.'],
    ],
  },
};

export const SHORTCUTS: [string, string][] = [
  ['Buscar o ejecutar', 'Ctrl+K'], ['Consola', 'Ctrl+J'], ['Ayuda', '?'],
  ['Ir a Cluster', 'G C'], ['Ir a HDFS', 'G H'], ['Ir a YARN', 'G Y'], ['Ir al Pipeline', 'G P'], ['Ir a Datos', 'G D'], ['Ir a Machine Learning', 'G M'],
  ['Ir a la Consola', 'G O'], ['Ir a Configuración', 'G S'],
];
