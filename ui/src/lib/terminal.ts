/* La conexión con la terminal del contenedor (/api/terminal, websocket): una sola sesión para toda la
   interfaz, así el panel y las Prácticas escriben en el mismo bash. No sabe nada de xterm: el panel se
   suscribe a la salida y le pasa lo que se tipea.

   Cada vez que bash vuelve al prompt manda una marca invisible con el código de salida (ver
   server/sandbox_server/terminal.bashrc): con eso "Correr en la terminal" de una práctica sabe cuándo
   terminó el comando, qué imprimió y cómo salió. */

export type TermState = 'off' | 'connecting' | 'open' | 'closed';

/** Cuánto se guarda para repintar el panel */
const LOG_MAX = 256 * 1024;

/** Marca del prompt: ESC ] 777 ; bds ; <código> BEL */
const MARK = /\x1b\]777;bds;(\d+)\x07/g;

/** Saca los colores y movimientos de cursor: lo que queda es el texto como se lee en la terminal */
export function plainText(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '') // OSC (título de la ventana, marcas)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '') // CSI (colores, cursor)
    .replace(/\x1b[()][0-9A-Za-z]|\x1b[=>78]/g, '')
    .replace(/\r+\n/g, '\n')
    .split('\n')
    .map(l => (l.includes('\r') ? l.slice(l.lastIndexOf('\r') + 1) : l)) // lo que se reescribió en la misma línea
    .join('\n')
    .replace(/[^\n\t\x20-\x7e -￿]/g, '');
}

/** Lo que imprimió un comando entre que se mandó y volvió el prompt: sin el eco de la línea tipeada
    ni el prompt siguiente */
export function commandOutput(raw: string, command: string): string[] {
  const lines = plainText(raw).split('\n');
  // La primera línea es el eco de lo tipeado (puede venir partida en varias si es largo o multilínea)
  const first = command.split('\n')[0].trim();
  const echo = lines.findIndex(l => first && l.includes(first.slice(0, 40)));
  let out = echo >= 0 ? lines.slice(echo + 1) : lines;
  // multilínea: bash repite cada línea con el prompt secundario "> "
  const rest = command.split('\n').slice(1);
  let skip = 0;
  while (skip < out.length && skip < rest.length && out[skip].startsWith('> ')) skip++;
  out = out.slice(skip);
  // La marca sale antes del prompt (PROMPT_COMMAND): lo que queda es solo lo que imprimió el comando
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

export interface RunResult { lines: string[]; exitCode: number }

type Listener = (data: string) => void;

export class TermSession {
  state: TermState = 'off';
  /** Por qué se cerró (lo que mandó el servidor) */
  reason = '';
  private ws: WebSocket | null = null;
  private out = new Set<Listener>();
  private st = new Set<() => void>();
  private size = { cols: 100, rows: 30 };
  /** Lo que se mandó y espera el próximo prompt */
  private waiting: { buf: string; command: string; resolve: (r: RunResult) => void; reject: (e: Error) => void } | null = null;
  /** Lo que quedó sin una marca completa (llegó partida en dos mensajes) */
  private tail = '';
  private ready = false;
  private readyWait: (() => void)[] = [];
  /** Lo último que mandó bash: el panel lo repinta al montarse (un "Correr en la terminal" lo pudo abrir
      cuando la salida ya estaba llegando) */
  private log = '';

  constructor(private url: () => string = defaultUrl, private make: (u: string) => WebSocket = u => new WebSocket(u)) {}

  onData(f: Listener) { this.out.add(f); return () => { this.out.delete(f); }; }
  onState(f: () => void) { this.st.add(f); return () => { this.st.delete(f); }; }
  private set(s: TermState, reason = '') { this.state = s; this.reason = reason; this.st.forEach(f => f()); }

  connect(cols = this.size.cols, rows = this.size.rows) {
    if (this.ws && (this.state === 'open' || this.state === 'connecting')) return;
    this.size = { cols, rows };
    this.ready = false;
    this.tail = '';
    this.log = '';
    this.set('connecting');
    let ws: WebSocket;
    try {
      ws = this.make(`${this.url()}?cols=${cols}&rows=${rows}`);
    } catch (e) {
      this.set('closed', e instanceof Error ? e.message : String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => { if (this.ws === ws) this.set('open'); };
    ws.onmessage = ev => { if (this.ws === ws) this.receive(String(ev.data)); };
    ws.onclose = ev => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      this.waiting?.reject(new Error(ev.reason || 'Se cerró la terminal'));
      this.waiting = null;
      this.set('closed', ev.reason || (ev.code === 1006 ? 'No se pudo conectar con el contenedor' : ''));
    };
  }

  close() { const ws = this.ws; this.ws = null; ws?.close(); this.ready = false; this.set('closed', ''); }

  private receive(data: string) {
    // La marca puede llegar partida: se guarda la cola desde un ESC sin cerrar
    let s = this.tail + data;
    this.tail = '';
    const cut = s.lastIndexOf('\x1b]777;');
    if (cut >= 0 && s.indexOf('\x07', cut) < 0) { this.tail = s.slice(cut); s = s.slice(0, cut); }
    let last = 0;
    for (const m of s.matchAll(MARK)) {
      const before = s.slice(last, m.index);
      this.emit(before);
      if (this.waiting) {
        const w = this.waiting; this.waiting = null;
        w.buf += before;
        w.resolve({ lines: commandOutput(w.buf, w.command), exitCode: Number(m[1]) });
      }
      if (!this.ready) { this.ready = true; this.readyWait.splice(0).forEach(f => f()); }
      last = m.index! + m[0].length;
    }
    const rest = s.slice(last);
    this.emit(rest);
    if (this.waiting) this.waiting.buf += rest;
  }

  private emit(s: string) {
    if (!s) return;
    this.log = (this.log + s).slice(-LOG_MAX);
    this.out.forEach(f => f(s));
  }

  /** Lo último que se vio en la terminal, tal cual (con colores) */
  backlog() { return this.log; }

  /** Lo que se tipea (tal cual, con \r para Enter) */
  input(d: string) { this.send({ t: 'i', d }); }
  resize(cols: number, rows: number) { this.size = { cols, rows }; this.send({ t: 'r', c: cols, r: rows }); }
  private send(m: object) { if (this.ws && this.state === 'open') this.ws.send(JSON.stringify(m)); }

  /** Escribe el comando como si lo tipeara el alumno y espera a que vuelva el prompt */
  run(command: string, timeoutMs = 10 * 60_000): Promise<RunResult> {
    if (this.waiting) return Promise.reject(new Error('La terminal todavía está corriendo el comando anterior'));
    return new Promise<RunResult>((resolve, reject) => {
      const go = () => {
        if (this.state !== 'open') { reject(new Error(this.reason || 'La terminal no está conectada')); return; }
        const t = setTimeout(() => { if (this.waiting?.command === command) { this.waiting = null; reject(new Error('El comando sigue corriendo: mirá la terminal')); } }, timeoutMs);
        this.waiting = {
          buf: '', command,
          resolve: r => { clearTimeout(t); resolve(r); },
          reject: e => { clearTimeout(t); reject(e); },
        };
        // Ctrl+U borra lo que hubiera a medio tipear en el prompt
        this.input('\x15' + command.replace(/\n/g, '\r') + '\r');
      };
      if (this.ready) go();
      else {
        if (this.state === 'off' || this.state === 'closed') this.connect();
        const t = setTimeout(() => reject(new Error(this.reason || 'La terminal no respondió')), 15_000);
        this.readyWait.push(() => { clearTimeout(t); go(); });
      }
    });
  }

  get busy() { return !!this.waiting; }
}

function defaultUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${location.pathname.replace(/[^/]*$/, '')}api/terminal`;
}

/** La sesión de toda la interfaz */
export const terminal = new TermSession();
