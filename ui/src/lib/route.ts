/* Rutas por hash: #pantalla o #pantalla/lo-que-sigue (carpeta de HDFS, id de trabajo, práctica…). */
export const PAGES = ['inicio', 'practicas', 'cluster', 'hdfs', 'yarn', 'pipeline', 'datos', 'ml', 'aula', 'consola', 'config'] as const;
export type PageId = typeof PAGES[number];

/** #hdfs/user/root → ['hdfs', 'user/root']. Lo que no es una pantalla conocida va a Inicio */
export function parseHash(hash: string): [PageId, string] {
  let h = hash.replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch { /* % suelto: se usa tal cual */ }
  const i = h.indexOf('/');
  const id = (i < 0 ? h : h.slice(0, i)) as PageId;
  return PAGES.includes(id) ? [id, i < 0 ? '' : h.slice(i + 1)] : ['inicio', ''];
}

/** El hash de una pantalla con su sufijo: ('hdfs', 'user/root/con espacio') → '#hdfs/user/root/con%20espacio'.
    Cada tramo se codifica aparte para que las barras sigan separando carpetas */
export function routeHash(p: PageId, arg = ''): string {
  const a = arg.replace(/^\/+|\/+$/g, '');
  return a ? `#${p}/${a.split('/').map(encodeURIComponent).join('/')}` : `#${p}`;
}

/** Los tramos del sufijo: 'user/root/' → ['user', 'root'] */
export const routeParts = (arg: string): string[] => arg.split('/').filter(Boolean);
