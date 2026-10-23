import { beforeAll, describe, expect, it, vi } from 'vitest';

/* El router corre en el navegador: acá se simulan location, history y el evento hashchange */
const listeners: Record<string, (() => void)[]> = {};
const loc = { hash: '#hdfs/user/root' };
const hist = { state: null, replaceState: vi.fn((_s: unknown, _t: string, h: string) => { loc.hash = h; }) };
let ui: typeof import('./ui');

beforeAll(async () => {
  vi.stubGlobal('location', loc);
  vi.stubGlobal('history', hist);
  vi.stubGlobal('addEventListener', (t: string, f: () => void) => { (listeners[t] ||= []).push(f); });
  ui = await import('./ui');
});
const fireHash = (h: string) => { loc.hash = h; listeners.hashchange?.forEach(f => f()); };

describe('router con subrutas', () => {
  it('arranca leyendo el hash de la página', () => {
    expect(ui.currentRoute()).toEqual(['hdfs', 'user/root']);
  });
  it('navigate cambia el hash (con cada tramo codificado) y los stores', () => {
    ui.navigate('cluster', 'dn2');
    expect(loc.hash).toBe('#cluster/dn2');
    expect(ui.currentRoute()).toEqual(['cluster', 'dn2']);
    ui.navigate('hdfs', '/user/root/con espacio/');
    expect(loc.hash).toBe('#hdfs/user/root/con%20espacio');
    expect(ui.currentRoute()).toEqual(['hdfs', 'user/root/con espacio']);
  });
  it('con replace no suma un paso al historial', () => {
    hist.replaceState.mockClear();
    ui.navigate('consola', 'evt-7', { replace: true });
    expect(hist.replaceState).toHaveBeenCalledTimes(1);
    expect(loc.hash).toBe('#consola/evt-7');
    ui.setRouteArg('evt-8');
    expect(ui.currentRoute()).toEqual(['consola', 'evt-8']);
    expect(hist.replaceState).toHaveBeenCalledTimes(2);
  });
  it('no reescribe el hash si ya es el mismo', () => {
    hist.replaceState.mockClear();
    ui.navigate('consola', 'evt-8', { replace: true });
    expect(hist.replaceState).not.toHaveBeenCalled();
  });
  it('atrás/adelante del navegador (hashchange) actualiza pantalla y sufijo', () => {
    fireHash('#practicas/hdfs-basico');
    expect(ui.currentRoute()).toEqual(['practicas', 'hdfs-basico']);
    fireHash('#cualquiera');
    expect(ui.currentRoute()).toEqual(['inicio', '']);
  });
});

describe('avisos', () => {
  it('los de error y en curso traen "Ver en consola"; los de listo no', () => {
    ui.toasts.set([]);
    ui.toast({ title: 'No se pudo', kind: 'bad' });
    ui.toast({ title: 'Arrancando', kind: 'run' });
    ui.toast({ title: 'Copiado', kind: 'ok' });
    ui.toast({ title: 'Sin consola', kind: 'bad', console: false });
    const [a, b, c, d] = ui.toasts.get();
    expect(a.action?.label).toBe('Ver en consola');
    expect(b.action?.label).toBe('Ver en consola');
    expect(c.action).toBeUndefined();
    expect(d.action).toBeUndefined();
    a.action!.run();
    expect(ui.consoleOpen.get()).toBe(true);
  });
  it('una acción propia gana', () => {
    ui.toasts.set([]);
    const run = vi.fn();
    ui.toast({ title: 'Borrado', kind: 'bad', action: { label: 'Deshacer', run } });
    expect(ui.toasts.get()[0].action?.label).toBe('Deshacer');
  });
});
