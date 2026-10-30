/* Rutas por hash: #pantalla o #pantalla/lo-que-sigue (carpeta de HDFS, id de trabajo, práctica…). */
export const PAGES = ['inicio', 'practicas', 'cluster', 'hdfs', 'tablas', 'bases', 'yarn', 'pipeline', 'lenguajes', 'comparar', 'ml', 'aula', 'consola', 'config'] as const;
export type PageId = typeof PAGES[number];

/** Rutas viejas que siguen andando (guías, prácticas, marcadores). Consultas (#datos) se partió:
    Hive y Pig quedaron en Lenguajes, MariaDB y MongoDB en Bases */
const VIEJAS: Record<string, (arg: string) => [PageId, string]> = {
  datos: a => (/^(mysql|mariadb|mongodb)(\/|$)/.test(a) ? ['bases', a.replace(/^mysql/, 'mariadb')] : ['lenguajes', a]),
};

/** #hdfs/user/root → ['hdfs', 'user/root']. Lo que no es una pantalla conocida va a Inicio */
export function parseHash(hash: string): [PageId, string] {
  let h = hash.replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch { /* % suelto: se usa tal cual */ }
  const i = h.indexOf('/');
  const id = (i < 0 ? h : h.slice(0, i)) as PageId;
  const arg = i < 0 ? '' : h.slice(i + 1);
  if (Object.hasOwn(VIEJAS, id)) return VIEJAS[id](arg);
  return PAGES.includes(id) ? [id, arg] : ['inicio', ''];
}

/** Si el hash es de una ruta vieja, el nuevo (para dejarlo en la barra de direcciones); si no, null */
export function hashNuevo(hash: string): string | null {
  const id = hash.replace(/^#/, '').split('/')[0];
  return Object.hasOwn(VIEJAS, id) ? routeHash(...parseHash(hash)) : null;
}

/** El hash de una pantalla con su sufijo: ('hdfs', 'user/root/con espacio') → '#hdfs/user/root/con%20espacio'.
    Cada tramo se codifica aparte para que las barras sigan separando carpetas */
export function routeHash(p: PageId, arg = ''): string {
  const a = arg.replace(/^\/+|\/+$/g, '');
  return a ? `#${p}/${a.split('/').map(encodeURIComponent).join('/')}` : `#${p}`;
}

/** Los tramos del sufijo: 'user/root/' → ['user', 'root'] */
export const routeParts = (arg: string): string[] => arg.split('/').filter(Boolean);
