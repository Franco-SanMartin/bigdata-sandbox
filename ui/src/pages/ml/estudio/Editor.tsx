/* Editor de Python con CodeMirror 6: resaltado, números de línea, buscar (Ctrl+F), deshacer, cerrar
   paréntesis y sangría con Tab. Tema oscuro con los tokens del sistema. Se carga aparte (lazy): solo
   lo baja quien abre el paso Código o el código de un experimento. */
import { useEffect, useRef } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';

const tema = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--n-1)', fontSize: '12.5px', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--f-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--text)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--n-1)', color: 'var(--text-4)', border: 'none', borderRight: '1px solid var(--line-soft)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--surface-2)', color: 'var(--text-2)' },
  '.cm-activeLine': { backgroundColor: 'rgba(237, 237, 237, .035)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(57, 135, 229, .28)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--surface-3)', outline: '1px solid var(--line-strong)' },
  '.cm-searchMatch': { backgroundColor: 'var(--run-bg)', outline: '1px solid var(--run-line)' },
  '.cm-panels': { backgroundColor: 'var(--surface-2)', color: 'var(--text)', borderTop: '1px solid var(--line)' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'var(--f-sans)', fontSize: '12px' },
  '.cm-foldGutter span': { color: 'var(--text-4)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', border: '1px solid var(--line)' },
}, { dark: false });

/* Resaltado en grises, como el resto de la interfaz: el peso y la itálica separan lo que el color no */
const resaltado = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword], color: '#141414', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#525251' },
  { tag: [t.number, t.bool, t.null], color: '#333332' },
  { tag: [t.comment, t.lineComment], color: '#8E8E8D', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#141414' },
  { tag: [t.className, t.definition(t.className)], color: '#141414', fontWeight: '600' },
  { tag: [t.definition(t.variableName)], color: '#141414' },
  { tag: [t.propertyName], color: '#333332' },
  { tag: [t.self], color: '#525251', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#8E8E8D' },
]);

export default function Editor({ value, onChange, readOnly, alto = 560, label, onRun }: {
  value: string; onChange?: (v: string) => void; readOnly?: boolean; alto?: number | string; label: string; onRun?: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cambios = useRef(onChange);
  cambios.current = onChange;
  const correr = useRef(onRun);
  correr.current = onRun;

  useEffect(() => {
    const ext: Extension[] = [
      lineNumbers(), foldGutter(), highlightSpecialChars(), history(), drawSelection(), indentOnInput(),
      bracketMatching(), closeBrackets(), highlightActiveLine(), highlightActiveLineGutter(), highlightSelectionMatches(),
      search({ top: true }), python(), tema, syntaxHighlighting(resaltado),
      keymap.of([
        { key: 'Mod-Enter', run: () => { correr.current?.(); return true; } },
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
      ]),
      EditorView.updateListener.of(u => { if (u.docChanged) cambios.current?.(u.state.doc.toString()); }),
      EditorView.contentAttributes.of({ 'aria-label': label }),
      EditorState.readOnly.of(!!readOnly),
      EditorView.editable.of(!readOnly),
    ];
    const v = new EditorView({ parent: host.current!, state: EditorState.create({ doc: value, extensions: ext }) });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // El editor se arma una vez; los cambios de value de afuera se aplican abajo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, label]);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="es-editor" ref={host} style={{ height: alto }} />;
}
