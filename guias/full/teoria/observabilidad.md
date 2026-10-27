# Observabilidad: saber qué pasa adentro sin entrar

Cómo se entera uno de que algo anda mal en un cluster, y cómo encuentra la
causa. Es la teoría detrás de los carteles del
[Cluster](../02-cluster-y-sinoptico.md), de los números de cada pantalla y
de la [Consola](../10-consola.md).

[← Teoría](README.md) · [Índice de full](../README.md)

## Monitorear y observar

**Monitorear** es mirar números que ya sabés que importan (¿cuántos
DataNodes vivos?, ¿cuánta memoria libre?) y avisar cuando se salen de lo
normal. **Observar** es poder contestar preguntas que no tenías previstas
(¿por qué esta consulta tardó el doble hoy?) con lo que el sistema dejó
registrado. Lo primero detecta; lo segundo explica.

## Los tres pilares

| Pilar | Qué es | En el sandbox |
|---|---|---|
| **Métricas** | Números en el tiempo, baratos de guardar y de graficar | El JMX del NameNode (`NumLiveDataNodes`, `UnderReplicatedBlocks`, `MissingBlocks`), `:8088/ws/v1/cluster/metrics` de YARN, la memoria del cgroup; los indicadores de arriba del Cluster y la curva de re-replicación |
| **Logs** | Líneas de texto con lo que pasó, con hora | Los logs de cada proceso de Hadoop, los de cada contenedor de YARN (`yarn logs`), el log del arranque (`[sandbox] …`) y la Consola |
| **Trazas** | El recorrido de un pedido a través de varios componentes | El trace de cada acción (*Entra → Hace → Sale*) y el detalle de un trabajo: de la consulta en Hive al trabajo Tez, sus vértices y los DataNodes de donde leyó |

Cada pilar contesta una pregunta distinta: las métricas dicen **que** algo
pasa, los logs **qué** pasó y las trazas **dónde** en la cadena.

## Eventos y gravedad

La Consola guarda **eventos**: algo que pasó una vez, con hora, origen,
gravedad, título y, si corresponde, el comando. La gravedad ordena la
atención:

| Gravedad | Para qué |
|---|---|
| info | Registro: algo empezó o cambió ("Arrancando el cluster") |
| ok | Confirmación: algo terminó bien ("DataNode 2 arriba") |
| warn | Algo anda peor pero sigue funcionando ("DataNode 2 se apagó") |
| error | Algo falló y alguien tiene que mirar ("…: falló") |

El **origen** (*Vos*, *Cluster*, un proceso como *DataNode 2*, una
herramienta del pipeline) permite separar lo que hiciste vos de lo que hizo
el cluster solo: la primera pregunta de cualquier diagnóstico es "¿esto lo
causó alguien o pasó solo?".

## Del síntoma a la causa

El cartel **Degradado** o **Con fallas** es una **alerta**: resume muchas
métricas en un estado y dice qué depende de qué. La regla es la misma que en
cualquier sistema de alertas:

- **Rojo (Con fallas)** cuando algo que otros necesitan no anda: el
  NameNode, el ResourceManager, MySQL, o bloques sin ninguna copia. Hay que
  actuar.
- **Ámbar (Degradado)** cuando el sistema sigue sirviendo con menos margen:
  un DataNode caído con las copias a salvo, bloques con copias de menos. Hay
  que mirar.

Una buena alerta dice **qué** está mal, **qué consecuencia** tiene y **qué
hacer**. Por eso los carteles no dicen solo "DataNode 2 caído" sino "Sus
bloques ya tienen todas las copias en los otros DataNodes: no se perdió
nada".

Para encontrar la causa se va del síntoma hacia adentro:

1. **Métrica**: ¿qué número se salió? (Bloques sub-replicados: 12).
2. **Evento**: ¿qué pasó justo antes? (DataNode 2 se apagó).
3. **Log**: ¿por qué? (el log del DataNode, o el evento con origen *Vos* que
   lo apagó).
4. **Traza**: ¿qué más afectó? (los trabajos que leían de ese nodo).

## El ruido de las alertas

Avisar de todo es tan malo como no avisar: si el cartel se prende cada vez
que un DataNode tarda 1 s en latir, la gente aprende a ignorarlo. Por eso
HDFS espera 30 s para marcar un nodo como *stale* y 40 s (en el sandbox)
para darlo por muerto (ver [salud de HDFS](salud-hdfs.md)): es un
**umbral con tiempo**, la misma técnica que usan los sistemas de alertas
("disparar solo si dura más de N minutos").

## Auditoría: quién hizo qué

Un **log de auditoría** registra cada acción con quién la hizo, cuándo y qué
comando corrió. La Consola cumple ese papel para la interfaz: cada botón deja
su comando exacto con origen *Vos*. En Hadoop, el NameNode tiene su propio
*audit log* (cada lectura, escritura y borrado en HDFS), y en las empresas lo
centralizan herramientas como **Apache Ranger**. En ambientes regulados
(bancos, salud) es obligatorio y no se puede borrar.

## Dónde vive cada cosa en el sandbox

| Qué | Dónde | Cuánto dura |
|---|---|---|
| Eventos de la Consola | En memoria del servidor de la interfaz, los últimos 1000 | Hasta que se reinicia el contenedor |
| La misma línea, en texto | La salida del contenedor (`[origen] WARN: título`) | Lo que guarde Docker (`docker logs`) |
| Logs de contenedores de YARN | Agregados en HDFS al terminar | Mientras no se borre el volumen |
| Métricas | Se leen en vivo del JMX cada 2 s; la interfaz guarda un rato de historia | Mientras la pestaña esté abierta |

En producción nada de esto alcanza: los eventos y las métricas se mandan a
un sistema aparte que los guarda, los indexa y alerta aunque nadie esté
mirando.

![La pantalla de Inicio, con el estado y las últimas acciones](../../../docs/capturas/inicio.png)

## En la industria

- **Métricas**: **Prometheus** (con un exportador de JMX para Hadoop) y
  **Grafana** para los tableros; **Datadog** o **New Relic** como servicio.
- **Logs**: la pila **ELK** (Elasticsearch, Logstash, Kibana), **Grafana
  Loki**, **Splunk**, **CloudWatch Logs**.
- **Trazas**: **OpenTelemetry** como estándar, **Jaeger** o **Zipkin** para
  verlas.
- **Alertas**: **Alertmanager**, **PagerDuty**, **Opsgenie**: quién recibe
  el aviso a las 3 de la mañana.

## Para pensar

- ¿Qué métrica mirarías para saber si un cluster va a quedarse sin
  memoria para los trabajos, antes de que pase?
- ¿Por qué los eventos de la Consola no alcanzan como log de auditoría en
  una empresa?
- Si una alerta se dispara diez veces por día y nunca hay nada que hacer,
  ¿qué cambiarías?

Hay preguntas sobre esto en la
[evaluación de operación](../evaluacion/operacion.md).
