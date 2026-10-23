/* Guía 03: HDFS. Lo básico (carpetas, put, ls, cat, réplica, fsck, get) y qué pasa cuando se cae un DataNode. */
import { notThere, waitFor } from './motor';
import { VENTAS_DIR, VENTAS_FILE, dnUp, mbLabel, ensureExample, entry, fileCheck, lsOut, needDataNodes } from './comun';
import type { Practice, StepCtx } from './tipos';
import { plural } from '../format';

const NAME = 'ventas_grandes.csv';

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
      run: async c => {
        const r = await c.api.hdfsMkdir(VENTAS_DIR);
        return { summary: r.trace.output || `Carpeta ${VENTAS_DIR}`, trace: r.trace, link: { label: 'Ver en HDFS', page: 'hdfs', arg: VENTAS_DIR } };
      },
      verify: async c => {
        const e = await entry(c, '/user/root', 'ventas');
        return e?.type === 'dir' ? { ok: true, detail: `${VENTAS_DIR} existe` } : { ok: false, detail: `No está ${VENTAS_DIR}` };
      },
    },
    {
      id: 'put', title: 'Subir ventas_grandes.csv',
      command: `hdfs dfs -put ventas_grandes.csv ${VENTAS_DIR}/`, input: `${NAME}: 200.000 filas, unos 6 MB`,
      does: 'Lo corta en bloques y manda cada bloque a un DataNode, que lo pasa al siguiente hasta tener todas las copias.',
      expect: 'El archivo queda completo (no más ._COPYING_)',
      run: c => ensureExample(c, VENTAS_DIR, NAME, 'ventas'),
      verify: c => fileCheck(c, VENTAS_DIR, NAME),
      tip: 'Mientras se escribe, HDFS lo muestra con ._COPYING_ al final: nadie lo ve a medias.',
    },
    {
      id: 'ls', title: 'Listar la carpeta',
      command: `hdfs dfs -ls ${VENTAS_DIR}`, input: 'La carpeta', cap: 'hdfs.read',
      does: 'Le pregunta al NameNode qué hay: nombre, tamaño y réplica de cada archivo.', expect: `Aparece ${NAME} con su réplica`,
      run: async c => {
        const l = await c.api.hdfsList(VENTAS_DIR);
        return { summary: `${plural(l.entries.length, 'entrada')} en ${VENTAS_DIR}`, out: lsOut(l), link: { label: 'Ver en HDFS', page: 'hdfs', arg: VENTAS_DIR } };
      },
      verify: c => fileCheck(c, VENTAS_DIR, NAME),
    },
    {
      id: 'cat', title: 'Leer las primeras líneas',
      command: `hdfs dfs -cat ${VENTAS_FILE} | head`, input: 'El archivo', cap: 'hdfs.read',
      does: 'El cliente pide al NameNode dónde está el primer bloque y lo lee directo del DataNode.',
      expect: 'El encabezado fecha,sucursal,producto,cantidad,precio y las primeras ventas',
      run: async c => {
        const h = await head(c, VENTAS_FILE);
        return { summary: 'Primeras líneas del archivo', out: { kind: 'text', text: h.text.split('\n').slice(0, 12).join('\n') } };
      },
      verify: async c => {
        const h = await head(c, VENTAS_FILE);
        return /fecha/.test(h.text) ? { ok: true, detail: 'Se lee el encabezado y las primeras filas' } : { ok: false, detail: 'No se pudo leer el principio del archivo' };
      },
    },
    {
      id: 'setrep', title: 'Pedir 3 copias de cada bloque',
      command: `hdfs dfs -setrep 3 ${VENTAS_FILE}`, input: 'El archivo y la réplica nueva',
      does: 'El NameNode anota la réplica nueva y ordena copiar los bloques que tienen menos copias.',
      expect: 'El archivo queda con réplica 3. Con menos de 3 DataNodes queda sub-replicado: no hay dónde poner la tercera copia',
      run: async c => {
        await c.api.setReplication(VENTAS_FILE, 3);
        // el listado del NameNode tarda unos segundos en mostrar la réplica nueva
        await waitFor(c, () => entry(c, VENTAS_DIR, NAME), e => e?.replication === 3, { seconds: 30, every: 1500, what: 'Esperando a que el NameNode anote la réplica 3…' });
        const s = await c.status();
        const live = dnUp(s);
        return { summary: live >= 3 ? 'Réplica 3: el NameNode copia lo que falta' : `Réplica 3 con ${plural(live, 'DataNode vivo', 'DataNodes vivos')}: cada bloque queda con ${plural(live, 'copia')}, sub-replicado`, link: { label: 'Ver los bloques', page: 'hdfs', arg: VENTAS_FILE } };
      },
      verify: async c => {
        const e = await entry(c, VENTAS_DIR, NAME);
        if (e?.replication !== 3) return { ok: false, detail: `La réplica es ${e?.replication ?? '?'}` };
        if (e.state !== 'under') return { ok: true, detail: 'Réplica 3' };
        const live = dnUp(await c.status());
        return { ok: true, detail: live >= 3 ? 'Réplica 3 (el NameNode todavía está copiando lo que falta)' : `Réplica 3 (sub-replicado: hay ${plural(live, 'DataNode vivo', 'DataNodes vivos')})` };
      },
      tip: 'Con menos DataNodes que la réplica, fsck lo marca Under replicated: no es un error, es que no hay dónde.',
    },
    {
      id: 'fsck', title: 'Revisar la salud con fsck',
      command: `hdfs fsck ${VENTAS_DIR} -files -blocks -locations`, input: 'La carpeta', cap: 'hdfs.read',
      does: 'Recorre los bloques de cada archivo y cuenta cuántas copias vivas tiene.', expect: 'Ningún bloque perdido (missing 0)',
      run: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        return {
          summary: f.healthy ? 'HEALTHY: ningún bloque perdido' : `${plural(f.underReplicated, 'sub-replicado')}, ${plural(f.missing, 'perdido')}`,
          out: { kind: 'kv', items: [['Archivos', String(f.files)], ['Bloques', String(f.blocks)], ['Sub-replicados', String(f.underReplicated)], ['Perdidos', String(f.missing)], ['Réplica promedio', f.avgReplication.toLocaleString('es-AR')], ['DataNodes vivos', String(f.liveDataNodes)]] },
        };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        return f.missing === 0 && f.corrupt === 0 ? { ok: true, detail: `${f.blocks} bloque(s), ninguno perdido` } : { ok: false, detail: `${f.missing} bloque(s) perdido(s)` };
      },
    },
    {
      id: 'get', title: 'Bajarlo a tu compu',
      command: `hdfs dfs -get ${VENTAS_FILE} .`, input: 'El archivo en HDFS', cap: 'hdfs.read',
      does: 'Junta los bloques en orden y arma el archivo de nuevo, fuera de HDFS.', expect: 'Se baja ventas_grandes.csv',
      run: async c => {
        // bajar y leer llegan juntos al servidor: si no lee, tampoco baja (y el paso va a la terminal)
        await c.api.hdfsCat(VENTAS_FILE, 0, 1);
        const d = await c.api.hdfsDownload(VENTAS_FILE);
        if (typeof document !== 'undefined') {
          const a = document.createElement('a'); a.href = d.url; a.download = d.name; a.rel = 'noopener';
          document.body.appendChild(a); a.click(); a.remove();
        }
        const e = await entry(c, VENTAS_DIR, NAME);
        return { summary: `Bajando ${d.name}${e ? ` (${mbLabel(e.sizeMb ?? 0)})` : ''}` };
      },
    },
  ],
};

const procState = async (c: StepCtx, id: string) => (await c.status()).processes.find(p => p.id === id)?.state;

export const hdfsFalla: Practice = {
  id: 'hdfs-falla', guide: '03', guideFile: '03-hdfs.md',
  title: 'HDFS: se cae un DataNode',
  summary: 'Apagás un DataNode, ves cómo el NameNode lo da por muerto y los bloques quedan sub-replicados, y lo volvés a prender.',
  minutes: 10, cap: 'hdfs.write', needs: needDataNodes(2),
  before: 'Hace falta tener 2 DataNodes o más',
  learn: ['El NameNode se entera de una caída porque dejan de llegar latidos', 'Sin el DataNode, los bloques que tenía quedan con menos copias', 'Cuando vuelve, avisa qué bloques tiene y fsck queda sano'],
  steps: [
    {
      id: 'prep', title: 'Dejar el archivo con 2 copias',
      command: `hdfs dfs -setrep -w 2 ${VENTAS_FILE}`, input: `${NAME} (lo sube si no está)`,
      does: 'Cada bloque queda en dos DataNodes distintos.', expect: 'Réplica 2 y fsck sano',
      run: async c => {
        const r = await ensureExample(c, VENTAS_DIR, NAME, 'ventas');
        await c.api.setReplication(VENTAS_FILE, 2);
        const w = await waitFor(c, () => c.api.fsck(VENTAS_DIR), f => f.underReplicated === 0 && f.missing === 0, { seconds: 90, every: 2000, what: 'Esperando a que cada bloque tenga sus 2 copias…' });
        return { ...r, summary: `${r.summary}. Réplica 2${w.ok ? ': cada bloque en 2 DataNodes' : ': todavía copiando'}` };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        const e = await entry(c, VENTAS_DIR, NAME);
        return e?.replication === 2 && f.underReplicated === 0 && f.missing === 0 ? { ok: true, detail: 'Réplica 2, ningún bloque con menos copias' } : { ok: false, detail: `Réplica ${e?.replication ?? '?'}, ${f.underReplicated} bloque(s) sub-replicado(s)` };
      },
    },
    {
      id: 'stop', title: 'Apagar un DataNode',
      command: 'datanode stop 2', input: 'El número de DataNode',
      does: 'Mata el proceso del DataNode: deja de mandar latidos al NameNode.', expect: 'El DataNode queda apagado',
      run: async c => {
        const s = await c.status();
        const dn = [...s.processes].reverse().find(p => p.kind === 'datanode' && p.state === 'up');
        if (!dn) throw new Error('No hay ningún DataNode prendido');
        await c.api.processAction(dn.id, 'stop');
        await waitFor(c, () => procState(c, dn.id), st => st === 'down' || st === 'off', { seconds: 30, every: 1000, what: `Apagando ${dn.name}…` });
        return { summary: `${dn.name} apagado`, vars: { dn: dn.id }, link: { label: 'Ver el cluster', page: 'cluster' } };
      },
      verify: async c => {
        const st = c.vars.dn ? await procState(c, c.vars.dn) : undefined;
        return st === 'down' || st === 'off' ? { ok: true, detail: `${c.vars.dn} está apagado` } : { ok: false, detail: c.vars.dn ? `${c.vars.dn} está ${st}` : 'Todavía no se apagó ninguno' };
      },
    },
    {
      id: 'dead', title: 'Esperar a que el NameNode lo dé por muerto',
      command: 'hdfs dfsadmin -report', input: 'Nada: el NameNode cuenta los latidos que no llegan',
      does: 'Primero lo marca stale (sin latidos) y, pasado el plazo, dead.', expect: 'El DataNode figura como dead',
      run: async c => {
        const n = Number((c.vars.dn ?? '').replace(/\D/g, ''));
        const w = await waitFor(c, () => c.api.dataNodes(), l => l.find(d => d.id === n)?.state === 'dead', { seconds: 120, every: 2000, what: 'Esperando a que el NameNode lo dé por muerto…' });
        return {
          summary: w.ok ? `DataNode ${n}: dead` : `DataNode ${n} sigue ${w.value.find(d => d.id === n)?.state}: probá Verificar en unos segundos`,
          out: { kind: 'table', columns: ['DataNode', 'estado', 'bloques'], rows: w.value.map(d => [d.id, d.state, d.blocks]) },
        };
      },
      verify: async c => {
        const n = Number((c.vars.dn ?? '').replace(/\D/g, ''));
        const d = (await c.api.dataNodes()).find(x => x.id === n);
        return d?.state === 'dead' ? { ok: true, detail: `DataNode ${n} figura dead` } : { ok: false, detail: `DataNode ${n}: ${d?.state ?? 'no aparece'}` };
      },
    },
    {
      id: 'under', title: 'Ver los bloques sub-replicados',
      command: `hdfs fsck ${VENTAS_DIR}`, input: 'La carpeta', cap: 'hdfs.read',
      does: 'Cuenta las copias vivas: los bloques que estaban en el DataNode caído tienen una menos.',
      expect: 'Bloques Under replicated (con 2 DataNodes no hay dónde reponer la copia)',
      run: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        const r = await c.api.replication();
        return {
          summary: `${f.underReplicated} bloque(s) sub-replicado(s), ${f.missing} perdido(s)${r.tasks.length ? `; el NameNode está copiando ${r.tasks.length}` : ''}`,
          out: { kind: 'kv', items: [['Sub-replicados', String(f.underReplicated)], ['Perdidos', String(f.missing)], ['DataNodes vivos', String(f.liveDataNodes)], ['Copias en curso', String(r.tasks.length)]] },
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
      command: 'datanode start 2', input: 'El número de DataNode',
      does: 'Arranca, le avisa al NameNode qué bloques tiene y las copias vuelven a contar.', expect: 'fsck sano: ningún bloque sub-replicado',
      run: async c => {
        const id = c.vars.dn;
        if (!id) throw new Error('No hay un DataNode apagado por esta práctica');
        await c.api.processAction(id, 'start');
        const w = await waitFor(c, () => c.api.fsck(VENTAS_DIR), f => f.underReplicated === 0 && f.missing === 0, { seconds: 120, every: 2500, what: 'Esperando a que el DataNode vuelva y avise sus bloques…' });
        return { summary: w.ok ? 'De nuevo sano: cada bloque con sus copias' : `Todavía ${w.value.underReplicated} sub-replicado(s): probá Verificar en un rato` };
      },
      verify: async c => {
        const f = await c.api.fsck(VENTAS_DIR);
        return f.underReplicated === 0 && f.missing === 0 ? { ok: true, detail: 'fsck sano' } : { ok: false, detail: `${f.underReplicated} sub-replicado(s)` };
      },
    },
  ],
};
