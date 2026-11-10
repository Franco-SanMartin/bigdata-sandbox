/* Datos a escala: el generador del estudio (sandbox_ml/generar.py) corre en YARN y escribe en HDFS un dataset
   sintético con señal (las reglas de clientes_senal, o calificaciones con factores escondidos para ALS) y, si se
   pide, suciedad. Sirve para probar el estudio con millones de filas en vez de un CSV chico. */
import { useEffect, useState } from 'react';
import { Factory } from 'lucide-react';
import { api } from '../../../api';
import type { MlGenerado, MlPedidoGenerar } from '../../../api/types';
import { toast } from '../../../state/ui';
import { Consola, useCorrida } from './comun';
import { fmtBytes, fmtSeg } from './estado';

const FILAS = [100_000, 1_000_000, 10_000_000, 100_000_000];
const nombreFilas = (n: number) => (n >= 1e9 ? `${n / 1e9} mil millones` : n === 1e6 ? '1 millón' : n >= 1e6 ? `${n / 1e6} millones` : `${n / 1e3} mil`);
const corto = (n: number) => (n >= 1e6 ? `${n / 1e6}m` : `${n / 1e3}k`);

export function GenerarEscala({ onListo }: { onListo: (ruta: string, formato: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [dataset, setDataset] = useState<MlPedidoGenerar['dataset']>('clientes');
  const [filas, setFilas] = useState(1_000_000);
  const [suciedad, setSuciedad] = useState(0.05);
  const [formato, setFormato] = useState<NonNullable<MlPedidoGenerar['formato']>>('parquet');
  const [particionar, setParticionar] = useState(true);
  const [salida, setSalida] = useState('');
  const [run, setRun] = useState<string | null>(null);
  const { corrida, lineas } = useCorrida(run);
  const sugerida = `/user/root/ml/generado/${dataset}_${corto(filas)}`;
  const destino = salida.trim() || sugerida;

  useEffect(() => {
    const g = corrida?.resultado as MlGenerado | undefined;
    if (corrida?.estado === 'listo' && g?.salida) {
      toast({ kind: 'ok', title: `${g.filas.toLocaleString('es-AR')} filas en hdfs://${g.salida}` });
      onListo(g.salida, g.formato ?? 'parquet');
    }
  }, [corrida?.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generar() {
    try {
      const r = await api().mlGenerate({ dataset, filas, salida: destino, formato, suciedad, particionar: dataset === 'clientes' && particionar });
      setRun(r.run);
    } catch (e) { toast({ kind: 'bad', title: 'No se pudo generar', description: e instanceof Error ? e.message : String(e) }); }
  }

  if (!abierto) {
    return <button type="button" className="btn btn-sm" onClick={() => setAbierto(true)}><Factory size={13} aria-hidden="true" />Datos a escala en HDFS…</button>;
  }
  const res = corrida?.resultado as MlGenerado | undefined;
  return (
    <div className="es-generar" role="group" aria-label="Generar datos a escala">
      <p className="es-nota">Un trabajo de Spark en YARN escribe en HDFS un dataset con <b>señal</b> (reglas conocidas: se sabe qué tiene que aprender el modelo) y la <b>suciedad</b> que elijas. Cada executor genera su parte: nada pasa por una sola máquina.</p>
      <div className="es-form-fila">
        <label className="es-campo"><span className="es-cl">Dataset</span>
          <select className="input" value={dataset} onChange={e => setDataset(e.target.value as MlPedidoGenerar['dataset'])}>
            <option value="clientes">clientes (vuelve, gasto, segmento)</option>
            <option value="calificaciones">calificaciones (para ALS)</option>
          </select></label>
        <label className="es-campo"><span className="es-cl">Filas</span>
          <select className="input" value={filas} onChange={e => setFilas(Number(e.target.value))}>
            {FILAS.map(n => <option key={n} value={n}>{nombreFilas(n)}</option>)}
          </select></label>
        <label className="es-campo"><span className="es-cl">Suciedad</span>
          <select className="input" value={suciedad} onChange={e => setSuciedad(Number(e.target.value))}>
            {[0, 0.02, 0.05, 0.1].map(s => <option key={s} value={s}>{s ? `${s * 100} % de filas con cada problema` : 'limpio'}</option>)}
          </select></label>
        <label className="es-campo"><span className="es-cl">Formato</span>
          <select className="input" value={formato} onChange={e => setFormato(e.target.value as typeof formato)}>
            {['parquet', 'orc', 'csv', 'json'].map(f => <option key={f}>{f}</option>)}
          </select></label>
        {dataset === 'clientes' && <label className="es-check"><input type="checkbox" checked={particionar} onChange={e => setParticionar(e.target.checked)} /> carpetas anio=/mes=</label>}
      </div>
      <label className="es-campo" data-ancho="full"><span className="es-cl">Carpeta en HDFS</span>
        <input className="input mono" value={salida} placeholder={sugerida} onChange={e => setSalida(e.target.value)} /></label>
      <div className="es-det-bar">
        <button type="button" className="btn btn-primary btn-sm" disabled={corrida?.estado === 'corriendo'} onClick={generar}><Factory size={13} aria-hidden="true" />Generar en YARN</button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAbierto(false)}>Cerrar</button>
        {filas >= 100_000_000 && <span className="muted">Con 100 millones de filas, en un contenedor solo tarda varios minutos y ocupa unos GB en HDFS.</span>}
      </div>
      {corrida && (
        <>
          <p className="es-nota">{corrida.estado === 'corriendo' ? `${Math.round(corrida.progreso * 100)} % · ${corrida.mensaje}` : corrida.estado === 'listo' && res
            ? `${res.filas?.toLocaleString('es-AR')} filas · ${fmtBytes(res.bytes)} en ${res.archivos} archivos · ${fmtSeg(res.segundos)} · ${res.app_id}`
            : corrida.error}</p>
          <Consola lineas={lineas} alto={140} />
        </>
      )}
    </div>
  );
}
