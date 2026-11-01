import { describe, expect, it } from 'vitest';
import { hashNuevo, parseHash, routeHash, routeParts } from './route';

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

describe('rutas viejas', () => {
  it('#datos (Consultas) va a Lenguajes, o a Bases si es MariaDB o MongoDB', () => {
    expect(parseHash('#datos')).toEqual(['lenguajes', '']);
    expect(parseHash('#datos/pig')).toEqual(['lenguajes', 'pig']);
    expect(parseHash('#datos/mysql')).toEqual(['bases', 'mariadb']);
    expect(parseHash('#datos/mariadb')).toEqual(['bases', 'mariadb']);
    expect(parseHash('#datos/mongodb')).toEqual(['bases', 'mongodb']);
  });
  it('hashNuevo solo reemplaza las viejas', () => {
    expect(hashNuevo('#datos')).toBe('#lenguajes');
    expect(hashNuevo('#datos/mysql')).toBe('#bases/mariadb');
    expect(hashNuevo('#lenguajes/hive')).toBeNull();
    expect(hashNuevo('')).toBeNull();
    expect(hashNuevo('#constructor')).toBeNull();
  });
});

describe('routeHash y routeParts', () => {
  it('arma el hash codificando cada tramo', () => {
    expect(routeHash('inicio')).toBe('#inicio');
    expect(routeHash('cluster', 'dn2')).toBe('#cluster/dn2');
    expect(routeHash('hdfs', '/user/root/con espacio/')).toBe('#hdfs/user/root/con%20espacio');
    expect(routeHash('consola', 'a#1?x')).toBe('#consola/a%231%3Fx');
  });
  it('ida y vuelta: lo que arma routeHash lo lee parseHash igual', () => {
    for (const [p, a] of [['hdfs', 'user/root/ñandú 2024'], ['yarn', 'application_1_0002'], ['consola', '']] as const)
      expect(parseHash(routeHash(p, a))).toEqual([p, a]);
  });
  it('separa los tramos sin vacíos', () => {
    expect(routeParts('')).toEqual([]);
    expect(routeParts('user//root/')).toEqual(['user', 'root']);
  });
});
