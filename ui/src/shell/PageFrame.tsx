/* Marco de cada pantalla: mientras baja su código se ve su esqueleto (nunca negro), sin contenedor
   se dice por qué y se puede reintentar, y si una pantalla se rompe no se lleva puesto al resto. */
import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, Unplug } from 'lucide-react';
import { retryNow, useSnapshot } from '../state/store';
import { navigate } from '../state/ui';
import { EmptyState, PageSkeleton } from '../components/base';
import type { PageId } from '../lib/route';

/** Reloj de la pantalla (para cuentas regresivas que no dependen del sondeo) */
export function useNow(ms = 500) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

/** Cuántos segundos faltan para el próximo intento */
export function retryIn(retryAt: number | null, now: number) {
  return retryAt ? Math.max(0, Math.ceil((retryAt - now) / 1000)) : 0;
}

/** Banda roja arriba de todo cuando el contenedor no contesta: qué pasa, cuándo reintenta y el botón */
export function ConnectionBand() {
  const { error, retryAt, failures, status } = useSnapshot();
  const now = useNow();
  if (!error) return null;
  const left = retryIn(retryAt, now);
  return (
    <div className="conn-band" role="alert">
      <Unplug size={15} aria-hidden="true" />
      <span className="conn-t"><b>Sin conexión con el contenedor.</b> <span className="conn-e">{error}</span></span>
      <span className="conn-r num">{left > 0 ? `Reintento en ${left} s` : 'Reintentando…'}{failures > 1 ? ` · ${failures} intentos` : ''}</span>
      {status && <span className="conn-r">Lo que ves es el último estado conocido</span>}
      <button type="button" className="btn btn-sm" onClick={retryNow}><RefreshCw size={13} />Reintentar ahora</button>
    </div>
  );
}

/** Sin estado todavía: esqueleto mientras se conecta; si no contesta, el motivo y qué hacer */
function NoStatus() {
  const { error } = useSnapshot();
  if (!error) return <PageSkeleton />;
  return (
    <div className="page-in">
      <EmptyState kind="error" title="No hay conexión con el contenedor"
        list={['Fijate que el contenedor esté corriendo: docker ps', 'Si lo acabás de levantar, la interfaz tarda unos segundos en contestar', 'Los datos no se pierden: están en el volumen bigdata_hadoop']}
        actions={<button type="button" className="btn btn-primary" onClick={retryNow}><RefreshCw size={15} />Reintentar ahora</button>}
        foot={error}>
        La interfaz no recibe el estado del cluster. Vuelve sola cuando el contenedor conteste.
      </EmptyState>
    </div>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.warn('Pantalla con error', error, info.componentStack); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    // Al publicar una versión nueva, los pedazos viejos de la interfaz dejan de existir: hay que recargar
    const chunk = /dynamically imported module|Failed to fetch|Loading chunk/i.test(e.message);
    return (
      <div className="page-in">
        <EmptyState kind="error" title={chunk ? 'Hay una versión nueva de la interfaz' : 'Esta pantalla se trabó'}
          actions={<>
            <button type="button" className="btn btn-primary" onClick={() => (chunk ? location.reload() : this.setState({ error: null }))}><RefreshCw size={15} />{chunk ? 'Recargar la página' : 'Volver a intentar'}</button>
            <button type="button" className="btn" onClick={() => { this.setState({ error: null }); navigate('inicio'); }}>Ir a Inicio</button>
          </>}
          foot={e.message}>
          {chunk ? 'Recargá para bajarla; lo que estabas haciendo en el cluster sigue igual.' : 'El resto de la interfaz anda. Si se repite, la consola tiene el detalle de lo último que pasó.'}
        </EmptyState>
      </div>
    );
  }
}

export function PageFrame({ page, children }: { page: PageId; children: ReactNode }) {
  const { status } = useSnapshot();
  return (
    <Boundary key={page}>
      <Suspense fallback={<PageSkeleton />}>{status ? children : <NoStatus />}</Suspense>
    </Boundary>
  );
}
