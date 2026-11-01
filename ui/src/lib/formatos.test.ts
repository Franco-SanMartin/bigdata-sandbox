import { describe, expect, it } from 'vitest';
import type { CatalogEntry, HdfsEntry } from '../api/types';
import { FORMATOS, consulta, crearCopia, existentes, medir } from './formatos';

const COLS = [{ name: 'fecha', type: 'string' }, { name: 'sucursal', type: 'string' }, { name: 'producto', type: 'string' }, { name: 'cantidad', type: 'int' }, { name: 'precio', type: 'int' }];
const [csv, parquet, orc] = FORMATOS;

describe('Formatos: la misma tabla en CSV, Parquet y ORC', () => {
  it('cada copia es una tabla externa en su carpeta, llena desde ventas', () => {
    const [crear, llenar] = crearCopia(parquet, COLS);
    expect(crear).toBe("CREATE EXTERNAL TABLE IF NOT EXISTS ventas_parquet (\n  fecha STRING,\n  sucursal STRING,\n  producto STRING,\n  cantidad INT,\n  precio INT\n)\nSTORED AS PARQUET\nLOCATION '/user/root/formatos/parquet';");
    expect(llenar).toBe('INSERT OVERWRITE TABLE ventas_parquet\nSELECT * FROM ventas;');
    expect(crearCopia(orc, COLS)[0]).toContain('STORED AS ORC');
    expect(() => crearCopia(csv, COLS)).toThrow();
  });
  it('la misma consulta en las tres', () => {
    expect(consulta('default.ventas_orc')).toContain('FROM ventas_orc\nGROUP BY producto;');
    expect(consulta('default.ventas')).toContain('FROM ventas\n');
  });
  it('mide solo los archivos de datos', () => {
    const e = (name: string, sizeMb: number, blocks: number, type: 'file' | 'dir' = 'file'): HdfsEntry => ({ path: `/x/${name}`, name, type, sizeMb, blocks, owner: 'root', group: 'supergroup', permission: 'rw-r--r--', modifiedAt: 0 });
    expect(medir([e('000000_0', 0.6, 1), e('000001_0', 0.5, 1), e('_SUCCESS', 0, 0), e('.hive-staging', 0, 0, 'dir')])).toEqual({ mb: 1.1, archivos: 2, bloques: 2 });
    expect(medir([])).toEqual({ mb: 0, archivos: 0, bloques: 0 });
  });
  it('encuentra las tablas que ya existen', () => {
    const t = (name: string): CatalogEntry => ({ source: 'hive', name, kind: 'externa', columns: COLS });
    const r = existentes([t('default.ventas'), t('default.ventas_orc'), { ...t('default.ventas_parquet'), source: 'mysql' }]);
    expect(Object.keys(r)).toEqual(['csv', 'orc']);
  });
});
