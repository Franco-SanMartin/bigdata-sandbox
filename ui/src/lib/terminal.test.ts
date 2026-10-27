/* La sesión de la terminal: saca la salida de un comando de lo que manda bash (eco, colores, prompt)
   y sabe cuándo terminó por la marca del prompt. */
import { describe, expect, it } from 'vitest';
import { TermSession, commandOutput, plainText } from './terminal';

const mark = (code: number) => `\x1b]777;bds;${code}\x07`;
const PROMPT = '\x1b[?2004h\x1b[01;32mroot@bigdata\x1b[00m:\x1b[01;34m/datos\x1b[00m# ';

class FakeWs {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  send(s: string) { this.sent.push(s); }
  close() { this.onclose?.({ code: 1000, reason: '' }); }
  msg(s: string) { this.onmessage?.({ data: s }); }
}

function session() {
  const socks: FakeWs[] = [];
  const s = new TermSession(() => 'ws://x/api/terminal', () => { const w = new FakeWs(); socks.push(w); return w as unknown as WebSocket; });
  return { s, socks };
}

describe('plainText', () => {
  it('saca colores, títulos y lo que se reescribió en la línea', () => {
    expect(plainText(`\x1b]0;título\x07\x1b[1;31mrojo\x1b[0m normal\r\n`)).toBe('rojo normal\n');
    expect(plainText('10%\r50%\r100%\r\nlisto')).toBe('100%\nlisto');
  });
});

describe('commandOutput', () => {
  it('sin el eco del comando ni el bracketed paste', () => {
    const raw = 'hdfs dfs -ls /\r\n\x1b[?2004lFound 2 items\r\ndrwxr-xr-x   - root supergroup 0 /tmp\r\n';
    expect(commandOutput(raw, 'hdfs dfs -ls /')).toEqual(['Found 2 items', 'drwxr-xr-x   - root supergroup 0 /tmp']);
  });
  it('comando multilínea: saca los "> " de continuación', () => {
    const raw = 'cat <<EOF\r\n> hola\r\n> EOF\r\nhola\r\n';
    expect(commandOutput(raw, 'cat <<EOF\nhola\nEOF')).toEqual(['hola']);
  });
  it('salida sin salto de línea final', () => {
    expect(commandOutput('printf abc\r\nabc', 'printf abc')).toEqual(['abc']);
  });
});

describe('TermSession', () => {
  it('run espera al prompt, devuelve la salida y el código', async () => {
    const { s, socks } = session();
    const seen: string[] = [];
    s.onData(d => seen.push(d));
    s.connect(80, 24);
    const ws = socks[0];
    ws.onopen!();
    expect(s.state).toBe('open');
    ws.msg(mark(0) + PROMPT);
    const p = s.run('hdfs dfs -cat /x | head -2');
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ t: 'i', d: '\x15hdfs dfs -cat /x | head -2\r' });
    // llega partido, con la marca cortada al medio
    ws.msg('hdfs dfs -cat /x | head -2\r\nfecha,monto\r\n2024-01-01,');
    ws.msg('10\r\n\x1b]777;b');
    ws.msg('ds;1\x07' + PROMPT);
    await expect(p).resolves.toEqual({ lines: ['fecha,monto', '2024-01-01,10'], exitCode: 1 });
    // el panel ve todo menos las marcas
    expect(seen.join('')).not.toContain('777;bds');
    expect(seen.join('')).toContain('2024-01-01,10');
  });

  it('si no está lista conecta y espera el primer prompt', async () => {
    const { s, socks } = session();
    const p = s.run('ls');
    expect(s.state).toBe('connecting');
    socks[0].onopen!();
    socks[0].msg(mark(0) + PROMPT);
    expect(JSON.parse(socks[0].sent[0]).d).toBe('\x15ls\r');
    socks[0].msg('ls\r\nejemplos\r\n' + mark(0) + PROMPT);
    await expect(p).resolves.toMatchObject({ lines: ['ejemplos'], exitCode: 0 });
  });

  it('uno a la vez, y si se cierra avisa', async () => {
    const { s, socks } = session();
    s.connect();
    socks[0].onopen!();
    socks[0].msg(mark(0));
    const p = s.run('sleep 100');
    await expect(s.run('ls')).rejects.toThrow(/anterior/);
    socks[0].onclose!({ code: 4403, reason: 'La terminal solo se abre desde esta compu' });
    await expect(p).rejects.toThrow(/solo se abre desde esta compu/);
    expect(s.state).toBe('closed');
    expect(s.reason).toMatch(/esta compu/);
  });

  it('guarda lo que pasó para el panel que se monta después, y lo limpia al reconectar', () => {
    const { s, socks } = session();
    s.connect();
    socks[0].onopen!();
    socks[0].msg('hola\r\n' + mark(0) + PROMPT);
    expect(s.backlog()).toBe('hola\r\n' + PROMPT);
    socks[0].onclose!({ code: 1000, reason: '' });
    s.connect();
    expect(s.backlog()).toBe('');
  });

  it('resize manda el tamaño', () => {
    const { s, socks } = session();
    s.connect();
    socks[0].onopen!();
    s.resize(120, 40);
    expect(JSON.parse(socks[0].sent[0])).toEqual({ t: 'r', c: 120, r: 40 });
  });
});
