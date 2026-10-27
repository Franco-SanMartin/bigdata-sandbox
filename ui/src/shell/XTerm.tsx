/* xterm.js pegado a la sesión de la terminal (lib/terminal.ts). Va en su propio archivo: xterm pesa y
   solo baja cuando se abre el panel. */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { terminal } from '../lib/terminal';

/** Colores del tema (tokens.css): fondo casi negro, texto gris claro y la paleta ANSI apagada */
const THEME = {
  background: '#0E0E0E', foreground: '#EDEDED', cursor: '#CFCFCF', cursorAccent: '#0E0E0E',
  selectionBackground: 'rgba(237, 237, 237, .25)',
  black: '#181818', red: '#E5534B', green: '#4CB782', yellow: '#D9A43F', blue: '#6E9FD8', magenta: '#B07CC6', cyan: '#5DB3B3', white: '#B8B8B8',
  brightBlack: '#7A7A7A', brightRed: '#F2867F', brightGreen: '#74CFA1', brightYellow: '#E8BC66', brightBlue: '#94B8E4', brightMagenta: '#C9A0DA', brightCyan: '#86CACA', brightWhite: '#EDEDED',
};

export default function XTerm({ visible }: { visible: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const t = new Terminal({
      theme: THEME, fontFamily: '"IBM Plex Mono", ui-monospace, monospace', fontSize: 13, lineHeight: 1.2,
      cursorBlink: true, scrollback: 5000, convertEol: false, allowProposedApi: false,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(box.current!);
    termRef.current = t; fitRef.current = fit;
    // Ctrl+Shift+C / Ctrl+Shift+V como en las terminales de Linux; Ctrl+C sigue cortando el comando
    t.attachCustomKeyEventHandler(e => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyC') { void navigator.clipboard?.writeText(t.getSelection()); return false; }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.code === 'KeyV') { void navigator.clipboard?.readText().then(x => terminal.input(x)); return false; }
      return true;
    });
    // Lo que llegó antes de que se montara el panel (o mientras estuvo cerrado de una visita anterior)
    const prev = terminal.backlog();
    if (prev) t.write(prev);
    const offData = terminal.onData(d => t.write(d));
    const inp = t.onData(d => terminal.input(d));
    const rs = t.onResize(({ cols, rows }) => terminal.resize(cols, rows));
    const offState = terminal.onState(() => {
      if (terminal.state === 'closed') t.write(`\r\n\x1b[90m[${terminal.reason || 'Terminal cerrada'}]\x1b[0m\r\n`);
    });
    try { fit.fit(); } catch { /* sin tamaño todavía */ }
    if (terminal.state === 'off' || terminal.state === 'closed') terminal.connect(t.cols, t.rows);
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* oculto */ } });
    ro.observe(box.current!);
    return () => { ro.disconnect(); offData(); offState(); inp.dispose(); rs.dispose(); t.dispose(); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => { try { fitRef.current?.fit(); } catch { /* */ } termRef.current?.focus(); });
    return () => cancelAnimationFrame(id);
  }, [visible]);

  return <div ref={box} className="term-x" data-term />;
}
