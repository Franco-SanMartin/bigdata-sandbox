/* Cómo leer una tabla de Hive sin el Metastore: Pig no ve el nombre ni las propiedades de la tabla, así que
   hay que darle la carpeta, el separador, el esquema y saltear el encabezado a mano. */

const PIG_TIPO: Record<string, string> = {
  string: 'chararray', varchar: 'chararray', char: 'chararray', date: 'chararray', timestamp: 'chararray',
  tinyint: 'int', smallint: 'int', int: 'int', integer: 'int', bigint: 'long', float: 'float', double: 'double', boolean: 'boolean',
};
/** STRING → chararray, BIGINT → long, DECIMAL(10,2) → double… lo que no conoce queda como texto */
export const pigTipo = (hive: string) => {
  const t = hive.toLowerCase().replace(/\(.*$/, '').trim();
  return PIG_TIPO[t] ?? (t === 'decimal' ? 'double' : 'chararray');
};

/** El separador de campos que dice el CREATE TABLE (coma si no dice nada) */
export const separador = (ddl = '') =>
  /FIELDS TERMINATED BY '([^']+)'/i.exec(ddl)?.[1] ?? /'field\.delim'\s*=\s*'([^']+)'/.exec(ddl)?.[1] ?? ',';

/** El script de Pig que lee las primeras 10 filas de la carpeta de una tabla */
export function pigLoad(name: string, location: string, cols: { name: string; type: string }[], ddl = ''): string {
  const alias = name.replace(/^[^.]*\./, '').replace(/\W+/g, '_').replace(/^(\d)/, 't_$1');
  const lines = [
    `${alias} = LOAD '${location}' USING PigStorage('${separador(ddl)}')`,
    `       AS (${cols.map(c => `${c.name}:${pigTipo(c.type)}`).join(', ')});`,
  ];
  let ult = alias;
  if (/'skip\.header\.line\.count'\s*=\s*'[1-9]/.test(ddl) && cols.length) {
    const texto = cols.find(c => pigTipo(c.type) === 'chararray');
    lines.push('-- Hive se saltea el encabezado (skip.header.line.count); Pig no ve esa propiedad',
      texto ? `filas = FILTER ${alias} BY ${texto.name} != '${texto.name}';` : `filas = FILTER ${alias} BY ${cols[0].name} IS NOT NULL;`);
    ult = 'filas';
  }
  lines.push(`primeras = LIMIT ${ult} 10;`, 'DUMP primeras;');
  return lines.join('\n');
}
