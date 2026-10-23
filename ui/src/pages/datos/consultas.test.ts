import { describe, expect, it } from 'vitest';
import { HISTORY_MAX, addSaved, loadDocs, loadHistory, loadSaved, newDoc, pushHistory, removeSaved, saveHistory, saveSaved, starter, suggestName, type HistoryEntry } from './consultas';
import { toCsv } from '../../lib/csv';

class MemStore implements Storage {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const h = (text: string, at: number, source: HistoryEntry['source'] = 'hive'): HistoryEntry => ({ source, text, at, ok: true });

describe('historial', () => {
  it('la más nueva arriba, sin repetir la misma consulta, hasta 50', () => {
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 60; i++) list = pushHistory(list, h(`SELECT ${i}`, i));
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0].text).toBe('SELECT 59');
    expect(list[49].text).toBe('SELECT 10');
    list = pushHistory(list, h('  SELECT 30 ', 100));
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list.filter(x => x.text.trim() === 'SELECT 30')).toHaveLength(1);
    expect(list[0].at).toBe(100);
    // La misma consulta en otro motor es otra entrada
    expect(pushHistory(list, h('SELECT 30', 101, 'mysql'))).toHaveLength(HISTORY_MAX);
    expect(pushHistory([h('SELECT 1', 1)], h('SELECT 1', 2, 'mysql'))).toHaveLength(2);
  });

  it('se guarda y se lee de localStorage, y tolera basura', () => {
    const s = new MemStore();
    saveHistory([h('SELECT 1', 1), h('db.x.find()', 2, 'mongodb')], s);
    expect(loadHistory(s).map(x => x.source)).toEqual(['hive', 'mongodb']);
    s.setItem('consultas.historial', '{no es json');
    expect(loadHistory(s)).toEqual([]);
    s.setItem('consultas.historial', JSON.stringify([{ text: 'x', at: 1, source: 'oracle' }, h('SELECT 2', 3)]));
    expect(loadHistory(s)).toHaveLength(1);
    s.setItem('consultas.docs', JSON.stringify([{ id: 'a', title: 'Consulta 1', source: 'pig', text: 'DUMP a;' }, null]));
    expect(loadDocs(s)).toEqual([{ id: 'a', title: 'Consulta 1', source: 'pig', text: 'DUMP a;' }]);
    expect(loadHistory(undefined)).toEqual([]);
  });
});

describe('guardadas', () => {
  it('guardar pisa la del mismo nombre y motor; borrar la saca', () => {
    let list = addSaved([], { name: 'Por sucursal', source: 'hive', text: 'SELECT 1' }, 1);
    list = addSaved(list, { name: 'Por sucursal', source: 'mysql', text: 'SELECT 2' }, 2);
    list = addSaved(list, { name: 'Por sucursal', source: 'hive', text: 'SELECT 3' }, 3);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ source: 'hive', text: 'SELECT 3', at: 3 });
    expect(addSaved([], { name: '   ', source: 'pig', text: 'x' })[0].name).toBe('Sin nombre');
    const s = new MemStore();
    saveSaved(list, s);
    expect(loadSaved(s)).toEqual(list);
    expect(removeSaved(list, list[0].id).map(x => x.source)).toEqual(['mysql']);
  });

  it('nombre sugerido, documentos nuevos y la consulta de una tabla', () => {
    expect(suggestName('\n-- ventas por mes\nSELECT …')).toBe('ventas por mes');
    expect(suggestName('x'.repeat(80))).toHaveLength(48);
    const a = newDoc([], 'hive');
    const b = newDoc([a], 'pig');
    expect([a.title, b.title]).toEqual(['Consulta 1', 'Consulta 2']);
    expect(newDoc([b], 'hive').title).toBe('Consulta 1');
    expect(starter('hive', 'default.ventas')).toBe('SELECT * FROM default.ventas LIMIT 100;');
    expect(starter('mongodb', 'tienda.pedidos')).toBe('db.pedidos.find().limit(100)');
  });
});

describe('CSV del resultado', () => {
  it('NULL vacío, comillas y saltos escapados', () => {
    expect(toCsv(['sucursal', 'nota'], [['Centro', null], ['Sur', 'dijo "hola", chau']])).toBe('sucursal,nota\r\nCentro,\r\nSur,"dijo ""hola"", chau"\r\n');
  });
});
