/* Animación FLIP para los bloques del rack: lo que ya estaba se desliza a su lugar nuevo,
   lo nuevo vuela desde otra copia del mismo bloque y lo que se va se desvanece. */
import { useLayoutEffect, useRef, type RefObject } from 'react';

interface Prev { x: number; y: number; w: number; h: number; b: string; html: string }
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useFlip(root: RefObject<HTMLElement | null>, dep: unknown) {
  const prev = useRef<Map<string, Prev>>(new Map());
  useLayoutEffect(() => {
    const el = root.current; if (!el) return;
    const base = el.getBoundingClientRect();
    const next = new Map<string, Prev>();
    const prevByBlock = new Map<string, Prev>();
    prev.current.forEach(p => { if (!prevByBlock.has(p.b)) prevByBlock.set(p.b, p); });
    const first = prev.current.size === 0;
    el.querySelectorAll<HTMLElement>('[data-flip]').forEach(n => {
      const r = n.getBoundingClientRect();
      const cur: Prev = { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height, b: n.dataset.b || '', html: n.outerHTML };
      next.set(n.dataset.flip!, cur);
      if (first || reduced()) return;
      const p = prev.current.get(n.dataset.flip!);
      if (p) {
        const dx = p.x - cur.x, dy = p.y - cur.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.3,.7,.2,1)' });
        return;
      }
      const src = prevByBlock.get(cur.b);
      if (src) {
        const dx = src.x - cur.x, dy = src.y - cur.y, far = Math.hypot(dx, dy) > 40;
        n.animate([
          { transform: `translate(${dx}px, ${dy}px) scale(${far ? 1.12 : 1})`, boxShadow: '0 0 0 2px rgba(237,237,237,.7)' },
          { transform: `translate(${dx / 2}px, ${dy / 2 - (far ? 14 : 0)}px) scale(${far ? 1.12 : 1})`, boxShadow: '0 0 0 2px rgba(237,237,237,.7)', offset: .5 },
          { transform: 'none', boxShadow: '0 0 0 0 rgba(237,237,237,0)' },
        ], { duration: far ? 700 : 380, easing: 'cubic-bezier(.35,.6,.2,1)' });
      } else n.animate([{ transform: 'scale(.4)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: 'ease-out' });
    });
    if (!first && !reduced()) prev.current.forEach((p, k) => {
      if (next.has(k)) return;
      const g = document.createElement('div');
      g.innerHTML = p.html;
      const c = g.firstElementChild as HTMLElement | null; if (!c) return;
      c.removeAttribute('data-flip');
      Object.assign(c.style, { position: 'fixed', left: `${base.left + p.x}px`, top: `${base.top + p.y}px`, width: `${p.w}px`, height: `${p.h}px`, margin: '0', zIndex: '30', pointerEvents: 'none' });
      document.body.appendChild(c);
      c.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.3)' }], { duration: 420, easing: 'ease-in' }).onfinish = () => c.remove();
    });
    prev.current = next;
  }, [dep]); // eslint-disable-line react-hooks/exhaustive-deps
}
