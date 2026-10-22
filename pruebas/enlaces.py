#!/usr/bin/env python3
"""Revisa los links relativos de la documentacion: que exista el archivo y,
si apunta a una seccion (#algo), que exista ese titulo (con el mismo slug
que arma GitHub) o ese id en el HTML. Los links a http(s) no se revisan.

Uso: python3 pruebas/enlaces.py README.md guias/*.md docs/index.html
"""
import html.parser
import os
import re
import sys
import unicodedata
import urllib.parse


def slug(titulo):
    """El ancla que GitHub le pone a un titulo de Markdown."""
    t = re.sub(r"<[^>]+>", "", titulo)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = t.replace("`", "").strip().lower()
    t = "".join(c for c in t if c.isalnum() or c in " -_" or unicodedata.category(c) == "Mn")
    return t.replace(" ", "-")


def anclas_md(texto):
    vistas, anclas = {}, set()
    en_codigo = False
    for linea in texto.split("\n"):
        if linea.startswith("```"):
            en_codigo = not en_codigo
            continue
        m = None if en_codigo else re.match(r"^#{1,6}\s+(.*?)\s*#*\s*$", linea)
        if m:
            s = slug(m.group(1))
            n = vistas.get(s, 0)
            vistas[s] = n + 1
            anclas.add(s if n == 0 else f"{s}-{n}")
    anclas.update(re.findall(r'<a\s+(?:name|id)="([^"]+)"', texto))
    return anclas


class LeerHTML(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links = set(), []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            self.ids.add(a["id"])
        for k in ("href", "src"):
            if a.get(k):
                self.links.append((self.getpos()[0], a[k]))


def links_md(texto):
    en_codigo = False
    for n, linea in enumerate(texto.split("\n"), 1):
        if linea.startswith("```"):
            en_codigo = not en_codigo
            continue
        if en_codigo:
            continue
        sin_codigo = re.sub(r"`[^`]*`", "", linea)
        for m in re.finditer(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)", sin_codigo):
            yield n, m.group(1)
        for m in re.finditer(r'(?:href|src)="([^"]+)"', sin_codigo):
            yield n, m.group(1)


cache = {}


def anclas_de(ruta):
    if ruta not in cache:
        with open(ruta, encoding="utf-8") as f:
            texto = f.read()
        if ruta.endswith((".html", ".htm")):
            p = LeerHTML()
            p.feed(texto)
            cache[ruta] = p.ids
        else:
            cache[ruta] = anclas_md(texto)
    return cache[ruta]


def main():
    errores, total = [], 0
    for archivo in sys.argv[1:]:
        with open(archivo, encoding="utf-8") as f:
            texto = f.read()
        if archivo.endswith((".html", ".htm")):
            p = LeerHTML()
            p.feed(texto)
            links = p.links
        else:
            links = list(links_md(texto))
        base = os.path.dirname(archivo)
        for n, link in links:
            if re.match(r"^[a-z][a-z0-9+.-]*:", link, re.I):
                continue   # http(s), mailto, data...
            total += 1
            camino, _, ancla = link.partition("#")
            camino = urllib.parse.unquote(camino)
            destino = os.path.normpath(os.path.join(base, camino)) if camino else archivo
            if camino.endswith("/") or os.path.isdir(destino):
                if not os.path.isdir(destino):
                    errores.append(f"{archivo}:{n}: no existe la carpeta {link}")
                continue
            if not os.path.isfile(destino):
                errores.append(f"{archivo}:{n}: no existe {link}")
                continue
            if ancla and destino.endswith((".md", ".html", ".htm")) and ancla not in anclas_de(destino):
                errores.append(f"{archivo}:{n}: no existe la seccion #{ancla} en {destino}")
    print(f"{total} links relativos revisados en {len(sys.argv) - 1} archivos")
    if errores:
        print("\n".join(errores), file=sys.stderr)
        return 1
    print("todos bien")
    return 0


if __name__ == "__main__":
    sys.exit(main())
