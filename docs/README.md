# Documentación

Una carpeta por versión de la imagen. Cada una trae:

- `README.md` (y `.pdf`): qué es, cómo se hizo, qué hace y qué no, cómo se prueba.
- `guia.md` (y `.pdf`): el paso a paso, de instalar Docker a usar cada pieza.
- `interactivo.html`: el mapa de lo que hay, cómo se usa y cómo se conecta cada cosa. Es un solo
  archivo y anda sin internet.

| Versión | README | Guía | Mapa |
|---|---|---|---|
| `base` | [README](base/README.md) | [guía](base/guia.md) | [interactivo](base/interactivo.html) |
| `ml` | [README](ml/README.md) | [guía](ml/guia.md) | [interactivo](ml/interactivo.html) |
| `full` | [README](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/full/README.md) | [guía](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/full/guia.md) | [interactivo](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/full/interactivo.html) |
| `empresa` | [README](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/empresa/README.md) | [guía](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/empresa/guia.md) | [interactivo](https://github.com/Franco-SanMartin/bigdata-sandbox/blob/main/docs/empresa/interactivo.html) |

Además:

- [Glosario](glosario.md): cada término del cluster en una línea, por capa. La interfaz de `full` lo
  muestra en el "?" de cada pantalla.
- [`demo/`](demo/index.html): la interfaz de `full` con un cluster simulado (en GitHub Pages, bajo
  [/demo/](https://franco-sanmartin.github.io/bigdata-sandbox/demo/)). Sale de `npm run build:demo`
  en `ui/`: no se edita a mano.
- [`capturas/`](capturas/): las capturas de la interfaz que usan los README.
- [`_herramientas/`](_herramientas/README.md): cómo se arman los PDF y los `interactivo.html`.

El README general del proyecto está en la [raíz del repo](../README.md).
