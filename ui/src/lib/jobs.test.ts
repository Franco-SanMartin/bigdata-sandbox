import { describe, expect, it } from 'vitest';
import { TEMPLATES, cleanPath, fillCommand, formErrors, initialValues, paramError, quote, toParams } from './jobs';

const tpl = (id: string) => TEMPLATES.find(t => t.id === id)!;

describe('plantillas de trabajos', () => {
  it('normaliza rutas como hdfs.clean', () => {
    expect(cleanPath('user//root/./x/')).toBe('/user/root/x');
    expect(cleanPath('/user/root/../../etc')).toBe('/etc');
    expect(cleanPath('hdfs://localhost:9000/user/root')).toBe('/user/root');
    expect(cleanPath('  ')).toBe('/');
  });

  it('arma el comando con los valores puestos', () => {
    const t = tpl('mr-wordcount');
    expect(fillCommand(t, initialValues(t))).toBe('hadoop jar hadoop-mapreduce-examples-3.3.6.jar wordcount /user/root/texto.txt /user/root/resultados/wordcount');
    expect(fillCommand(t, { in: '/user/root//ventas/', out: '/tmp/wc' })).toContain('wordcount /user/root/ventas /tmp/wc');
    expect(fillCommand(tpl('mr-pi'), { maps: ' 8 ', samples: '' })).toBe('hadoop jar hadoop-mapreduce-examples-3.3.6.jar pi 8 1000');
  });

  it('pone comillas como shlex.quote', () => {
    expect(quote('[a-z]')).toBe("'[a-z]'");
    expect(quote('dato')).toBe('dato');
    expect(quote("it's")).toBe(`'it'"'"'s'`);
    expect(fillCommand(tpl('mr-grep'), { regex: 'big data' })).toMatch(/grep \S+ \S+ 'big data'$/);
  });

  it('los valores por defecto de todas las plantillas son válidos', () => {
    for (const t of TEMPLATES) expect(formErrors(t, initialValues(t)), t.id).toEqual({});
  });

  it('valida enteros con su rango', () => {
    const maps = tpl('mr-pi').params[0];
    expect(paramError(maps, 4)).toBeNull();
    expect(paramError(maps, '16')).toBeNull();
    expect(paramError(maps, 0)).toMatch(/de 1 a 16/);
    expect(paramError(maps, 17)).toMatch(/de 1 a 16/);
    expect(paramError(maps, '2.5')).toMatch(/entero/);
    expect(paramError(maps, '4; rm -rf /')).toMatch(/entero/);
  });

  it('valida la expresión regular del grep', () => {
    const rx = tpl('mr-grep').params.find(x => x.name === 'regex')!;
    for (const ok of ['[a-z]', 'datos', '[A-Z][a-z]', 'big data', 'a.b', '\\d', 'año']) expect(paramError(rx, ok), ok).toBeNull();
    for (const bad of ['[a-z]+', '$(id)', '`id`', 'a;b', 'a|b', '-x', 'a'.repeat(65), 'a\nb', "'"]) expect(paramError(rx, bad), bad).not.toBeNull();
  });

  it('la salida va en una carpeta nueva bajo /user o /tmp, sin pisar la entrada', () => {
    const t = tpl('mr-wordcount');
    expect(formErrors(t, initialValues(t))).toEqual({});
    expect(formErrors(t, { in: '/user/root/texto.txt', out: '/user/root' }).out).toMatch(/carpeta nueva/);
    expect(formErrors(t, { in: '/user/root/texto.txt', out: '/etc/x' }).out).toMatch(/carpeta nueva/);
    expect(formErrors(t, { in: '/user/root/a', out: '/user/root/a/b' }).out).toMatch(/entrada/);
    expect(formErrors(t, { in: '/user/root/a', out: '/user/root/a' }).out).toMatch(/entrada/);
    expect(formErrors(t, { in: 'a:b', out: '/tmp/x' }).in).toMatch(/inválida/);
  });

  it('manda los enteros como número y las rutas normalizadas', () => {
    expect(toParams(tpl('mr-pi'), { maps: '6', samples: 200 })).toEqual({ maps: 6, samples: 200 });
    expect(toParams(tpl('mr-wordcount'), { in: 'user/root/texto.txt', out: '/tmp//wc/', overwrite: false })).toEqual({ in: '/user/root/texto.txt', out: '/tmp/wc', overwrite: false });
  });

  it('las plantillas sin parámetros muestran su comando tal cual', () => {
    for (const id of ['mr-ventas', 'hive-ventas', 'spark-ventas']) expect(fillCommand(tpl(id), {})).toBe(tpl(id).command);
  });
});
