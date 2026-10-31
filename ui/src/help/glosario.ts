/* El glosario único (guias/glosario.md), leído en el build: la interfaz muestra el mismo texto que se lee
   en GitHub. Cada "##" es una capa, cada "###" un término y los párrafos de abajo su definición; una tabla
   va con su capa. */
import texto from '../../../guias/glosario.md?raw';
import type { CapaId } from '../lib/ecosistema';

export interface Termino { id: string; t: string; parrafos: string[] }
export interface SeccionGlosario { id: string; titulo: string; capa?: CapaId; intro: string[]; terminos: Termino[]; tabla?: string[][] }

/** El ancla que GitHub le pone a un título (la misma regla que pruebas/enlaces.py) */
export const ancla = (t: string) =>
  t.replace(/`/g, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\p{Mn} _-]/gu, '').replace(/ /g, '-');

/** La capa del mapa de Inicio que corresponde a cada sección, por cómo empieza su título */
const CAPA: [RegExp, CapaId][] = [
  [/^almacenamiento/i, 'datos'], [/^recursos/i, 'recursos'], [/^procesamiento: los motores/i, 'motores'],
  [/^procesamiento: los lenguajes/i, 'lenguajes'], [/^ingesta/i, 'puente'],
];

export function leerGlosario(md: string): SeccionGlosario[] {
  const out: SeccionGlosario[] = [];
  let sec: SeccionGlosario | undefined, term: Termino | undefined;
  let parrafo: string[] = [], comentario = false;
  const cerrar = () => {
    if (parrafo.length) (term ? term.parrafos : sec?.intro)?.push(parrafo.join(' '));
    parrafo = [];
  };
  for (const linea of md.replace(/\r\n/g, '\n').split('\n')) {
    const l = linea.trim();
    if (comentario) { comentario = !l.includes('-->'); continue; }
    if (l.startsWith('<!--')) { comentario = !l.includes('-->'); continue; }
    if (l.startsWith('## ')) {
      cerrar();
      term = undefined;
      const titulo = l.slice(3).trim();
      sec = { id: ancla(titulo), titulo, capa: CAPA.find(([rx]) => rx.test(titulo))?.[1], intro: [], terminos: [] };
      out.push(sec);
      continue;
    }
    // Lo de antes de la primera capa es la presentación del archivo
    if (!sec) continue;
    if (l.startsWith('### ')) {
      cerrar();
      term = { id: ancla(l.slice(4)), t: l.slice(4).trim(), parrafos: [] };
      sec.terminos.push(term);
      continue;
    }
    if (l.startsWith('|')) {
      cerrar();
      const celdas = l.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      if (!celdas.every(c => /^:?-+:?$/.test(c))) (sec.tabla ??= []).push(celdas);
      continue;
    }
    if (!l) { cerrar(); continue; }
    parrafo.push(l);
  }
  cerrar();
  return out;
}

export const GLOSARIO = leerGlosario(texto);
export const TERMINOS = new Map(GLOSARIO.flatMap(s => s.terminos.map(t => [t.id, { ...t, seccion: s }] as const)));

/** Las partes de una línea del glosario: negrita, cursiva, `código` y enlaces (de un enlace queda el texto) */
export type Pieza = { k: 'texto' | 'b' | 'i' | 'code'; s: string };
export function piezas(s: string): Pieza[] {
  return s.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/).filter(Boolean).map((p): Pieza =>
    p.startsWith('**') ? { k: 'b', s: p.slice(2, -2) }
      : p.startsWith('`') ? { k: 'code', s: p.slice(1, -1) }
        : p.startsWith('[') ? { k: 'texto', s: p.slice(1, p.indexOf('](')) }
          : p.startsWith('*') && p.length > 2 ? { k: 'i', s: p.slice(1, -1) }
            : { k: 'texto', s: p });
}
