/* Modo demo: ver, bajar y mover en HDFS y lanzar plantillas de trabajos, con el cluster simulado. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from './index';
import { DEFAULT_CONFIG } from '../../lib/cluster';
import type { SandboxApi } from '../types';

let api: SandboxApi;
const wait = async (ok: () => Promise<boolean>, maxSec = 900) => {
  for (let i = 0; i < maxSec * 10; i++) {
    if (await ok()) return;
    await vi.advanceTimersByTimeAsync(100);
  }
  throw new Error('No llegó a tiempo');
};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout', 'performance'] });
  api = createDemoApi();
  await api.start(DEFAULT_CONFIG);
  await wait(async () => (await api.status()).phase === 'running');
});
afterAll(() => { vi.useRealTimers(); });

describe('HDFS del demo', () => {
  it('ve un archivo por tramos, cortando en líneas enteras', async () => {
    await api.hdfsUpload({ dest: '/user/root/ventas', example: 'ventas' });
    await wait(async () => (await api.files()).some(f => f.path === '/user/root/ventas/ventas_grandes.csv' && f.state !== 'writing'));
    const a = await api.hdfsCat('/user/root/ventas/ventas_grandes.csv', 0, 1000);
    expect(a.text.startsWith('fecha,sucursal,producto,cantidad,precio\n')).toBe(true);
    expect(a.text.endsWith('\n')).toBe(true);
    expect(a.length).toBe(a.text.length);
    expect(a.truncated).toBe(true);
    expect(a.totalBytes).toBe(Math.round(5.93 * 1048576));
    const b = await api.hdfsCat(a.path, a.offset + a.length, 1000);
    expect(b.offset).toBe(a.length);
    expect(b.command).toContain(`tail -c +${a.length + 1}`);
    await expect(api.hdfsCat('/user/root/ventas', 0, 10)).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.hdfsCat('/user/root/no-existe.txt')).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.hdfsCat(a.path, 0, 2 * 1048576)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('baja el archivo entero', async () => {
    const d = await api.hdfsDownload('/user/root/ventas/ventas_grandes.csv');
    expect(d.name).toBe('ventas_grandes.csv');
    expect(d.url.startsWith('blob:')).toBe(true);
  });

  it('mueve y renombra, y rechaza lo que no se puede', async () => {
    await api.hdfsMkdir('/user/root/archivo');
    const r = await api.hdfsMove('/user/root/ventas/ventas_grandes.csv', '/user/root/archivo');
    expect(r.path).toBe('/user/root/archivo/ventas_grandes.csv');
    const ls = await api.hdfsList('/user/root/archivo');
    expect(ls.entries.map(e => e.name)).toEqual(['ventas_grandes.csv']);
    const r2 = await api.hdfsMove(r.path, '/user/root/archivo/ventas.csv');
    expect(r2.trace?.output).toMatch(/Renombrado/);
    expect((await api.hdfsCat('/user/root/archivo/ventas.csv', 0, 100)).text).toMatch(/^fecha,/);
    await expect(api.hdfsMove('/user/root', '/tmp/x')).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.hdfsMove('/user/root/archivo', '/user/root/archivo/sub')).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.hdfsMove('/user/root/nada', '/tmp/x')).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.hdfsMove('/user/root/archivo/ventas.csv', '/no/existe/x.csv')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('plantillas de trabajos del demo', () => {
  it('lista las mismas plantillas que el servidor', async () => {
    const t = await api.jobTemplates();
    expect(t.map(x => x.id)).toEqual(['mr-wordcount', 'mr-pi', 'mr-grep', 'mr-ventas', 'hive-ventas', 'spark-pi', 'spark-ventas']);
  });

  it('wordcount cuenta las palabras de texto.txt y deja el resultado en HDFS', async () => {
    const id = await api.submitJob({ template: 'mr-wordcount', params: {} });
    expect(id).toMatch(/^application_/);
    await wait(async () => (await api.apps()).find(a => a.id === id)?.state === 'FINISHED');
    const out = await api.hdfsCat('/user/root/resultados/wordcount/part-r-00000');
    expect(out.text).toContain('datos\t3\n');
    expect(out.text).toContain('hadoop\t1\n');
    const logs = await api.appLogs(id);
    expect(logs.files.find(f => f.name === 'syslog')!.lines.join('\n')).toMatch(/Map input records=4/);
    expect(logs.containers[0]).toMatchObject({ id: 'cliente', label: 'Salida del comando' });
    const cli = await api.appLogs(id, 'cliente');
    expect(cli.container).toBe('cliente');
    expect(cli.files[0].lines[0]).toMatch(/^\$ hadoop jar .* wordcount /);
    expect(cli.files[0].lines.join('\n')).toMatch(/Map input records=4/);
    const ls = await api.hdfsList('/user/root/resultados/wordcount');
    expect(ls.entries.map(e => e.name).sort()).toEqual(['_SUCCESS', 'part-r-00000']);
    expect((await api.app(id)).command).toBe('hadoop jar hadoop-mapreduce-examples-3.3.6.jar wordcount /user/root/texto.txt /user/root/resultados/wordcount');
  });

  it('grep ordena las coincidencias de más a menos frecuentes', async () => {
    const id = await api.submitJob({ template: 'mr-grep', params: { regex: 'los [a-z]' } });
    await wait(async () => (await api.apps()).find(a => a.id === id)?.state === 'FINISHED');
    const out = await api.hdfsCat('/user/root/resultados/grep/part-r-00000');
    expect(out.text.split('\n')[0]).toBe('3\tlos d');
  });

  it('valida los parámetros igual que el servidor', async () => {
    await expect(api.submitJob({ template: 'mr-pi', params: { maps: 17 } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.submitJob({ template: 'mr-grep', params: { regex: '$(id)' } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.submitJob({ template: 'mr-wordcount', params: { out: '/user/root' } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.submitJob({ template: 'mr-wordcount', params: { otro: 1 } })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.submitJob({ template: 'nada', params: {} })).rejects.toMatchObject({ code: 'invalid' });
    await expect(api.submitJob({ template: 'mr-wordcount', params: { in: '/user/root/no-hay' } })).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.submitJob({ template: 'mr-wordcount', params: { overwrite: false } })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('pi imprime la estimación en el log', async () => {
    const id = await api.submitJob({ template: 'mr-pi', params: { maps: 2, samples: 100 } });
    await wait(async () => (await api.apps()).find(a => a.id === id)?.state === 'FINISHED');
    const lines = (await api.appLogs(id)).files.find(f => f.name === 'syslog')!.lines.join('\n');
    expect(lines).toMatch(/Estimated value of Pi is 3\./);
  });
});
