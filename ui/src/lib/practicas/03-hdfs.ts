/* Guía 03: HDFS. Lo básico (carpetas, put, ls, cat, réplica, fsck, bajar) y qué pasa cuando se cae un DataNode.
   Lo que se muestra y lo que corre salen de lo mismo: los comandos con {variables} se llenan con plan()
   o con lo que dejó el paso anterior (el DataNode que se apagó es el que se vuelve a prender). */
import type { DataNode } from '../../api/types';
import { notThere, waitFor } from './motor';
import {
  VENTAS_DIR, VENTAS_FILE, actionRaw, armada, dnUp, ensureExample, entry, fileCheck, fsckRaw, lsOut, lsRaw, mbLabel,
  needDataNodes, textLines, waitAction,
} from './comun';
import type { Practice, StepCtx } from './tipos';
import { plural } from '../format';

const NAME = 'ventas_grandes.csv';
const LOCAL = `/datos/${NAME}`;
const OPEN_URL = `http://localhost:9870/webhdfs/v1${VENTAS_FILE}?op=OPEN&user.name=root`;

/** Las primeras líneas: hdfs dfs -cat si la interfaz lo tiene; si no, la vista previa del archivo */
async function head(c: StepCtx, path: string): Promise<{ text: string; command: string }> {
  try {
    const r = await c.api.hdfsCat(path, 0, 4096);
    return { text: r.binary ? '(el archivo es binario: no se muestra como texto)' : r.text, command: r.command };
  } catch (e) {
    if (!notThere(e)) throw e;
    const d = await c.api.hdfsFile(path);
    return { text: [d.preview.columns.join(','), ...d.preview.rows.map(r => r.join(','))].join('\n'), command: `hdfs dfs -cat ${path} | head` };
  }
}

/** -w salvo que falten DataNodes vivos para esa réplica: con menos, setrep -w no terminaría nunca (igual que
    el servidor). Sin -w el comando vuelve enseguida y el fsck de después marca sub-replicados aunque haya
    DataNodes de sobra, porque el NameNode todavía está copiando: por eso, ante la duda, va con -w */
const waitFlag = (live: number, n: number) => (live >= n || live === 0 ? '-w ' : '');

/** DataNodes prendidos o prendiéndose (los que van a poder recibir copias) */
const dnAlive = (s: Parameters<NonNullable<Practice['needs']>>[0]) =>
  s.processes.filter(p => p.kind === 'datanode' && (p.state === 'up' || p.state === 'starting')).length;

/** Cambia la réplica y espera, sin apurar al NameNode, a que estén las copias (o a que no haya dónde ponerlas).
    Sigue la acción del setrep -w si el servidor la da; si no (demo, servidor viejo), mira el listado */
async function setrep(c: StepCtx, n: number) {
  const live = dnUp(await c.status());
  const r = await c.api.setReplication(VENTAS_FILE, n);
  const id = r && typeof r === 'object' ? r.id : undefined;
  if (id) await waitAction(c, id, 300, `Esperando a que cada bloque tenga sus ${n} copias…`);
  const w = await waitFor(c, () => entry(c, VENTAS_DIR, NAME), e => e?.replication === n && (live < n || e.state !== 'under'),
    { seconds: 120, what: `Esperando a que cada bloque tenga sus ${n} copias…` });
  const fallback = textLines(`Replication ${n} set: ${VENTAS_FILE}${live >= n ? `\nWaiting for ${VENTAS_FILE} ... done` : ''}`);
  return { live, ok: w.ok, entry: w.value, raw: await actionRaw(c, id, fallback) };
}

/** hdfs dfsadmin -report, resumido, con lo que dice el NameNode de cada DataNode */
function reportLines(l: DataNode[]) {
  const live = l.filter(d => d.state === 'live' || d.state === 'stale');
  const dead = l.filter(d => d.state === 'dead');
  const one = (d: DataNode) => [`Name: 127.0.0.1:${d.dataPort} (DataNode ${d.id})`, `Num of Blocks: ${d.blocks}`,
    `Last contact: ${d.lastHeartbeat ? new Date(d.lastHeartbeat).toLocaleTimeString('es-AR') : '-'}${d.state === 'stale' ? '  (stale: sin latidos)' : ''}`, ''];
  return textLines([`Live datanodes (${live.length}):`, '', ...live.flatMap(one), `Dead datanodes (${dead.length}):`, '', ...dead.flatMap(one)].join('\n'));
}

export const hdfsBasico: Practice = {
  id: 'hdfs-basico', guide: '03', guideFile: '03-hdfs.md',
  title: 'HDFS: subir, mirar y replicar',
  summary: 'Creás una carpeta, subís 200.000 ventas, las leés, cambiás la réplica y revisás la salud con fsck.',
  minutes: 15, cap: 'hdfs.write',
  learn: ['Un archivo en HDFS es una lista de bloques repartidos en DataNodes', 'La réplica se cambia por archivo y el NameNode copia lo que falta', 'fsck dice si a algún bloque le faltan copias'],
  steps: [
    {
      id: 'mkdir', title: 'Crear la carpeta de las ventas',
      command: `hdfs dfs -mkdir -p ${VENTAS_DIR}`, input: 'La ruta de la carpeta',
      does: 'Solo anota la carpeta en el NameNode: ningún DataNode se entera.', expect: `${VENTAS_DIR} aparece en /user/root`,
      pregunta: {
        enunciado: `Ahora queremos crear la carpeta ${VENTAS_DIR} en HDFS (y las de arriba, si faltan). ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs dfs -mkdir -p ${VENTAS_DIR}`, correcta: true, porque: '-mkdir crea la carpeta en HDFS y -p crea también las de arriba si faltan (y no se queja si ya existe).' },
          { cmd: `mkdir -p ${VENTAS_DIR}`, porque: 'Es el mkdir de Linux: crea la carpeta en el disco del contenedor, no en HDFS. El NameNode ni se entera.' },
          { cmd: `hdfs dfs mkdir -p ${VENTAS_DIR}`, porque: 'Le falta el guion: los comandos de hdfs dfs van con - adelante (-mkdir). Así contesta "mkdir: Unknown command".' },
          { cmd: `hdfs dfs -put -p ${VENTAS_DIR}`, porque: '-put sube archivos desde el contenedor y acá no hay ninguno que subir (en -put, -p significa otra cosa: conservar fechas y permisos).' },
        ],
      },
      donde: {
        hdfs: `${VENTAS_DIR}, vacía. Solo existe en los metadatos del NameNode`,
        contenedor: 'Nada nuevo: no se crea ninguna carpeta en el disco del contenedor',
        compu: 'La ves en HDFS → Archivos, o en http://localhost:9870 → Utilities → Browse the file system',
      },
      run: async c => {
        const r = await c.api.hdfsMkdir(VENTAS_DIR);
        return { summary: r.trace.output || `Carpeta ${VENTAS_DIR}`, trace: r.trace, raw: await actionRaw(c, r.id), link: { label: 'Ver en HDFS', page: 'hdfs', arg: VENTAS_DIR } };
      },
      verify: async c => {
        const e = await entry(c, '/user/root', 'ventas');
        return e?.type === 'dir' ? { ok: true, detail: `${VENTAS_DIR} existe` } : { ok: false, detail: `No está ${VENTAS_DIR}` };
      },
    },
    {
      id: 'put', title: 'Subir ventas_grandes.csv',
      command: `hdfs dfs -put -f ${LOCAL} ${VENTAS_DIR}/`, input: `${LOCAL} (en el contenedor): 200.000 filas, unos 6 MB`,
      does: 'Lo corta en bloques y manda cada bloque a un DataNode, que lo pasa al siguiente hasta tener todas las copias.',
      expect: 'El archivo queda completo (no más ._COPYING_)',
      pregunta: {
        enunciado: `Ahora queremos meter el archivo que tenemos en el contenedor (${LOCAL}) dentro de HDFS, en ${VENTAS_DIR}. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs dfs -put -f ${LOCAL} ${VENTAS_DIR}/`, correcta: true, porque: '-put copia del disco del contenedor a HDFS: primero el origen (local) y después el destino (en HDFS). -f pisa el archivo si ya estaba.' },
          { cmd: `hdfs dfs -put -f ${VENTAS_DIR}/ ${LOCAL}`, porque: `Está al revés: -put va de origen local a destino en HDFS. Así busca ${VENTAS_DIR} en el disco del contenedor y no lo encuentra (No such file or directory).` },
          { cmd: `hdfs dfs -get ${LOCAL} ${VENTAS_DIR}/`, porque: `-get hace el camino contrario: baja de HDFS al contenedor. Buscaría ${LOCAL} en HDFS, donde no existe.` },
          { cmd: `hdfs dfs -cp ${LOCAL} ${VENTAS_DIR}/`, porque: `-cp copia de HDFS a HDFS: toma las dos rutas como de HDFS, y ${LOCAL} está en el disco del contenedor, no en HDFS.` },
        ],
      },
      donde: {
        contenedor: `${LOCAL} sigue ahí: -put copia, no mueve`,
        hdfs: `${VENTAS_FILE}, partido en bloques. Cada bloque vive en los DataNodes (en el contenedor, adentro de /hadoop/dfs/dnN)`,
        compu: 'Todavía nada',
      },
      run: c => ensureExample(c, VENTAS_DIR, NAME, 'ventas'),
      verify: c => fileCheck(c, VENTAS_DIR, NAME),
      tip: 'Mientras se escribe, HDFS lo muestra con ._COPYING_ al final: nadie lo ve a medias.',
    },
    {
      id: 'ls', title: 'Listar la carpeta',
      command: `hdfs dfs -ls ${VENTAS_DIR}`, input: 'La carpeta', cap: 'hdfs.read',
      does: 'Le pregunta al NameNode qué hay: nombre, tamaño y réplica de cada archivo.', expect: `Aparece ${NAME} con su réplica`,
      pregunta: {
        enunciado: `Ahora queremos ver qué hay en ${VENTAS_DIR}, con el tamaño y la réplica de cada archivo. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs dfs -ls ${VENTAS_DIR}`, correcta: true, porque: '-ls le pregunta al NameNode qué hay en esa carpeta de HDFS. La segunda columna es la réplica y la quinta el tamaño en bytes.' },
          { cmd: `ls -l ${VENTAS_DIR}`, porque: 'Es el ls de Linux: mira el disco del contenedor, donde esa carpeta no existe. Lo que está en HDFS no se ve con los comandos de siempre.' },
          { cmd: `hdfs dfs -cat ${VENTAS_DIR}`, porque: '-cat muestra el contenido de un archivo; a una carpeta contesta que es un directorio (Is a directory).' },
          { cmd: `hdfs dfs -du -h ${VENTAS_DIR}`, porque: '-du dice cuánto ocupa cada cosa, pero no muestra la réplica, el dueño ni los permisos: sirve para tamaños, no para listar.' },
        ],
      },
      donde: { hdfs: 'Nada cambia: -ls solo lee los metadatos del NameNode', compu: 'Lo mismo en HDFS → Archivos' },
      run: async c => {
        const l = await c.api.hdfsList(VENTAS_DIR);
        return { summary: `${plural(l.entries.length, 'entrada')} en ${VENTAS_DIR}`, out: lsOut(l), raw: lsRaw(c, l), link: { label: 'Ver en HDFS', page: 'hdfs', arg: VENTAS_DIR } };
      },
      verify: c => fileCheck(c, VENTAS_DIR, NAME),
    },
    {
      id: 'cat', title: 'Leer las primeras líneas',
      command: `hdfs dfs -cat ${VENTAS_FILE} | head`, input: 'El archivo', cap: 'hdfs.read',
      does: 'El cliente pide al NameNode dónde está el primer bloque y lo lee directo del DataNode.',
      expect: 'El encabezado fecha,sucursal,producto,cantidad,precio y las primeras ventas',
      pregunta: {
        enunciado: 'Ahora queremos ver las primeras líneas del archivo que está en HDFS, sin bajarlo entero. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: `hdfs dfs -cat ${VENTAS_FILE} | head`, correcta: true, porque: '-cat lee el archivo de HDFS y lo larga por pantalla; | head corta en las primeras 10 líneas (y -cat deja de leer).' },
          { cmd: `cat ${VENTAS_FILE} | head`, porque: 'El cat de Linux busca el archivo en el disco del contenedor, y ese archivo está en HDFS: No such file or directory.' },
          { cmd: `hdfs dfs -get ${VENTAS_FILE} | head`, porque: '-get copia el archivo entero a una carpeta del contenedor y no imprime el contenido: head no recibe nada.' },
          { cmd: `hdfs dfs -cat ${VENTAS_DIR} | head`, porque: 'Apunta a la carpeta, no al archivo: -cat no lee carpetas (Is a directory).' },
        ],
      },
      donde: { contenedor: 'Nada: -cat no deja ningún archivo, solo imprime', hdfs: 'Nada cambia: solo se leyó el primer bloque' },
      run: async c => {
        const h = await head(c, VENTAS_FILE);
        const first = h.text.split('\n').slice(0, 10).join('\n');
        return {
          summary: 'Primeras líneas del archivo', out: { kind: 'text', text: h.text.split('\n').slice(0, 12).join('\n') },
          raw: armada(textLines(first), c.api.mode === 'demo' ? 'Modo demo: salida simulada con el mismo formato que la terminal' : 'Leído por WebHDFS (OPEN) desde los DataNodes: es lo mismo que imprime -cat'),
        };
      },
      verify: async c => {
        const h = await head(c, VENTAS_FILE);
        return /fecha/.test(h.text) ? { ok: true, detail: 'Se lee el encabezado y las primeras filas' } : { ok: false, detail: 'No se pudo leer el principio del archivo' };
      },
    },
    {
      id: 'setrep', title: 'Pedir 3 copias de cada bloque',
      command: `hdfs dfs -setrep {w}3 ${VENTAS_FILE}`, input: 'El archivo y la réplica nueva',
      plan: s => ({ w: waitFlag(dnAlive(s), 3) }),
      does: 'El NameNode anota la réplica nueva y ordena copiar los bloques. Con -w el comando espera a que estén todas las copias.',
      expect: 'El archivo queda con réplica 3. Con menos de 3 DataNodes queda sub-replicado: no hay dónde poner la tercera copia',
      pregunta: {
        enunciado: 'Ahora queremos que el archivo que ya está en HDFS pase a tener 3 copias de cada bloque. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: `hdfs dfs -setrep {w}3 ${VENTAS_FILE}`, correcta: true, porque: '-setrep cambia la réplica de un archivo que ya está en HDFS. Con -w espera a que estén todas las copias; si hay menos de 3 DataNodes vivos va sin -w, porque no terminaría nunca.' },
          { cmd: `hdfs dfs -setrep {w}${VENTAS_FILE} 3`, porque: 'Los argumentos van al revés: primero el número y después la ruta. Así toma la ruta como réplica y falla porque no es un número.' },
          { cmd: `hdfs dfs -D dfs.replication=3 -put -f ${LOCAL} ${VENTAS_DIR}/`, porque: '-D dfs.replication=3 vale para lo que se escribe con ese comando: vuelve a subir el archivo entero en vez de cambiar la réplica del que ya está.' },
          { cmd: `hdfs dfsadmin -setrep 3 ${VENTAS_FILE}`, porque: 'dfsadmin es para administrar el cluster (reportes, modo seguro) y no tiene -setrep: la réplica de un archivo se cambia con hdfs dfs.' },
        ],
      },
      donde: {
        hdfs: 'Cada bloque con 3 copias en 3 DataNodes distintos (con menos DataNodes vivos, una copia en cada uno)',
        contenedor: 'Las copias nuevas son archivos blk_… adentro de /hadoop/dfs/dnN de cada DataNode',
        compu: 'HDFS → Archivos → el archivo: en Bloques ves en qué DataNode está cada copia',
      },
      run: async c => {
        const r = await setrep(c, 3);
        const done = r.live >= 3;
        return {
          summary: done ? (r.ok ? 'Réplica 3: cada bloque ya tiene sus 3 copias' : 'Réplica 3: el NameNode todavía está copiando') : `Réplica 3 con ${plural(r.live, 'DataNode vivo', 'DataNodes vivos')}: cada bloque queda con ${plural(r.live, 'copia')}, sub-replicado`,
          raw: r.raw, link: { label: 'Ver los bloques', page: 'hdfs', arg: VENTAS_FILE },
        };
      },
      verify: async c => {
        const e = await entry(c, VENTAS_DIR, NAME);
        if (e?.replication !== 3) return { ok: false, detail: `La réplica es ${e?.replication ?? '?'}` };
        if (e.state !== 'under') return { ok: true, detail: 'Réplica 3' };
        const live = dnUp(await c.status());
        return { ok: true, detail: live >= 3 ? 'Réplica 3 (el NameNode todavía está copiando lo que falta)' : `Réplica 3 (sub-replicado: hay ${plural(live, 'DataNode vivo', 'DataNodes vivos')})` };
      },
      tip: 'Sin -w, setrep vuelve enseguida y el NameNode copia por detrás: un fsck justo después marcaría Under replicated aunque haya 3 DataNodes. Con menos DataNodes que la réplica, fsck lo marca igual: no es un error, es que no hay dónde.',
    },
    {
      id: 'fsck', title: 'Revisar la salud con fsck',
      command: `hdfs fsck ${VENTAS_DIR} -files -blocks -locations`, input: 'La carpeta', cap: 'hdfs.read',
      does: 'Recorre los bloques de cada archivo y cuenta cuántas copias vivas tiene.', expect: 'Ningún bloque perdido (missing 0)',
      pregunta: {
        enunciado: `Ahora queremos revisar, bloque por bloque, cuántas copias tiene cada uno y en qué DataNode está cada copia. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs fsck ${VENTAS_DIR} -files -blocks -locations`, correcta: true, porque: 'fsck le pregunta al NameNode por cada archivo (-files), cada bloque (-blocks) y dónde está cada copia (-locations). No lee los datos.' },
          { cmd: `hdfs dfs -fsck ${VENTAS_DIR}`, porque: 'fsck no es un comando de hdfs dfs: va directo, como hdfs fsck. Así contesta "-fsck: Unknown command".' },
          { cmd: `fsck ${VENTAS_DIR}`, porque: 'Es el fsck de Linux, que revisa los discos del sistema operativo: no sabe nada de HDFS.' },
          { cmd: 'hdfs dfsadmin -report', porque: '-report da el resumen de cada DataNode (espacio, cantidad de bloques), no el detalle de los bloques de esta carpeta.' },
        ],
      },
      donde: { hdfs: 'Nada cambia: fsck solo lee los metadatos del NameNode', compu: 'HDFS → Salud muestra lo mismo para todo el cluster' },
      run: async c => {
        let f = await c.api.fsck(VENTAS_DIR);
        // Con DataNodes de sobra, un sub-replicado es que el NameNode todavía copia (pasa si el setrep fue
        // sin -w): se espera un poco, con un fsck cada 5 s y no uno por segundo
        if (f.underReplicated && !f.missing && f.liveDataNodes >= 3)
          f = (await waitFor(c, () => c.api.fsck(VENTAS_DIR), x => x.underReplicated === 0, { seconds: 45, every: 5000, what: 'El NameNode todavía está copiando bloques: esperando que fsck dé sano…' })).value;
        return {
          summary: f.healthy && !f.underReplicated ? 'HEALTHY: ningún bloque perdido ni con copias de menos' : f.healthy ? `HEALTHY, con ${plural(f.underReplicated, 'bloque')} sub-replicado${f.underReplicated === 1 ? '' : 's'}` : `${plural(f.underReplicated, 'sub-replicado')}, ${plural(f.missing, 'perdido')}`,
          out: { kind: 'kv', items: [['Archivos', String(f.files)], ['Bloques', String(f.blocks)], ['Sub-replicados', String(f.underReplicated)], ['Perdidos', String(f.missing)], ['Réplica promedio', f.avgReplication.toLocaleString('es-AR')], ['DataNodes vivos', String(f.liveDataNodes)]] },
          raw: fsckRaw(c, f.raw), trace: f.trace,
        };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        return f.missing === 0 && f.corrupt === 0 ? { ok: true, detail: `${f.blocks} bloque(s), ninguno perdido` } : { ok: false, detail: `${f.missing} bloque(s) perdido(s)` };
      },
      tip: 'Si fsck marca sub-replicados: con menos DataNodes vivos que la réplica pedida es lo esperable (no hay dónde poner la copia; HDFS sigue sano porque cada bloque tiene al menos una). Con DataNodes de sobra, es que el NameNode todavía está copiando: por eso el setrep va con -w, que espera a que terminen.',
    },
    {
      id: 'get', title: 'Bajarlo a tu compu (por el navegador)',
      command: `curl -L "${OPEN_URL}" -o ${NAME}`, input: 'El archivo en HDFS', cap: 'hdfs.read',
      does: 'Ejecutar lo baja con el navegador por WebHDFS (como el curl): el NameNode dice en qué DataNodes está cada bloque, se leen en orden y el archivo cae en tus descargas, sin pasar por el disco del contenedor. hdfs dfs -get es otra cosa: copia de HDFS al disco del contenedor, no a tu compu.',
      expect: `${NAME} en la carpeta de descargas de tu compu`,
      pregunta: {
        enunciado: `Ahora queremos tener ${NAME} en tu compu, no en el contenedor. El botón lo baja por WebHDFS, la API web de HDFS. ¿Cuál es el comando que hace lo mismo?`,
        opciones: [
          { cmd: `curl -L "${OPEN_URL}" -o ${NAME}`, correcta: true, porque: 'WebHDFS sirve los archivos por HTTP: op=OPEN pide el contenido, -L sigue la redirección al DataNode que tiene los bloques y -o lo guarda con ese nombre. Es lo que hace el navegador.' },
          { cmd: `hdfs dfs -get ${VENTAS_FILE} .`, porque: '-get lo copia de HDFS al disco del contenedor (a la carpeta donde estás parado, por ejemplo /root), no a tu compu: no aparece en tus descargas. Solo si lo bajás a /datos lo ves en la carpeta datos/ de tu compu.' },
          { cmd: `hdfs dfs -put ${VENTAS_FILE} .`, porque: '-put sube del contenedor a HDFS: es el camino contrario.' },
          { cmd: `curl "http://localhost:9870/webhdfs/v1${VENTAS_FILE}?op=GETFILESTATUS&user.name=root"`, porque: 'op=GETFILESTATUS devuelve los datos del archivo (tamaño, réplica, dueño) en JSON, no su contenido.' },
        ],
      },
      donde: {
        compu: `${NAME} en tu carpeta de descargas (el navegador puede preguntarte dónde guardarlo)`,
        contenedor: 'Nada: no queda ninguna copia en el contenedor (eso sería hdfs dfs -get)',
        hdfs: 'Sigue igual: bajar no borra nada',
      },
      run: async c => {
        // bajar y leer llegan juntos al servidor: si no lee, tampoco baja (y el paso va a la terminal)
        await c.api.hdfsCat(VENTAS_FILE, 0, 1);
        const d = await c.api.hdfsDownload(VENTAS_FILE);
        if (typeof document !== 'undefined') {
          const a = document.createElement('a'); a.href = d.url; a.download = d.name; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
        }
        const e = await entry(c, VENTAS_DIR, NAME);
        return {
          summary: `Bajando ${d.name}${e ? ` (${mbLabel(e.sizeMb ?? 0)})` : ''} con el navegador: fijate en tus descargas`,
          raw: armada([], 'La descarga la hace el navegador: no hay salida en la terminal del contenedor'),
        };
      },
      tip: 'Con hdfs dfs -get el archivo queda adentro del contenedor, en la carpeta donde estás parado (por ejemplo /root), y desde tu compu no lo ves. Si querés ese camino, bajalo a /datos: hdfs dfs -get ' + VENTAS_FILE + ' /datos/ lo deja en la carpeta datos/ de tu compu, que es la misma que /datos adentro.',
    },
  ],
};

const procState = async (c: StepCtx, id: string) => (await c.status()).processes.find(p => p.id === id)?.state;

/** El DataNode a apagar: el último prendido. Lo que se muestra en "datanode stop" es el que se apaga */
const lastUp = (s: Parameters<NonNullable<Practice['needs']>>[0]) => [...s.processes].reverse().find(p => p.kind === 'datanode' && p.state === 'up');

const dnNumOf = (c: StepCtx) => Number(c.vars.dnNum ?? (c.vars.dn ?? '').replace(/\D/g, ''));

const dnVars = (p: { id: string; name: string } | undefined): Record<string, string> => (p ? { dn: p.id, dnNum: p.id.replace(/\D/g, ''), dnName: p.name } : {});

/** Para los pasos de después de apagarlo: el DataNode que está apagado. Lo que guardó el paso de apagar
    gana; esto es por si se perdió (otro navegador, lo apagó en la terminal sin abrir ese paso) */
const planDown = (s: Parameters<NonNullable<Practice['needs']>>[0]) => dnVars(
  [...s.processes].reverse().find(p => p.kind === 'datanode' && (p.state === 'down' || p.state === 'stopping'))
  ?? [...s.processes].reverse().find(p => p.kind === 'datanode' && p.state === 'off'));

export const hdfsFalla: Practice = {
  id: 'hdfs-falla', guide: '03', guideFile: '03-hdfs.md',
  title: 'HDFS: se cae un DataNode',
  summary: 'Apagás un DataNode, ves cómo el NameNode lo da por muerto y los bloques quedan sub-replicados, y lo volvés a prender.',
  minutes: 10, cap: 'hdfs.write', needs: needDataNodes(2), after: ['hdfs-basico'],
  before: 'Hace falta tener 2 DataNodes o más',
  learn: ['El NameNode se entera de una caída porque dejan de llegar latidos', 'Sin el DataNode, los bloques que tenía quedan con menos copias', 'Cuando vuelve, avisa qué bloques tiene y fsck queda sano'],
  steps: [
    {
      id: 'prep', title: 'Dejar el archivo con 2 copias',
      command: `hdfs dfs -setrep {w}2 ${VENTAS_FILE}`, input: `${NAME} (lo sube si no está)`,
      plan: s => ({ w: waitFlag(dnAlive(s), 2) }),
      does: 'Cada bloque queda en dos DataNodes distintos. Con -w el comando espera a que estén las 2 copias.', expect: 'Réplica 2 y fsck sano',
      pregunta: {
        enunciado: 'Ahora queremos que cada bloque del archivo quede en 2 DataNodes distintos antes de apagar uno. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: `hdfs dfs -setrep {w}2 ${VENTAS_FILE}`, correcta: true, porque: '-setrep cambia la réplica de un archivo que ya está; -w espera a que estén las 2 copias (si no hay 2 DataNodes vivos va sin -w: no terminaría nunca).' },
          { cmd: `hdfs dfs -chmod 2 ${VENTAS_FILE}`, porque: '-chmod cambia los permisos (quién puede leer o escribir), no la cantidad de copias.' },
          { cmd: `hdfs dfs -set-replication 2 ${VENTAS_FILE}`, porque: 'Ese comando no existe: se llama -setrep. HDFS contesta "-set-replication: Unknown command".' },
          { cmd: `hdfs dfs -D dfs.replication=2 -ls ${VENTAS_DIR}`, porque: '-D dfs.replication solo cambia la réplica de lo que se escribe con ese comando; un -ls no escribe nada, así que no cambia nada.' },
        ],
      },
      donde: { hdfs: 'Cada bloque en 2 DataNodes: si se cae uno, queda la otra copia', compu: 'HDFS → Archivos → el archivo → Bloques' },
      run: async c => {
        const r = await ensureExample(c, VENTAS_DIR, NAME, 'ventas');
        const s = await setrep(c, 2);
        return { ...r, raw: s.raw, summary: `${r.summary}. Réplica 2${s.ok && s.live >= 2 ? ': cada bloque en 2 DataNodes' : s.live < 2 ? `, pero con ${plural(s.live, 'DataNode vivo', 'DataNodes vivos')}` : ': todavía copiando'}` };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        const e = await entry(c, VENTAS_DIR, NAME);
        return e?.replication === 2 && f.underReplicated === 0 && f.missing === 0 ? { ok: true, detail: 'Réplica 2, ningún bloque con menos copias' } : { ok: false, detail: `Réplica ${e?.replication ?? '?'}, ${f.underReplicated} bloque(s) sub-replicado(s)` };
      },
    },
    {
      id: 'stop', title: 'Apagar un DataNode',
      command: 'datanode stop {dnNum}', input: 'El número de DataNode (el último prendido)',
      // fija: el número se decide cuando aparece el paso. Si se recalculara después de apagar el 3 en la
      // terminal, "el último prendido" sería el 2 y los pasos siguientes dirían "datanode start 2"
      plan: s => dnVars(lastUp(s)), fija: true,
      does: 'Mata el proceso del DataNode: deja de mandar latidos al NameNode.', expect: 'El DataNode queda apagado',
      pregunta: {
        enunciado: 'Ahora queremos apagar el DataNode {dnNum} para simular que se cae. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'datanode stop {dnNum}', correcta: true, porque: 'datanode es el script del sandbox que prende y apaga DataNodes por número: stop {dnNum} mata ese proceso, que deja de mandar latidos.' },
          { cmd: 'datanode start {dnNum}', porque: 'start lo prende; acá queremos apagarlo.' },
          { cmd: 'hdfs dfs -rm -r /hadoop/dfs/dn{dnNum}', porque: 'Eso borra una ruta de HDFS, y la carpeta del DataNode está en el disco del contenedor. Además borrar datos no es apagar: sería perder las copias.' },
          { cmd: 'hdfs dfsadmin -report', porque: '-report solo muestra cómo están los DataNodes; no apaga ninguno.' },
        ],
      },
      donde: {
        contenedor: 'El proceso del DataNode {dnNum} ya no corre. Sus bloques siguen en el disco, en /hadoop/dfs/dn{dnNum}',
        hdfs: 'Los bloques que tenía quedan con una copia menos, pero el NameNode todavía no lo sabe',
        compu: 'Cluster: el DataNode {dnNum} aparece apagado',
      },
      run: async c => {
        const id = c.vars.dn;
        if (!id) throw new Error('No hay ningún DataNode prendido');
        const r = await c.api.processAction(id, 'stop');
        await waitFor(c, () => procState(c, id), st => st === 'down' || st === 'off', { seconds: 30, every: 1500, max: 5000, what: `Apagando el DataNode ${c.vars.dnNum}…` });
        return { summary: `DataNode ${c.vars.dnNum} apagado`, raw: await actionRaw(c, r && typeof r === 'object' ? r.id : undefined), link: { label: 'Ver el cluster', page: 'cluster' } };
      },
      verify: async c => {
        const st = c.vars.dn ? await procState(c, c.vars.dn) : undefined;
        return st === 'down' || st === 'off' ? { ok: true, detail: `El DataNode ${c.vars.dnNum ?? c.vars.dn} está apagado` } : { ok: false, detail: c.vars.dn ? `${c.vars.dn} está ${st}` : 'Todavía no se apagó ninguno' };
      },
    },
    {
      id: 'dead', title: 'Esperar a que el NameNode lo dé por muerto',
      command: 'hdfs dfsadmin -report', input: 'Nada: el NameNode cuenta los latidos que no llegan',
      plan: planDown,
      does: 'Primero lo marca stale (sin latidos) y, pasado el plazo, dead.', expect: 'El DataNode figura como dead',
      pregunta: {
        enunciado: 'Ahora queremos ver qué DataNodes da el NameNode por vivos y cuáles por muertos. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'hdfs dfsadmin -report', correcta: true, porque: 'dfsadmin -report le pide al NameNode el estado de cada DataNode: Live datanodes y Dead datanodes, con sus bloques y su último latido.' },
          { cmd: 'jps', porque: 'jps lista los procesos Java de este contenedor: ves que el DataNode no está, pero no lo que piensa el NameNode (que tarda en darlo por muerto).' },
          { cmd: 'hdfs dfs -ls /', porque: '-ls lista archivos; no dice nada de los DataNodes.' },
          { cmd: 'hdfs dfsadmin -safemode get', porque: 'Dice si el NameNode está en modo seguro, no cómo está cada DataNode.' },
        ],
      },
      donde: { hdfs: 'El NameNode lo pasa de stale a dead: a partir de ahí no le asigna bloques', compu: 'HDFS → DataNodes: el {dnNum} pasa a dead' },
      run: async c => {
        const n = dnNumOf(c);
        const w = await waitFor(c, () => c.api.dataNodes(), l => l.find(d => d.id === n)?.state === 'dead', { seconds: 120, what: 'Esperando a que el NameNode lo dé por muerto…' });
        return {
          summary: w.ok ? `DataNode ${n}: dead` : `DataNode ${n} sigue ${w.value.find(d => d.id === n)?.state}: probá Verificar en unos segundos`,
          out: { kind: 'table', columns: ['DataNode', 'estado', 'bloques'], rows: w.value.map(d => [d.id, d.state, d.blocks]) },
          raw: armada(reportLines(w.value), c.api.mode === 'demo' ? 'Modo demo: salida simulada con el mismo formato que la terminal' : 'Armada con lo que dice el NameNode (JMX), con el formato de dfsadmin -report, resumida'),
        };
      },
      verify: async c => {
        const n = dnNumOf(c);
        const d = (await c.api.dataNodes()).find(x => x.id === n);
        return d?.state === 'dead' ? { ok: true, detail: `DataNode ${n} figura dead` } : { ok: false, detail: `DataNode ${n}: ${d?.state ?? 'no aparece'}` };
      },
    },
    {
      id: 'under', title: 'Ver los bloques sub-replicados',
      command: `hdfs fsck ${VENTAS_DIR}`, input: 'La carpeta', cap: 'hdfs.read',
      plan: planDown,
      does: 'Cuenta las copias vivas: los bloques que estaban en el DataNode caído tienen una menos.',
      expect: 'Bloques Under replicated (con 2 DataNodes no hay dónde reponer la copia)',
      pregunta: {
        enunciado: `Ahora queremos contar cuántos bloques de ${VENTAS_DIR} quedaron con menos copias de las pedidas. ¿Cuál es el comando correcto?`,
        opciones: [
          { cmd: `hdfs fsck ${VENTAS_DIR}`, correcta: true, porque: 'fsck recorre los bloques y al final dice Under-replicated blocks: los que tienen menos copias vivas que la réplica pedida.' },
          { cmd: `hdfs dfs -count ${VENTAS_DIR}`, porque: '-count cuenta carpetas, archivos y bytes; no mira las copias de cada bloque.' },
          { cmd: `hdfs dfs -ls ${VENTAS_DIR}`, porque: '-ls muestra la réplica pedida (la que anotó el NameNode), no cuántas copias vivas hay: sigue diciendo 2.' },
          { cmd: `hdfs dfs -setrep 2 ${VENTAS_FILE}`, porque: '-setrep cambia la réplica pedida; no te dice cuántas faltan.' },
        ],
      },
      donde: { hdfs: 'Los bloques que tenía el DataNode {dnNum} con una copia viva menos', compu: 'HDFS → Salud: sub-replicados y la cola de copias' },
      run: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        const r = await c.api.replication();
        const noRoom = r.noRoom ?? 0;
        return {
          summary: `${plural(f.underReplicated, 'bloque')} sub-replicado${f.underReplicated === 1 ? '' : 's'}, ${plural(f.missing, 'perdido')}${r.tasks.length ? `; el NameNode está reponiendo ${r.tasks.length} copia(s)` : noRoom ? ': no hay otro DataNode vivo donde reponer la copia' : ''}`,
          out: { kind: 'kv', items: [['Sub-replicados', String(f.underReplicated)], ['Perdidos', String(f.missing)], ['DataNodes vivos', String(f.liveDataNodes)], ['Copias en la cola', String(r.tasks.length)], ...(noRoom ? [['Sin dónde copiarse', String(noRoom)] as [string, string]] : [])] },
          raw: fsckRaw(c, f.raw), trace: f.trace,
          link: { label: 'Ver la re-replicación', page: 'hdfs' },
        };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        if (f.underReplicated > 0) return { ok: true, detail: `${f.underReplicated} bloque(s) con menos copias de las pedidas` };
        const r = await c.api.replication();
        return r.recent.length ? { ok: true, detail: 'El NameNode ya repuso las copias en otro DataNode' } : { ok: false, detail: 'fsck no muestra bloques sub-replicados todavía' };
      },
      tip: 'Con 3 DataNodes o más, el NameNode copia los bloques a otro y fsck vuelve a quedar sano solo.',
    },
    {
      id: 'start', title: 'Volver a prender el DataNode',
      command: 'datanode start {dnNum}', input: 'El mismo DataNode que apagaste',
      plan: planDown,
      does: 'Arranca, le avisa al NameNode qué bloques tiene (block report) y las copias vuelven a contar.', expect: 'fsck sano: ningún bloque sub-replicado',
      pregunta: {
        enunciado: 'Ahora queremos volver a prender el DataNode {dnNum} para que sus copias vuelvan a contar. ¿Cuál es el comando correcto?',
        opciones: [
          { cmd: 'datanode start {dnNum}', correcta: true, porque: 'start {dnNum} arranca el mismo DataNode con su carpeta de datos: le avisa al NameNode qué bloques tiene y esas copias vuelven a contar.' },
          { cmd: 'datanode stop {dnNum}', porque: 'Ya está apagado: stop no cambia nada.' },
          { cmd: `hdfs dfs -setrep 2 ${VENTAS_FILE}`, porque: 'La réplica pedida ya es 2: lo que falta es el DataNode donde estaban las copias. Cambiar la réplica no prende nada.' },
          { cmd: 'hdfs namenode -format', porque: 'Cuidado: formatea el NameNode, borra todos los metadatos y perdés todo lo que hay en HDFS.' },
        ],
      },
      donde: {
        contenedor: 'El proceso del DataNode {dnNum} corre de nuevo, con la misma carpeta /hadoop/dfs/dn{dnNum}',
        hdfs: 'Sus bloques vuelven a contar: cada bloque otra vez con sus 2 copias',
        compu: 'Cluster y HDFS → DataNodes: el {dnNum} vuelve a live',
      },
      run: async c => {
        const id = c.vars.dn;
        if (!id) throw new Error('No hay un DataNode apagado por esta práctica: hacé el paso de apagarlo primero');
        const r = await c.api.processAction(id, 'start');
        // Se espera mirando el listado (no un fsck por vuelta, que llena la Consola y carga al NameNode); al final, un solo fsck
        await waitFor(c, () => entry(c, VENTAS_DIR, NAME), e => !!e && e.state !== 'under' && e.state !== 'missing',
          { seconds: 120, what: 'Esperando a que el DataNode vuelva y avise sus bloques…' });
        // El listado puede dar sano un poco antes que fsck (que cuenta toda la carpeta): si fsck todavía
        // no da, se vuelve a pedir pocas veces y espaciado, no uno por segundo
        const { value: f, ok } = await waitFor(c, () => c.api.fsck(VENTAS_DIR), x => x.underReplicated === 0 && x.missing === 0,
          { seconds: 60, every: 5000, what: 'El DataNode volvió: esperando que fsck dé sano…' });
        return {
          summary: ok ? `DataNode ${c.vars.dnNum} prendido: de nuevo sano, cada bloque con sus copias` : `DataNode ${c.vars.dnNum} prendido, pero todavía hay ${plural(f.underReplicated, 'bloque')} sub-replicado(s): probá Verificar en un rato`,
          raw: await actionRaw(c, r && typeof r === 'object' ? r.id : undefined),
          out: { kind: 'kv', items: [['Sub-replicados', String(f.underReplicated)], ['Perdidos', String(f.missing)], ['DataNodes vivos', String(f.liveDataNodes)]] },
        };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        return f.underReplicated === 0 && f.missing === 0 ? { ok: true, detail: 'fsck sano' } : { ok: false, detail: `${f.underReplicated} sub-replicado(s)` };
      },
    },
  ],
};
