/* Atajos de teclado globales */
import { useEffect } from 'react';
import { consoleOpen, helpOpen, navigate, paletteOpen, terminalOpen } from '../state/ui';
import { NAV } from './nav';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function useHotkeys() {
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.ctrlKey && (e.code === 'Backquote' || e.key === '`')) { e.preventDefault(); terminalOpen.set(v => !v); return; }
      // Adentro de la terminal las teclas son de bash (Ctrl+K borra, Ctrl+J es Enter)
      if (e.target instanceof Element && e.target.closest('[data-term]')) return;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.set(v => !v); return; }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); consoleOpen.set(v => !v); return; }
      if (mod || e.altKey || typing(e.target) || paletteOpen.get()) return;
      if (e.key === '?') { e.preventDefault(); helpOpen.set(v => !v); return; }
      if (e.key.toLowerCase() === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 1200) {
        const n = NAV.find(x => x.key === e.key.toLowerCase());
        if (n) { e.preventDefault(); navigate(n.id); g = 0; }
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
