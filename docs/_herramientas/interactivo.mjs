// Arma el HTML interactivo de una version a partir de su .json:
//
//   node docs/_herramientas/interactivo.mjs docs/base/interactivo.json
//
// Escribe docs/base/interactivo.html: plantilla-interactivo.html + los datos + las fuentes
// incrustadas. Un solo archivo, sin red: se abre con doble clic en la compu del laboratorio.
// Antes de escribir revisa el .json (ids repetidos, conexiones a componentes que no existen,
// links a archivos que no estan) y corta con error si algo no cierra.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, '../..');
const FUENTES = [
  ['IBM Plex Sans', 400, 'ibm-plex-sans-latin-400-normal.woff2'],
  ['IBM Plex Sans', 500, 'ibm-plex-sans-latin-500-normal.woff2'],
  ['IBM Plex Sans', 600, 'ibm-plex-sans-latin-600-normal.woff2'],
  ['IBM Plex Mono', 400, 'ibm-plex-mono-latin-400-normal.woff2'],
  ['IBM Plex Mono', 600, 'ibm-plex-mono-latin-600-normal.woff2'],
];

export function revisar(d, dir) {
  const e = [];
  const req = (o, campos, donde) => campos.forEach((c) => { if (o[c] == null || o[c] === '') e.push(`${donde}: falta "${c}"`); });
  req(d, ['tag', 'titulo', 'capas', 'componentes', 'conexiones'], 'raíz');
  const capas = new Set((d.capas || []).map((k) => k.id));
  const ids = new Set();
  for (const [i, c] of (d.componentes || []).entries()) {
    req(c, ['id', 'nombre', 'capa', 'que'], `componentes[${i}]`);
    if (ids.has(c.id)) e.push(`componente repetido: ${c.id}`);
    ids.add(c.id);
    if (!capas.has(c.capa)) e.push(`${c.id}: la capa "${c.capa}" no está en "capas"`);
    for (const p of c.puertos || []) if (typeof p.n !== 'number') e.push(`${c.id}: puerto sin número (${JSON.stringify(p)})`);
  }
  const existe = (id, donde) => { if (!ids.has(id)) e.push(`${donde}: no existe el componente "${id}"`); };
  for (const [i, cx] of (d.conexiones || []).entries()) { existe(cx.de, `conexiones[${i}].de`); existe(cx.a, `conexiones[${i}].a`); }
  for (const r of d.recorridos || []) for (const [i, p] of r.pasos.entries()) (p.nodos || []).forEach((n) => existe(n, `recorrido ${r.id} paso ${i + 1}`));
  for (const [i, p] of (d.uso || []).entries()) (p.nodos || []).forEach((n) => existe(n, `uso[${i}]`));
  const links = [];
  const juntar = (g) => { if (g) links.push(typeof g === 'string' ? g : g.archivo); };
  (d.componentes || []).forEach((c) => juntar(c.guia));
  (d.uso || []).forEach((p) => juntar(p.guia));
  if (d.guia) links.push(d.guia.pdf, d.guia.md);
  if (d.readme) links.push(d.readme.pdf, d.readme.md);
  for (const l of links.filter(Boolean)) {
    if (/^[a-z]+:/i.test(l)) continue;
    const [camino] = l.split('#');
    if (camino && !existsSync(join(dir, camino)) && !camino.endsWith('.pdf')) e.push(`link roto: ${l}`);
  }
  return e;
}

function main() {
  const entrada = process.argv[2];
  if (!entrada || !entrada.endsWith('.json')) {
    console.error('Uso: node docs/_herramientas/interactivo.mjs docs/<version>/interactivo.json');
    process.exit(2);
  }
  const ruta = resolve(entrada);
  const datos = JSON.parse(readFileSync(ruta, 'utf8'));
  const errores = revisar(datos, dirname(ruta));
  if (errores.length) {
    console.error(`El .json tiene errores:\n  ${errores.join('\n  ')}`);
    process.exit(1);
  }
  const fuentes = FUENTES.map(([familia, peso, archivo]) => {
    const b64 = readFileSync(join(AQUI, 'fuentes', archivo)).toString('base64');
    return `@font-face { font-family: "${familia}"; font-weight: ${peso}; font-display: swap; src: url(data:font/woff2;base64,${b64}) format("woff2"); }`;
  }).join('\n');
  let hash = 'sin git';
  try { hash = execFileSync('git', ['-C', REPO, 'log', '-1', '--format=%h'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* sin git */ }
  const fuente = relative(REPO, ruta).split(sep).join('/');
  const json = JSON.stringify(datos).replace(/</g, '\\u003c');
  const html = readFileSync(join(AQUI, 'plantilla-interactivo.html'), 'utf8')
    .replace('__FUENTES__', () => fuentes)
    .replace('__TITULO__', () => datos.titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;'))
    .replaceAll('__FUENTE__', () => fuente)
    .replace('__COMMIT__', () => hash)
    .replace('__DATOS__', () => json);
  const salida = ruta.replace(/\.json$/, '.html');
  writeFileSync(salida, html);
  console.log(`${relative(REPO, salida)}  (${Math.round(html.length / 1024)} KB, ${datos.componentes.length} componentes, ${datos.conexiones.length} conexiones)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
