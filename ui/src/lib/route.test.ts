import { describe, expect, it } from 'vitest';
import { parseHash } from './route';

describe('parseHash', () => {
  it('pantalla sola, con argumento y desconocida', () => {
    expect(parseHash('#hdfs')).toEqual(['hdfs', '']);
    expect(parseHash('#hdfs/user/root/ventas')).toEqual(['hdfs', 'user/root/ventas']);
    expect(parseHash('#practicas/hdfs-basico')).toEqual(['practicas', 'hdfs-basico']);
    expect(parseHash('')).toEqual(['inicio', '']);
    expect(parseHash('#nada')).toEqual(['inicio', '']);
  });
  it('decodifica y no se rompe con un % suelto', () => {
    expect(parseHash('#hdfs/user/root/con%20espacio')).toEqual(['hdfs', 'user/root/con espacio']);
    expect(parseHash('#hdfs/100%')).toEqual(['hdfs', '100%']);
  });
});
