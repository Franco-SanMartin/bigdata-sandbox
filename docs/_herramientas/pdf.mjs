// Markdown -> PDF, con el mismo aspecto en todas las versiones (estilo-pdf.css).
//
//   node docs/_herramientas/pdf.mjs docs/base/README.md docs/base/guia.md
//
// Deja cada PDF al lado de su .md (README.md -> README.pdf). Los titulos llevan el mismo ancla
// que les pone GitHub (los links #seccion andan adentro del PDF). Los links relativos a otro .md
// de docs/ que tenga su PDF pasan a apuntar al PDF; el resto de los links relativos (codigo,
// otros archivos del repo) pasa a su direccion en GitHub, porque un PDF suelto no tiene el repo
// al lado. Las imagenes relativas (svg, png) se incrustan.
import { readFileSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Marked } from 'marked';
import { navegador } from './cdp.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(AQUI, '../..');
const GITHUB = 'https://github.com/Franco-SanMartin/bigdata-sandbox';

/** El ancla que GitHub le pone a un titulo (igual que slug() de pruebas/enlaces.py). */
export function slug(titulo) {
  let t = titulo.replace(/<[^>]+>/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/`/g, '').trim().toLowerCase();
  t = [...t].filter((c) => /[\p{L}\p{N}]/u.test(c) || ' -_'.includes(c) || /\p{Mn}/u.test(c)).join('');
  return t.replace(/ /g, '-');
}

function commit() {
  try {
    return execFileSync('git', ['-C', REPO, 'log', '-1', '--format=%h'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'sin git';
  }
}

function convertir(archivo, enLote) {
  const md = readFileSync(archivo, 'utf8');
  const dir = dirname(archivo);
  const vistos = new Map();
  let titulo = '';

  const reescribir = (href) => {
    if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return href;
    const [camino, ancla] = href.split('#');
    const destino = resolve(dir, decodeURIComponent(camino));
    const conAncla = (u) => (ancla ? `${u}#${ancla}` : u);
    if (destino.endsWith('.md')) {
      const pdf = destino.replace(/\.md$/, '.pdf');
      const enDocs = destino.startsWith(join(REPO, 'docs') + sep);
      if (enDocs && (existsSync(pdf) || enLote.has(pdf))) return conAncla(relative(dir, pdf));
    }
    const rel = relative(REPO, destino).split(sep).join('/');
    if (rel.startsWith('..')) return href;
    const esDir = existsSync(destino) && statSync(destino).isDirectory();
    return conAncla(`${GITHUB}/${esDir ? 'tree' : 'blob'}/main/${rel}`);
  };

  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type === 'link') token.href = reescribir(token.href);
    },
    renderer: {
      heading({ tokens, depth, text }) {
        const base = slug(text);
        const n = vistos.get(base) ?? 0;
        vistos.set(base, n + 1);
        const id = n === 0 ? base : `${base}-${n}`;
        if (depth === 1 && !titulo) titulo = text.replace(/`/g, '');
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });
  const cuerpo = marked.parse(md);
  const css = readFileSync(join(AQUI, 'estilo-pdf.css'), 'utf8').replaceAll('url(fuentes/', `url(${pathToFileURL(join(AQUI, 'fuentes'))}/`);
  const relRepo = relative(REPO, archivo).split(sep).join('/');
  const fecha = new Intl.DateTimeFormat('es-AR', { dateStyle: 'long' }).format(new Date());
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<base href="${pathToFileURL(dir)}/"><title>${titulo || relRepo}</title><style>${css}</style></head>
<body><p class="origen">BigData Sandbox · <code>${relRepo}</code> · generado el ${fecha} desde el commit <code>${commit()}</code></p>
${cuerpo}</body></html>`;
  return { html, titulo: titulo || relRepo };
}

async function main() {
  const archivos = process.argv.slice(2).map((a) => resolve(a));
  if (!archivos.length || archivos.some((a) => !a.endsWith('.md'))) {
    console.error('Uso: node docs/_herramientas/pdf.mjs <archivo.md> [más .md]');
    process.exit(2);
  }
  const enLote = new Set(archivos.map((a) => a.replace(/\.md$/, '.pdf')));
  const tmp = mkdtempSync(join(tmpdir(), 'docs-pdf-'));
  const nav = await navegador();
  try {
    for (const archivo of archivos) {
      const { html, titulo } = convertir(archivo, enLote);
      const intermedio = join(tmp, 'pagina.html');
      writeFileSync(intermedio, html);
      const pagina = await nav.abrir(pathToFileURL(intermedio).href);
      const esc = titulo.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const pdf = await pagina.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="font: 8px 'IBM Plex Sans', sans-serif; color: #6B6B6A; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>${esc}</span><span>página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`,
        generateDocumentOutline: true,
        generateTaggedPDF: true,
      });
      await pagina.cerrar();
      const salida = archivo.replace(/\.md$/, '.pdf');
      writeFileSync(salida, pdf);
      const errores = pagina.logs.filter((l) => !l.startsWith('red: file:') && !l.startsWith('red: data:'));
      if (errores.length) console.warn(`  avisos en ${relative(REPO, archivo)}:\n    ${errores.join('\n    ')}`);
      console.log(`${relative(REPO, salida)}  (${Math.round(pdf.length / 1024)} KB)`);
    }
  } finally {
    await nav.cerrar();
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
