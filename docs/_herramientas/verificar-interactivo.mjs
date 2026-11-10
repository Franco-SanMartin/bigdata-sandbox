// Abre un interactivo.html en un Chromium sin ventana y comprueba que anda sin red:
//   - que no pida nada afuera del propio archivo (ni CDN, ni fuentes remotas),
//   - que no tire errores de JavaScript,
//   - que al tocar un componente el panel muestre su detalle, y que los recorridos avancen.
// Con --capturas <carpeta> deja capturas a 390 y 1440 px de ancho para mirarlas.
//
//   node docs/_herramientas/verificar-interactivo.mjs docs/base/interactivo.html [--capturas /tmp/cap]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { navegador } from './cdp.mjs';

const args = process.argv.slice(2);
const html = args.find((a) => a.endsWith('.html'));
const iCap = args.indexOf('--capturas');
const capturas = iCap >= 0 ? args[iCap + 1] : null;
if (!html) {
  console.error('Uso: node docs/_herramientas/verificar-interactivo.mjs <interactivo.html> [--capturas <carpeta>]');
  process.exit(2);
}
const url = pathToFileURL(resolve(html)).href;
const nombre = basename(dirname(resolve(html)));
const nav = await navegador();
let fallas = 0;
const mal = (m) => { fallas++; console.log(`  MAL  ${m}`); };
const bien = (m) => console.log(`  ok   ${m}`);
try {
  for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
    const p = await nav.abrir(url, ancho, alto);
    const afuera = p.logs.filter((l) => l.startsWith('red: ') && !l.startsWith('red: file:') && !l.startsWith('red: data:'));
    const errores = p.logs.filter((l) => !l.startsWith('red: '));
    afuera.length ? mal(`${ancho}px: pide cosas a la red: ${afuera.join(', ')}`) : bien(`${ancho}px: no pide nada a la red`);
    errores.length ? mal(`${ancho}px: errores de JS: ${errores.join(' | ')}`) : bien(`${ancho}px: sin errores de JS`);
    const r = await p.evaluar(`(async () => {
      const espera = () => new Promise((r) => setTimeout(r, 250));
      const out = {};
      out.componentes = document.querySelectorAll('.nodo').length;
      out.aristas = document.querySelectorAll('.arista').length;
      out.fuente = document.fonts.check('13px "IBM Plex Sans"');
      out.scrollH = document.documentElement.scrollWidth > window.innerWidth + 1;
      const angosto = window.innerWidth < 760;
      const primero = angosto ? document.querySelector('.chip') : document.querySelector('.nodo');
      primero.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await espera();
      out.panel = document.querySelector('#panel h2')?.textContent;
      out.resaltados = document.querySelectorAll('.nodo.sel').length;
      out.basura = ['undefined', '[object ', 'NaN'].some((t) => document.body.innerText.includes(t));
      const rec = document.querySelector('#recorridos .btn');
      if (rec) {
        rec.click(); await espera();
        const sig = [...document.querySelectorAll('#panel .btn')].find((b) => b.textContent.startsWith('Siguiente'));
        out.recorrido = document.querySelector('#panel .paso-n')?.textContent;
        if (sig) { sig.click(); await espera(); out.recorrido2 = document.querySelector('#panel .paso-n')?.textContent; }
      }
      document.querySelector('#tab-uso').click(); await espera();
      out.pasosUso = document.querySelectorAll('#v-uso ol.pasos > li').length;
      out.usoVisible = !document.querySelector('#v-uso').hidden;
      document.querySelector('#tab-puertos').click(); await espera();
      out.filasPuertos = document.querySelectorAll('#v-puertos tbody tr').length;
      document.querySelector('#tab-mapa').click(); await espera();
      const b = document.querySelector('#buscar'); b.value = 'zzzz-no-existe'; b.dispatchEvent(new Event('input')); await espera();
      out.vacio = !document.querySelector('#sin-resultados').hidden;
      b.value = ''; b.dispatchEvent(new Event('input'));
      return out;
    })()`);
    r.componentes > 0 ? bien(`${r.componentes} componentes y ${r.aristas} conexiones dibujados`) : mal('no dibujó componentes');
    r.fuente ? bien('IBM Plex cargada (incrustada)') : mal('no cargó la fuente incrustada');
    r.scrollH ? mal(`${ancho}px: hay scroll horizontal`) : bien(`${ancho}px: sin scroll horizontal`);
    r.basura ? mal('la página muestra "undefined", "[object" o "NaN"') : bien('sin textos rotos (undefined / [object / NaN)');
    r.panel ? bien(`tocar un componente abre su detalle ("${r.panel}")`) : mal('tocar un componente no abre el detalle');
    if (r.recorrido) (r.recorrido2 && r.recorrido2 !== r.recorrido) || r.recorrido.endsWith('de 1') ? bien(`recorrido: ${r.recorrido} -> ${r.recorrido2 ?? '(1 paso)'}`) : mal('el recorrido no avanza');
    r.pasosUso > 0 && r.usoVisible ? bien(`"Cómo se usa": ${r.pasosUso} pasos`) : mal('"Cómo se usa" vacío');
    bien(`"Puertos": ${r.filasPuertos} filas`);
    r.vacio ? bien('búsqueda sin resultados muestra el estado vacío') : mal('búsqueda sin resultados no avisa');
    if (capturas) {
      mkdirSync(capturas, { recursive: true });
      // captura limpia: recargar y, en ancho, con un componente elegido
      const p2 = await nav.abrir(url, ancho, alto);
      await p2.evaluar(`(() => { const n = document.querySelectorAll(window.innerWidth < 760 ? '.chip' : '.nodo'); (n[Math.min(2, n.length - 1)])?.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
      await new Promise((r2) => setTimeout(r2, 300));
      const png = await p2.captura(true);
      const f = join(capturas, `${nombre}-${ancho}.png`);
      writeFileSync(f, png);
      bien(`captura: ${f}`);
      await p2.cerrar();
    }
    await p.cerrar();
  }
} finally {
  await nav.cerrar();
}
console.log(fallas ? `${fallas} problemas` : 'todo bien');
process.exit(fallas ? 1 : 0);
