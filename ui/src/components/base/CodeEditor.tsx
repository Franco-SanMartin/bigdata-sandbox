/* Editor de consultas y scripts: números de línea, Tab con dos espacios, Ctrl+Enter para correr.
   Sin dependencias: un textarea con el gutter sincronizado. */
import { useRef, type ReactNode } from 'react';
import { Kbd } from '../ui';

export function CodeEditor({ value, onChange, onRun, onRunAlt, placeholder, label, rows = 8, foot, readOnly }: {
  value: string;
  onChange: (v: string) => void;
  /** Ctrl+Enter (o Cmd+Enter) */
  onRun?: () => void;
  /** Ctrl+Shift+Enter: la acción secundaria (p. ej. ver el plan) */
  onRunAlt?: () => void;
  placeholder?: string;
  label: string;
  rows?: number;
  /** Lo que va a la derecha del pie (motor, cliente equivalente…) */
  foot?: ReactNode;
  readOnly?: boolean;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = Math.max(rows, value.split('\n').length);
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      (e.shiftKey ? onRunAlt : onRun)?.();
      return;
    }
    if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !readOnly) {
      // Tab inserta dos espacios; Shift+Tab sale del editor (no queda atrapado el foco)
      if (e.shiftKey) return;
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = t;
      onChange(value.slice(0, a) + '  ' + value.slice(b));
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = a + 2; });
    }
  };
  return (
    <div className="ce">
      <div className="ce-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</div>
      <textarea value={value} onChange={e => onChange(e.target.value)} onKeyDown={onKey} rows={rows} spellCheck={false} autoCapitalize="off" autoComplete="off"
        aria-label={label} placeholder={placeholder} readOnly={readOnly}
        onScroll={e => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }} />
      <div className="ce-foot">
        {onRun && <span><Kbd k="Ctrl+Enter" /> correr</span>}
        {onRunAlt && <span><Kbd k="Ctrl+Shift+Enter" /> plan</span>}
        {!readOnly && <span><Kbd k="Tab" /> sangría</span>}
        {foot && <span className="end">{foot}</span>}
      </div>
    </div>
  );
}
