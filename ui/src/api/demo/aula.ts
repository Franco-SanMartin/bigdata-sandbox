/* El aula del modo demo: las 11 PCs que midió la sonda el 27/10 (8 de 8 GB y 3 de 16), que se
   van sumando de a una por el túnel. Sirve para ver la vista Aula sin el laboratorio: en el
   contenedor de verdad la arma el servidor (server/sandbox_server/aula.py). */
import type { AulaPc, AulaStatus } from '../types';

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
    const usados = arriba && n % 3 === 0 ? 1024 : 0;
    return {
      nodo: `pc${String(n).padStart(2, '0')}`, numero: n, nombre, cpu, cores, dockerRamMb, ramPcGb: gb,
      estado: arriba ? 'arriba' : 'sumandose', motivo: arriba ? undefined : edad > 2000 ? 'esperando su NodeManager' : 'esperando su DataNode',
      fila: `/fila${Math.floor(i / 5) + 1}`, ipTunel: `10.13.0.${10 + n}`, inscriptaEn: abierta + i * CADA,
      datanode: edad > 2000 ? { estado: 'vivo', bloques, usadoMb: bloques * 64, ultimoS: 1 } : undefined,
      nodemanager: arriba ? { estado: 'RUNNING', mb, mbUsados: usados, vcores: cores, vcoresUsados: usados ? 2 : 0, contenedores: usados ? 2 : 0 } : undefined,
      prestaMb: arriba ? undefined : mb, prestaVcores: arriba ? undefined : cores,
      tunel: { saludoHaceS: Math.round((edad / 1000) % 25), rxMb: Math.round(bloques * 64 * 1.02), txMb: Math.round(bloques * 2) },
    };
  });
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
    ahora: now,
  };
}
