import { describe, expect, it } from 'vitest';
import { TAREAS } from './tareas';

describe('Comparar: las otras tareas, con el código real', () => {
  it('cada variante encuentra la parte que hace la cuenta', () => {
    // Si alguien cambia un ejemplo y la marca deja de aparecer, el núcleo sería el archivo entero
    for (const t of TAREAS) for (const v of t.variantes) for (const a of v.archivos) {
      expect(a.lineas, `${t.id}: ${a.nombre}`).toBeGreaterThan(2);
      if (!/modelos_/.test(a.nombre)) expect(a.nucleo.length, `${t.id}: ${a.nombre}`).toBeLessThan(a.texto.length);
    }
  });
  it('los tramos empiezan y terminan donde tienen que', () => {
    const sql = TAREAS.find(t => t.id === 'sql')!;
    const [hive, spark] = sql.variantes.map(v => v.archivos[0].nucleo.split('\n'));
    expect(hive[0]).toMatch(/^SELECT sucursal,/);
    expect(hive.at(-1)).toMatch(/^ORDER BY facturado DESC;/);
    expect(spark[0]).toMatch(/^if spark\.catalog\.tableExists/);
    expect(spark.at(-1)).toMatch(/"""\)\.show\(\)/);
    const sqoop = TAREAS.find(t => t.id === 'traer')!.variantes[0].archivos[0].nucleo.split('\n');
    expect(sqoop[0]).toMatch(/^sqoop import/);
    expect(sqoop[1]).toMatch(/--table ventas/);
    expect(sqoop.at(-1)).toMatch(/-m 4$/);
    const join = TAREAS.find(t => t.id === 'join')!;
    expect(join.variantes.map(v => v.archivos[0].nucleo.split('\n')[0])).toEqual([
      expect.stringMatching(/^SELECT p\.categoria/), expect.stringMatching(/^ventas = LOAD/), expect.stringMatching(/^from pyspark/)]);
  });
  it('la misma consulta en Hive y en Spark SQL', () => {
    const [hive, spark] = TAREAS.find(t => t.id === 'sql')!.variantes;
    const sql = (c: string) => /"(SELECT[^"]+)"/.exec(c)?.[1];
    expect(sql(hive.cmd)).toBe(sql(spark.cmd));
  });
});
