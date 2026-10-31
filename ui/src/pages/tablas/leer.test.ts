import { describe, expect, it } from 'vitest';
import { pigLoad, pigTipo, separador } from './leer';

const COLS = [{ name: 'fecha', type: 'string' }, { name: 'sucursal', type: 'STRING' }, { name: 'cantidad', type: 'int' }, { name: 'precio', type: 'decimal(10,2)' }];
const DDL = "CREATE EXTERNAL TABLE `default`.`ventas`(\n  `fecha` string)\nROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe'\nWITH SERDEPROPERTIES (\n  'field.delim'=';')\nTBLPROPERTIES (\n  'skip.header.line.count'='1')";

describe('leer una tabla con Pig', () => {
  it('traduce los tipos de Hive', () => {
    expect(pigTipo('STRING')).toBe('chararray');
    expect(pigTipo('bigint')).toBe('long');
    expect(pigTipo('decimal(10,2)')).toBe('double');
    expect(pigTipo('array<string>')).toBe('chararray');
  });
  it('saca el separador del CREATE TABLE', () => {
    expect(separador("ROW FORMAT DELIMITED FIELDS TERMINATED BY '\\t'")).toBe('\\t');
    expect(separador(DDL)).toBe(';');
    expect(separador()).toBe(',');
  });
  it('carpeta, separador, esquema y el encabezado salteado a mano', () => {
    const s = pigLoad('default.ventas', '/user/root/ventas', COLS, DDL);
    expect(s).toContain("ventas = LOAD '/user/root/ventas' USING PigStorage(';')");
    expect(s).toContain('AS (fecha:chararray, sucursal:chararray, cantidad:int, precio:double);');
    expect(s).toContain("filas = FILTER ventas BY fecha != 'fecha';");
    expect(s.trim().split('\n').slice(-2)).toEqual(['primeras = LIMIT filas 10;', 'DUMP primeras;']);
  });
  it('sin encabezado no filtra', () => {
    const s = pigLoad('default.ventas_limpias', '/user/root/ml/ventas_limpias', COLS);
    expect(s).not.toContain('FILTER');
    expect(s).toContain('primeras = LIMIT ventas_limpias 10;');
  });
});
