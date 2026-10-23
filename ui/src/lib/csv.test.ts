import { describe, expect, it } from 'vitest';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('escapa comillas, comas y saltos de línea; null queda vacío', () => {
    expect(toCsv(['a', 'b'], [[1, 'x,y'], [null, 'dijo "hola"\nchau']]))
      .toBe('a,b\r\n1,"x,y"\r\n,"dijo ""hola""\nchau"\r\n');
  });
  it('sin filas deja solo el encabezado', () => {
    expect(toCsv(['id'], [])).toBe('id\r\n');
  });
});
