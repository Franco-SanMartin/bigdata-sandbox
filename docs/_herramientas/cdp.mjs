// Un Chromium sin ventana manejado por el protocolo de DevTools (por un pipe, sin red ni puertos):
// lo usan pdf.mjs (imprimir a PDF con numero de pagina) y captura.mjs (sacar capturas).
// Busca el navegador en este orden: $CHROME, el chrome-headless-shell que baja Playwright
// (~/.cache/ms-playwright) y chromium / google-chrome del sistema. Si faltan bibliotecas del
// sistema, instalar.sh las baja sin root a ~/.local/share/docs-pdf-libs y aca se suman solas.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LIBS = join(homedir(), '.local/share/docs-pdf-libs/raiz/usr/lib');

export function buscarNavegador() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(homedir(), '.cache/ms-playwright');
  if (existsSync(cache)) {
    const shells = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of shells) {
      for (const sub of readdirSync(join(cache, d))) {
        const bin = join(cache, d, sub, 'chrome-headless-shell');
        if (existsSync(bin)) return bin;
      }
    }
  }
  for (const nombre of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try {
      return execFileSync('sh', ['-c', `command -v ${nombre}`]).toString().trim();
    } catch { /* sigue con el proximo */ }
  }
  throw new Error('No encontré un Chromium: corré docs/_herramientas/instalar.sh o poné su ruta en $CHROME');
}

function entorno() {
  const env = { ...process.env };
  if (existsSync(LIBS)) {
    const dirs = readdirSync(LIBS).map((d) => join(LIBS, d)).concat(LIBS);
    env.LD_LIBRARY_PATH = [...dirs, env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  return env;
}

/** Abre el navegador y devuelve { abrir(url, ancho, alto) -> pagina, cerrar() }. */
export async function navegador() {
  const proc = spawn(buscarNavegador(), [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run',
    '--hide-scrollbars', '--mute-audio', '--remote-debugging-pipe', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: entorno() });
  let errores = '';
  proc.stderr.on('data', (d) => { errores += d; });
  const escribir = proc.stdio[3];
  const leer = proc.stdio[4];
  let id = 0;
  const pendientes = new Map();
  const oyentes = new Set();
  let resto = '';
  leer.on('data', (trozo) => {
    resto += trozo.toString();
    let corte;
    while ((corte = resto.indexOf('\0')) >= 0) {
      const msg = JSON.parse(resto.slice(0, corte));
      resto = resto.slice(corte + 1);
      if (msg.id && pendientes.has(msg.id)) {
        const { ok, mal } = pendientes.get(msg.id);
        pendientes.delete(msg.id);
        if (msg.error) mal(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
        else ok(msg.result);
      } else {
        for (const o of oyentes) o(msg);
      }
    }
  });
  const salio = new Promise((_, mal) => proc.on('exit', (c) => mal(new Error(`el navegador terminó (código ${c}):\n${errores.slice(-2000)}`))));
  salio.catch(() => {});
  const enviar = (method, params = {}, sessionId) => {
    const msg = { id: ++id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    const p = new Promise((ok, mal) => pendientes.set(msg.id, { ok, mal }));
    escribir.write(JSON.stringify(msg) + '\0');
    return Promise.race([p, salio]);
  };
  const esperar = (sessionId, method, ms = 30000) => new Promise((ok, mal) => {
    const t = setTimeout(() => { oyentes.delete(o); mal(new Error(`no llegó ${method} en ${ms} ms`)); }, ms);
    const o = (m) => {
      if (m.sessionId === sessionId && m.method === method) { clearTimeout(t); oyentes.delete(o); ok(m.params); }
    };
    oyentes.add(o);
  });

  return {
    async abrir(url, ancho = 1280, alto = 900) {
      const { targetId } = await enviar('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await enviar('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => enviar(m, p, sessionId);
      await s('Page.enable');
      await s('Runtime.enable');
      const logs = [];
      oyentes.add((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.exceptionThrown') logs.push('excepción: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
        if (m.method === 'Network.requestWillBeSent') logs.push('red: ' + m.params.request.url);
      });
      await s('Network.enable');
      await s('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: ancho < 600 });
      const cargo = esperar(sessionId, 'Page.loadEventFired');
      await s('Page.navigate', { url });
      await cargo;
      await s('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
      return {
        logs,
        evaluar: async (expression) => (await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value,
        pdf: async (opciones) => Buffer.from((await s('Page.printToPDF', opciones)).data, 'base64'),
        captura: async (completa = true) => {
          if (completa) {
            const alto2 = await (async () => (await s('Runtime.evaluate', { expression: 'document.documentElement.scrollHeight', returnByValue: true })).result.value)();
            await s('Emulation.setDeviceMetricsOverride', { width: ancho, height: Math.min(alto2, 8000), deviceScaleFactor: 1, mobile: ancho < 600 });
          }
          return Buffer.from((await s('Page.captureScreenshot', { format: 'png' })).data, 'base64');
        },
        cerrar: () => enviar('Target.closeTarget', { targetId }),
      };
    },
    async cerrar() {
      try { await enviar('Browser.close'); } catch { /* ya cerró */ }
      proc.kill();
    },
  };
}
