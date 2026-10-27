# 10. La Consola: todo lo que pasó, con el comando exacto

Encontrar qué hizo la interfaz y qué hizo el cluster, en orden, con el
comando exacto de cada acción y lo que entró, lo que hizo y lo que salió.
Sirve para tres cosas: aprender el comando que corresponde a cada botón,
diagnosticar un problema y copiar lo que hiciste para repetirlo en la
terminal.

[← 9. Configuración y compose](09-configuracion-y-compose.md) · [Índice de full](README.md) · Siguiente: [Referencia →](referencia.md)

Hay dos formas de verla: la pantalla **Consola** (`G O`) y el cajón que se
abre abajo en cualquier pantalla con `Ctrl+J`.

## Paso 1. El cajón

**Qué hacer.** En cualquier pantalla, `Ctrl+J`.

**Qué se ve.** Un panel abajo, "cada acción con su comando, lo que entra, lo
que hace y lo que sale", con los filtros *Todo*, *Mis acciones* y
*Problemas*, un buscador ("Filtrar…") y la lista de eventos. Cada evento se
despliega para ver el detalle y el log. El borde de arriba se arrastra (o se
mueve con las flechas) para cambiar el alto.

**Qué significa.** Es para mirar de reojo mientras trabajás en otra
pantalla: lanzás un trabajo en YARN y ves aparecer los eventos sin salir de
ahí.

## Paso 2. La pantalla

**Qué hacer.** `G O`, o **Consola** en la barra lateral.

**Qué se ve.** El título *Consola* con "Todo lo que pasó en el cluster. Elegí
un evento para ver el comando exacto, qué entró, qué hizo y qué salió." Dos
columnas:

- A la izquierda, **Eventos**: cada uno con la hora, un punto de color por
  gravedad, el **origen** (quién lo informó), el título y un ícono de
  terminal si corrió un comando. Sin nada: "Todavía no pasó nada. Lo que
  hagas (y lo que haga el cluster) aparece acá."
- A la derecha, el **detalle** del evento elegido.

Con las flechas arriba y abajo se recorre la lista.

**Qué significa.** El servidor guarda los últimos 1000 eventos en memoria y
manda cada uno nuevo a la interfaz por SSE (el evento `activity`). Al
reiniciar el contenedor se pierden; lo que queda es el log de Docker (paso 6).

## Paso 3. Filtrar

**Qué se ve.** Arriba de la lista:

- El buscador "Buscar en títulos, comandos y logs".
- **Gravedad**: *Todo*, *Problemas* (avisos y errores, con la cantidad),
  *Errores*, *Listos*.
- **Origen**: "Todos los orígenes", **Vos (tus acciones)** primero y después
  el resto con su cantidad: *Cluster* (el arranque y el apagado), cada
  proceso (por ejemplo *DataNode 2*), cada herramienta del pipeline y los
  motores cuando no se pudo leer su catálogo.

Con un filtro puesto: "N de M eventos" y **Ver todo** para sacarlos.

**Qué hacer.** Elegí *Problemas*.

**Qué se ve.** Solo los avisos (ámbar) y los errores (rojo). Si hiciste la
falla a propósito de la [guía 2](02-cluster-y-sinoptico.md), ahí está el
DataNode que se cayó.

| Gravedad | Etiqueta en el detalle | Ejemplos |
|---|---|---|
| info | Info | "Arrancando el cluster", cada paso del arranque, una acción que empezó |
| ok | Listo | "DataNode 2 arriba", una consulta que terminó |
| warn | Aviso | "DataNode 2 se apagó", "El apagado tardó demasiado: se cortan los que quedan" |
| error | Error | "*consulta*: falló", "*modelo*: falló" |

## Paso 4. El detalle de un evento

**Qué se ve.**

- La gravedad, el origen y la fecha y hora.
- El título.
- **Comando**: el comando exacto con `$` adelante y un botón **Copiar**. Si
  el evento no corrió nada: "Este evento no corrió un comando: lo informó la
  interfaz" (o el origen).
- El recorrido numerado **1 Entra**, **2 Hace**, **3 Sale**.
- **Log**: la línea técnica (el error de Java, la salida del comando), con
  **Copiar el log**.
- Botones para seguir: **Ver el proceso en Cluster**, **Sólo eventos de este
  proceso** (fija un filtro que se ve como "Sólo el proceso dn2" y se quita
  con la X) y **Ver el trabajo** (abre el detalle en Trabajos en YARN).

**Qué hacer.** Buscá *mkdir* o *put* y abrí el evento de algo que hayas hecho
en HDFS. Copiá el comando y pegalo en la terminal del contenedor.

**Qué significa.** Cada botón de la interfaz corre (o equivale a) un comando
de Hadoop. La consola es el puente: ves el botón, ves el comando, y la
próxima vez lo podés escribir vos.

## Paso 5. Usarla para diagnosticar

**Qué hacer.** Corré en **Consultas** algo que falle (por ejemplo, una
consulta de Hive sobre una tabla que no existe) y volvé a la Consola con
*Errores*.

**Qué se ve.** Un evento de origen *Vos* que termina en "falló", con el
comando de `beeline` que se corrió y, en **Log**, el mensaje del motor tal
como lo devolvió.

**Qué significa.** Para diagnosticar se lee de abajo hacia arriba: qué falló
(el error), qué se corrió (el comando), qué recibió (Entra). Si el error es
de un proceso, **Sólo eventos de este proceso** muestra la historia de ese
proceso sola: cuándo arrancó, cuándo dejó de responder.

## Paso 6. Lo mismo desde la terminal

El servidor de la interfaz además escribe cada evento en su salida, con el
origen entre corchetes y la gravedad si es aviso o error
(`[Cluster] WARN: …`). Esa salida es la del contenedor.

**En tu compu.** Con el contenedor de la [guía 1](01-arrancar-y-recorrido.md)
(si lo levantaste con el `docker-compose.yml` de la guía 9, se llama
`bigdata`):

<!-- prueba: no (necesita el contenedor corriendo con eventos) -->
```bash
docker logs bigdata-full | grep "^\[Vos\]"
docker logs -f bigdata-full
```

**Qué significa.** La consola de la interfaz y `docker logs` cuentan lo
mismo; la diferencia es que la interfaz agrega el comando, la entrada, la
salida y los enlaces.

## Dónde se usa esto en la industria

Juntar todos los eventos con su origen y su gravedad, buscarlos y saltar del
evento al recurso es lo que hacen las plataformas de **logs centralizados**:
la pila **ELK** (Elasticsearch, Logstash, Kibana), **Grafana Loki**,
**Splunk**, **Datadog** o **CloudWatch Logs**. El registro de "quién hizo qué
y con qué comando" es un **log de auditoría**, obligatorio en ambientes
regulados; en Hadoop lo da el *audit log* del NameNode y, en distribuciones
empresariales, **Apache Ranger** o **Cloudera Navigator**. Ver
[teoría: observabilidad](teoria/observabilidad.md).
