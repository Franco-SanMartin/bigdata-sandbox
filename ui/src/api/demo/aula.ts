/* El aula del modo demo: las 11 PCs que midió la sonda el 27/10 (8 de 8 GB y 3 de 16), que se
   van sumando de a una por el túnel. Sirve para ver la vista Aula sin el laboratorio: en el
   contenedor de verdad la arma el servidor (server/sandbox_server/aula.py y aula_vivo.py).
   El tráfico, los trabajos y la caída de pc07 son simulados, con la forma de lo que mide el maestro. */
import type {
  AulaCaida, AulaCola, AulaColasGuardadas, AulaEnergia, AulaEscala, AulaLocalidad, AulaLocalidadTipo, AulaMedida, AulaModoApagar, AulaPc, AulaPlano,
  AulaStatus, AulaTarea, AulaTrabajoEscala, AulaTrafico,
} from '../types';
import { leerGrupos } from '../../lib/aula';
import { fail } from '../errors';

/* El plano que guarda el profe: en la demo vive en memoria (en el maestro, en /hadoop/aula/plano.json) */
let plano: AulaPlano | null = null;

export function demoGuardarPlano(p: AulaPlano): AulaPlano {
  const vistos = new Set<string>();
  if (!Array.isArray(p.filas) || !p.filas.length || p.filas.length > 8) fail('invalid', 'El plano tiene de 1 a 8 filas');
  for (const f of p.filas) {
    if (!f.length || f.length > 12) fail('invalid', 'Cada fila tiene de 1 a 12 lugares');
    for (const x of f) {
      if (x == null) continue;
      if (!/^pc\d{2,3}$/.test(x)) fail('invalid', `${x} no es una PC (pc01, pc02...)`);
      if (vistos.has(x)) fail('invalid', `${x} está dos veces en el plano`);
      vistos.add(x);
    }
  }
  const antes = new Map((plano?.filas ?? []).flatMap((f, i) => f.filter(Boolean).map(x => [x as string, i])));
  plano = { filas: p.filas.map(f => [...f]), actualizado: Date.now() };
  const cambian = p.filas.flatMap((f, i) => f.filter((x): x is string => !!x && antes.has(x) && antes.get(x) !== i));
  return { ...plano, cambianDeRack: cambian };
}

/* Dos trabajos corriendo en el aula: un PySpark y un MapReduce */
const APPS = ['application_1794289929080_0012', 'application_1794289929080_0013'];

const PCS: [string, number, string, number][] = [
  ['PC107', 8, 'Intel(R) Core(TM) i3-3220 CPU @ 3.30GHz', 4], ['PC109', 8, 'Intel(R) Core(TM) i3-3220 CPU @ 3.30GHz', 4],
  ['PC121', 8, 'Intel(R) Core(TM) i3-3220 CPU @ 3.30GHz', 4], ['PC137', 16, '12th Gen Intel(R) Core(TM) i3-12100', 8],
  ['PC157', 8, 'Intel(R) Core(TM) i3-2120 CPU @ 3.30GHz', 4], ['PC165', 16, '12th Gen Intel(R) Core(TM) i3-12100', 8],
  ['PC180', 8, 'Intel(R) Core(TM) i3-2120 CPU @ 3.30GHz', 4], ['PC182', 16, '12th Gen Intel(R) Core(TM) i3-12100', 8],
  ['PC223', 8, 'Intel(R) Core(TM) i5-4590 CPU @ 3.30GHz', 4], ['PC228', 8, 'Intel(R) Core(TM) i3-2120 CPU @ 3.30GHz', 4],
  ['PC241', 8, 'Intel(R) Core(TM) i5-4440 CPU @ 3.10GHz', 4],
];
const BLOQUES = 96;            // un dataset de ~6 GB con bloques de 128 MB... en chico: 96 bloques, réplica 2
const CADA = 6000;             // una PC nueva cada 6 s

export function demoAula(abierta: number, now: number): AulaStatus {
  const t = now - abierta;
  const sumadas = Math.min(PCS.length, Math.floor(t / CADA) + 1);
  const pcs: AulaPc[] = PCS.slice(0, sumadas).map(([nombre, gb, cpu, cores], i) => {
    const n = i + 1, dockerRamMb = gb === 16 ? 7828 : 3863, mb = gb === 16 ? 5120 : 2048;
    const edad = t - i * CADA;
    const arriba = edad > 4000;
    const bloques = arriba ? Math.round((BLOQUES / PCS.length) * (gb === 16 ? 1.3 : .9)) : 0;
    const usados = arriba && n % 3 !== 1 ? 1024 : 0;
    const apps = usados ? (n % 2 ? [{ app: APPS[0], n: 2, am: n === 2 }] : [{ app: APPS[0], n: 1, am: false }, { app: APPS[1], n: 1, am: n === 3 }]) : undefined;
    return {
      nodo: `pc${String(n).padStart(2, '0')}`, numero: n, nombre, cpu, cores, dockerRamMb, ramPcGb: gb,
      estado: arriba ? 'arriba' : 'sumandose', motivo: arriba ? undefined : edad > 2000 ? 'esperando su NodeManager' : 'esperando su DataNode',
      fila: `/fila${Math.floor(i / 5) + 1}`, ipTunel: `10.13.0.${10 + n}`, inscriptaEn: abierta + i * CADA, apps,
      datanode: edad > 2000 ? { estado: 'vivo', bloques, usadoMb: bloques * 64, ultimoS: 1 } : undefined,
      nodemanager: arriba ? { estado: 'RUNNING', mb, mbUsados: usados, vcores: cores, vcoresUsados: usados ? 2 : 0, contenedores: usados ? 2 : 0 } : undefined,
      prestaMb: arriba ? undefined : mb, prestaVcores: arriba ? undefined : cores,
      tunel: { saludoHaceS: Math.round((edad / 1000) % 25), rxMb: Math.round(bloques * 64 * 1.02), txMb: Math.round(bloques * 2) },
    };
  });
  // Las que el profe apagó desde la vista: sin DataNode ni NodeManager (roja a los 40 s, como en el maestro)
  for (const pc of pcs) {
    const ap = apagadas.get(pc.nodo);
    if (!ap) continue;
    const s = (now - ap.desde) / 1000;
    Object.assign(pc, {
      apagada: ap, nodemanager: undefined, apps: undefined, estado: s < 40 && ap.modo === 'golpe' ? 'sin-respuesta' : 'caida',
      motivo: `apagada desde la vista Aula (${ap.modo === 'golpe' ? 'de golpe' : 'ordenado'})`,
      datanode: pc.datanode && { ...pc.datanode, estado: 'muerto', ultimoS: Math.round(s) },
    });
  }
  // Con plano, la fila (el rack) y el lugar salen de ahí
  if (plano) {
    plano.filas.forEach((f, fi) => f.forEach((x, li) => {
      const pc = pcs.find(p => p.nodo === x);
      if (pc) { pc.fila = `/fila${fi + 1}`; pc.lugar = { fila: fi, lugar: li }; }
    }));
  }
  const corriendo = pcs.filter(p => p.nodemanager);
  const enMaestro = Math.min(BLOQUES, Math.round(BLOQUES * Math.min(1, t / (CADA * PCS.length))));
  const listo = enMaestro >= BLOQUES;
  const cuenta = (e: AulaPc['estado']) => pcs.filter(p => p.estado === e).length;
  return {
    red: 'wireguard', codigo: 'K7Q2', ipAula: '192.169.0.86', tunel: 'kernel', mtu: 1380, replicacion: 2,
    lineaVeyon: 'cmd /c ""%USERPROFILE%\\Desktop\\empresa-alumno.cmd" 192.169.0.86 K7Q2"',
    maestro: { estado: 'vivo', bloques: enMaestro, usadoMb: enMaestro * 64 },
    hdfs: { disponible: true, bloques: BLOQUES, subReplicados: BLOQUES - enMaestro, perdidos: 0 },
    yarn: {
      mb: corriendo.reduce((a, p) => a + p.nodemanager!.mb, 0), mbUsados: corriendo.reduce((a, p) => a + p.nodemanager!.mbUsados, 0),
      vcores: corriendo.reduce((a, p) => a + p.nodemanager!.vcores, 0), vcoresUsados: corriendo.reduce((a, p) => a + p.nodemanager!.vcoresUsados, 0),
      contenedores: corriendo.reduce((a, p) => a + p.nodemanager!.contenedores, 0),
    },
    pcs,
    resumen: { sumandose: cuenta('sumandose'), arriba: cuenta('arriba'), 'sin-respuesta': cuenta('sin-respuesta'), caida: cuenta('caida') },
    apagar: {
      listo, bloquesEnMaestro: enMaestro, bloques: BLOQUES,
      porque: listo ? 'el maestro tiene una copia de cada bloque: se puede apagar el aula sin perder nada'
        : `el maestro tiene ${enMaestro} de ${BLOQUES} bloques: HDFS está copiando lo que falta`,
    },
    eventos: pcs.map(p => `${new Date(p.inscriptaEn!).toLocaleTimeString('es-AR', { hour12: false })} ${p.nombre} se sumó como ${p.nodo} (${p.ipTunel}): Docker con ${p.dockerRamMb} MB y ${p.cores} cores, presta ${p.nodemanager?.mb ?? p.prestaMb} MB`),
    plano,
    colas: demoColasAhora(corriendo.reduce((a, p) => a + p.nodemanager!.mbUsados, 0), corriendo.reduce((a, p) => a + p.nodemanager!.mb, 0)),
    ahora: now,
  };
}

/* El tráfico: cada PC manda bloques al maestro (la copia ARCHIVE) y hay shuffle entre las PCs con trabajos */
export function demoTrafico(abierta: number, now: number): AulaTrafico {
  const sumadas = Math.min(PCS.length, Math.floor((now - abierta) / CADA) + 1);
  const nodos = Array.from({ length: sumadas }, (_, i) => `pc${String(i + 1).padStart(2, '0')}`);
  const tasa = (n: number, t: number, base: number) => Math.max(0, +(base * (0.6 + 0.4 * Math.sin(t / 7000 + n))).toFixed(2));
  const serie = Array.from({ length: 60 }, (_, k) => {
    const t = now - (59 - k) * 2000;
    const pcs = Object.fromEntries(nodos.map((x, i) => [x, { manda: tasa(i, t, 9 + (i % 4) * 6), recibe: tasa(i + 2, t, 4 + (i % 3) * 3) }]));
    return { t, total: +Object.values(pcs).reduce((a, p) => a + p.manda, 0).toFixed(2), pcs };
  });
  const ult = serie[serie.length - 1].pcs;
  const pares: AulaTrafico['pares'] = nodos.flatMap((x, i) => {
    const hdfs = ult[x].manda * 0.7;
    const lista = [{ de: x, a: 'maestro', mbps: +(hdfs + 0.3).toFixed(2), clases: { hdfs: +hdfs.toFixed(2), shuffle: 0, yarn: 0.2, otro: 0.1 } }];
    if (i > 0 && i % 3 !== 1) {
      const sh = ult[x].manda * 0.3;
      lista.push({ de: x, a: nodos[(i + 2) % nodos.length], mbps: +(sh + 0.1).toFixed(2), clases: { hdfs: 0, shuffle: +sh.toFixed(2), yarn: 0.1, otro: 0 } });
    }
    return lista;
  }).sort((a, b) => b.mbps - a.mbps);
  return {
    fuente: 'nft', motivo: null, techoMbps: 50, cadaS: 2, serie, pares: pares.slice(0, 40),
    porPc: nodos.map(x => ({ nodo: x, ...ult[x], usoTecho: +(Math.max(ult[x].manda, ult[x].recibe) / 50).toFixed(3) }))
      .sort((a, b) => b.manda + b.recibe - (a.manda + a.recibe)),
  };
}

/* La caída de pc07 (alguien la apagó por Veyon): ámbar, roja a los 40 s, HDFS copia sus 18 bloques y vuelve */
export function demoCaidas(abierta: number, now: number): AulaCaida[] {
  if (now - abierta < CADA * 8) return [];
  const desde = abierta + CADA * 8;
  const serie: AulaCaida['serie'] = Array.from({ length: 61 }, (_, k) => {
    const s = k * 2;
    const estado = s < 40 ? 'sin-respuesta' : s < 120 ? 'caida' : 'arriba';
    const sub = s < 42 ? 0 : s < 95 ? Math.max(0, Math.round(18 - (s - 42) * 0.34)) : 0;
    const pend = s >= 42 && s < 95 ? Math.min(6, sub) : 0;
    return { s, estado, sub, pend, contenedores: 0 };
  });
  return [{
    nodo: 'pc07', desde, hasta: desde + 120_000, abierta: false, serie,
    resumen: {
      contenedoresPerdidos: 2, bloquesRecopiados: 18, mbRecopiados: 1152, rojaALosS: 40, copiadoALosS: 96, duracionS: 120, cierre: 'volvió',
      texto: 'pc07 dejó de contestar; el NameNode la dio por muerta a los 40 s; se perdieron 2 contenedores (YARN reintenta sus tareas en otras PCs); HDFS re-copió 18 bloques (~1152 MB) en 56 s; volvió a los 120 s.',
    },
  }];
}

/* ---------- Los opcionales: apagar desde la vista, colas por grupo, localidad y escala ---------- */

const apagadas = new Map<string, { desde: number; modo: AulaModoApagar }>();

export function demoEnergia(nodo: string, accion: 'apagar' | 'prender', modo: AulaModoApagar | undefined, now: number): AulaEnergia {
  if (!/^pc\d{2}$/.test(nodo)) fail('invalid', `${nodo} no es una PC del aula (pc01, pc02...)`);
  if (accion === 'apagar') {
    const m = modo ?? 'ordenado';
    if (m !== 'ordenado' && m !== 'golpe') fail('invalid', 'El modo es ordenado o golpe');
    apagadas.set(nodo, { desde: now, modo: m });
    return { nodo, accion, modo: m, datanode: false, nodemanager: false };
  }
  apagadas.delete(nodo);
  return { nodo, accion, modo: null, datanode: true, nodemanager: true };
}

let grupos: string[] = [];

function demoColasAhora(mbUsados: number, mb: number): AulaCola[] {
  const parte = Math.floor(100 / (grupos.length + 1));
  const usada = mb ? (mbUsados / mb) * 100 : 0;
  const cola = (nombre: string, capacidad: number, u: number): AulaCola => ({
    nombre, estado: 'RUNNING', capacidad, maxima: 100, usada: +u.toFixed(1), mb: Math.round((u / 100) * mb), vcores: Math.round(u / 10),
    apps: u > 0 ? 1 : 0, pendientes: 0, contenedores: Math.round(u / 5),
  });
  // Los dos trabajos de la demo: uno en default y otro en el primer grupo
  return [cola('default', 100 - parte * grupos.length, grupos.length ? usada / 2 : usada),
    ...grupos.map((g, i) => cola(g, parte, i === 0 ? usada / 2 : 0))];
}

export function demoGuardarColas(gs: string[]): AulaColasGuardadas {
  const r = leerGrupos(gs.join(' '));
  if (r.error) fail('invalid', r.error);
  const paradas = grupos.filter(g => !r.grupos.includes(g));
  grupos = r.grupos;
  return { grupos, paradas, colas: demoColasAhora(0, 0) };
}

export function demoTrabajoEnCola(cola: string, trabajo: string): { id: string; cola: string } {
  if (cola !== 'default' && !grupos.includes(cola)) fail('not_found', `No hay una cola ${cola}`);
  if (trabajo !== 'mr-pi' && trabajo !== 'spark-pi') fail('invalid', 'El trabajo de muestra es mr-pi o spark-pi');
  return { id: `application_1794289929080_${String(20 + Math.floor(Math.random() * 70)).padStart(4, '0')}`, cola };
}

/* La localidad: 12 maps sobre las PCs que hay (bloques en dos PCs de distintas filas), como sale del .jhist */
export function demoLocalidad(app: string, abierta: number, now: number): AulaLocalidad {
  const a = demoAula(abierta, now);
  const vivas = a.pcs.filter(p => p.nodemanager).map(p => p.nodo);
  const fila = new Map(a.pcs.map(p => [p.nodo, p.fila]));
  const spark = /_0012$/.test(app);
  if (!vivas.length) {
    return { app, tipo: spark ? 'SPARK' : 'MAPREDUCE', estado: 'RUNNING', soportado: true, fuente: 'en curso', tareas: [],
      resumen: { 'data-local': 0, 'rack-local': 0, 'off-rack': 0 }, motivo: 'el ApplicationMaster todavía no escribió su historial' };
  }
  const todas = a.pcs.map(p => p.nodo);
  const tareas: AulaTarea[] = Array.from({ length: 12 }, (_, i) => {
    const bloque = spark ? null : [todas[(i * 3) % todas.length], todas[(i * 3 + 5) % todas.length]].filter((x, j, xs) => xs.indexOf(x) === j);
    // 2 de cada 3 corren donde estaba el bloque; el resto, en otra PC (de la misma fila o de otra)
    const corrio = bloque && i % 3 !== 2 && vivas.includes(bloque[0]) ? bloque[0] : vivas[(i * 7) % vivas.length];
    const localidad: AulaLocalidadTipo = bloque == null ? (i % 4 ? 'data-local' : 'rack-local')
      : bloque.includes(corrio) ? 'data-local' : bloque.some(b => fila.get(b) === fila.get(corrio)) ? 'rack-local' : 'off-rack';
    return {
      id: spark ? `s0.${i}` : `m${String(i).padStart(6, '0')}`, tipo: spark ? 'spark' : 'map', bloque, corrio, rack: fila.get(corrio) ?? null, localidad,
      yarn: spark ? (localidad === 'data-local' ? 'NODE_LOCAL' : 'RACK_LOCAL') : null, estado: 'ok', intentos: 1, fallidos: 0,
    };
  });
  tareas.push({ id: 'r000000', tipo: 'reduce', bloque: null, corrio: vivas[0], rack: fila.get(vivas[0]) ?? null, localidad: null, yarn: null, estado: 'ok', intentos: 1, fallidos: 0 });
  const resumen = { 'data-local': 0, 'rack-local': 0, 'off-rack': 0 };
  for (const t of tareas) if (t.localidad) resumen[t.localidad]++;
  return {
    app, tipo: spark ? 'SPARK' : 'MAPREDUCE', estado: 'FINISHED', nombre: spark ? 'PySpark ventas' : 'QuasiMonteCarlo', cola: 'default',
    soportado: true, fuente: 'historial', tareas: spark ? tareas.slice(0, 12) : tareas, resumen,
    ...(spark ? { motivo: 'Spark dice en qué PC corrió cada tarea y qué localidad logró, no dónde estaba el bloque' } : {}),
  };
}

/* La escala: cada medición tarda lo que diría la ley de Amdahl con las PCs que hay (90 % paralelo) */
const medidas: AulaMedida[] = [];
let midiendo: AulaMedida | null = null;
const BASE_S: Record<AulaTrabajoEscala, number> = { 'mr-pi': 96, 'spark-pi': 48, 'mr-wordcount': 140 };

function cerrarMedicion(now: number) {
  if (!midiendo) return;
  const s = +(BASE_S[midiendo.trabajo] * (0.1 + 0.9 / midiendo.pcs)).toFixed(1);
  if (now - midiendo.inicio >= (s / 10) * 1000) {   // en la demo, 10 veces más rápido
    medidas.push({ ...midiendo, estado: 'ok', segundos: s, resultado: 'FINISHED', pcsAlFinal: midiendo.pcs, cambiaron: false });
    midiendo = null;
  }
}

export function demoEscala(abierta: number, now: number): AulaEscala {
  cerrarMedicion(now);
  const a = demoAula(abierta, now);
  const vivas = a.pcs.filter(p => p.nodemanager);
  const grupos = new Map<string, Map<number, number[]>>();
  for (const m of medidas) {
    if (m.estado !== 'ok' || !m.segundos) continue;
    const g = grupos.get(m.trabajo) ?? new Map<number, number[]>();
    g.set(m.pcs, [...(g.get(m.pcs) ?? []), m.segundos]);
    grupos.set(m.trabajo, g);
  }
  const curva = [...grupos.entries()].map(([trabajo, g]) => {
    const puntos = [...g.entries()].sort(([x], [y]) => x - y).map(([pcs, ss]) => ({ pcs, segundos: +(ss.reduce((x, y) => x + y, 0) / ss.length).toFixed(1), medidas: ss.length, aceleracion: 1 }));
    for (const p of puntos) p.aceleracion = +(puntos[0].segundos / p.segundos).toFixed(2);
    return { trabajo: trabajo as AulaTrabajoEscala, entrada: null, puntos };
  });
  return {
    corriendo: midiendo, medidas: [...medidas].reverse(), curva,
    ahora: { pcs: vivas.length, nodos: vivas.map(p => p.nodo), mb: a.yarn.mb, vcores: a.yarn.vcores },
  };
}

export function demoMedir(trabajo: AulaTrabajoEscala, cola: string | null | undefined, abierta: number, now: number): AulaMedida {
  if (!(trabajo in BASE_S)) fail('invalid', 'El trabajo a medir es uno de: mr-pi, spark-pi, mr-wordcount');
  cerrarMedicion(now);
  if (midiendo) fail('busy', `Ya se está midiendo ${midiendo.trabajo}: esperá a que termine`);
  const e = demoEscala(abierta, now).ahora;
  if (!e.pcs) fail('service_down', 'Ninguna PC le presta a YARN: no hay dónde correr el trabajo');
  midiendo = { id: `m${now}`, trabajo, entrada: null, cola: cola ?? null, estado: 'corriendo', inicio: now,
    app: `application_1794289929080_${String(100 + medidas.length).padStart(4, '0')}`, ...e };
  return midiendo;
}

export function demoBorrarMedida(id: string | undefined, abierta: number, now: number): AulaEscala {
  if (id == null) medidas.length = 0;
  else {
    const i = medidas.findIndex(m => m.id === id);
    if (i < 0) fail('not_found', `No hay una medida ${id}`);
    medidas.splice(i, 1);
  }
  return demoEscala(abierta, now);
}
