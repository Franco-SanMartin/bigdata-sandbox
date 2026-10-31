import { describe, expect, it } from 'vitest';
import { PAGES } from '../lib/route';
import { GLOSARIO_DE } from './content';
import { GLOSARIO, TERMINOS, ancla, leerGlosario, piezas } from './glosario';

describe('glosario único (guias/glosario.md)', () => {
  it('lee las capas con sus términos', () => {
    expect(GLOSARIO.map(s => s.capa)).toEqual(['datos', 'recursos', 'motores', 'lenguajes', 'puente', undefined, undefined]);
    for (const s of GLOSARIO) {
      expect(s.intro.length, s.titulo).toBeGreaterThan(0);
      for (const t of s.terminos) expect(t.parrafos.length, t.t).toBeGreaterThan(0);
    }
    expect(TERMINOS.size).toBeGreaterThan(50);
    // Sin términos repetidos: el ancla tiene que llevar a uno solo
    expect(TERMINOS.size).toBe(GLOSARIO.flatMap(s => s.terminos).length);
    expect(GLOSARIO.at(-1)!.tabla![0][0]).toBe('Tarea');
  });
  it('cada pantalla nombra términos que existen', () => {
    for (const p of PAGES) for (const id of GLOSARIO_DE[p]) expect(TERMINOS.has(id), `${p}: ${id}`).toBe(true);
  });
  it('las anclas son las de GitHub', () => {
    expect(ancla('Acción y transformación')).toBe('acción-y-transformación');
    expect(ancla('Subir archivos (put)')).toBe('subir-archivos-put');
    expect(ancla('`hdfs dfs -put`')).toBe('hdfs-dfs--put');
  });
  it('se saltea los comentarios y lo que va antes de la primera capa', () => {
    const g = leerGlosario('# G\n\nintro\n<!-- uno\ndos -->\n## Recursos: x\n\nhola\nque tal\n\n### YARN\n\nreparte\n<!-- c -->\nmemoria\n');
    expect(g).toEqual([{ id: 'recursos-x', titulo: 'Recursos: x', capa: 'recursos', intro: ['hola que tal'], terminos: [{ id: 'yarn', t: 'YARN', parrafos: ['reparte memoria'] }] }]);
  });
  it('negrita, cursiva, código y enlaces', () => {
    expect(piezas('*No confundir con:* un `-rm` de **todo**, ver [guía](03-hdfs.md)')).toEqual([
      { k: 'i', s: 'No confundir con:' }, { k: 'texto', s: ' un ' }, { k: 'code', s: '-rm' }, { k: 'texto', s: ' de ' },
      { k: 'b', s: 'todo' }, { k: 'texto', s: ', ver ' }, { k: 'texto', s: 'guía' },
    ]);
  });
});
