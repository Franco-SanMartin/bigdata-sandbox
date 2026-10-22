# Interfaz web de BigData Sandbox :full

La app de operación que corre en el puerto 8080 del contenedor: estado del cluster,
arranque paso a paso, procesos, configuración, consola de actividad y (en las próximas
entregas) HDFS, YARN, pipeline, datos y ML.

React + TypeScript + Vite, primitivas accesibles de Radix con estilos propios, íconos
Lucide y gráficos con d3. Tipografía IBM Plex, dentro del bundle para que ande sin internet.

## Uso

```bash
cd ui
npm install
npm run dev        # http://localhost:5173 (las llamadas a /api van a localhost:8080)
npm run build      # genera dist/: archivos estáticos para servir desde el backend o GitHub Pages
```

## Modo demo y backend real

Las pantallas solo conocen la interfaz `SandboxApi` de `src/api/types.ts`. Al arrancar,
la app prueba `GET ./api/status`:

- si contesta JSON, usa `src/api/http.ts` y habla con el backend del contenedor;
- si no, usa `src/api/demo/`: un cluster simulado en el navegador (tiempos ×5).

`?demo` en la URL fuerza el modo demo. Las rutas HTTP que tiene que implementar el
backend están documentadas al lado de cada método en `src/api/types.ts`; los eventos en
vivo llegan por Server-Sent Events en `GET /api/events`.

## Estructura

```
src/api/        contrato (types.ts), cliente HTTP y modo demo
src/state/      foto del cluster, estado de la interfaz y acciones con confirmación
src/shell/      barra lateral, barra superior, Ctrl+K, consola, ayuda, avisos
src/widgets/    arquitectura viva y arranque paso a paso
src/pages/      Cluster, Configuración, Consola
src/lib/        reglas de configuración, RAM, docker-compose.yml, formatos
src/styles/     tokens (escala neutra), componentes y widgets
```

Atajos: `Ctrl+K` buscar o ejecutar, `Ctrl+J` consola, `?` ayuda, `G` y una letra para ir
a cada pantalla (`G C` Cluster, `G S` Configuración…).
