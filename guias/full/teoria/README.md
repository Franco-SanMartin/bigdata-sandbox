# Teoría de la versión full

Las guías de `full` dicen **qué tocar y qué se ve**. Estos textos explican
**por qué** el cluster se comporta así: por qué un DataNode tarda 40 s en
darse por muerto, por qué un trabajo espera en la cola, por qué conviene
partir un proceso de datos en etapas o por qué un árbol se puede leer y una
red no. Cada tema se apoya en lo que la interfaz muestra y remite a la guía
donde se ve.

[← Índice de full](../README.md) · [Referencia](../referencia.md) · [Evaluación →](../evaluacion/README.md)

| Tema | De qué trata | Dónde se ve |
|---|---|---|
| [La interfaz y el cluster](ui-y-cluster.md) | Cómo una interfaz web sabe qué pasa adentro de Hadoop: procesos, puertos, JMX, REST y eventos en vivo | [1](../01-arrancar-y-recorrido.md), [2](../02-cluster-y-sinoptico.md), [5](../05-consultas.md) |
| [Observabilidad](observabilidad.md) | Métricas, logs y trazas; qué es un evento, una alerta y un log de auditoría | [2](../02-cluster-y-sinoptico.md), [10](../10-consola.md) |
| [Salud de HDFS](salud-hdfs.md) | Latidos, *stale* y muerto, sub-replicación, bloques perdidos, `fsck`, modo seguro | [2](../02-cluster-y-sinoptico.md), [3](../03-hdfs.md) |
| [Ciclo de vida en YARN](ciclo-de-vida-yarn.md) | De `submit` a `FINISHED`: ApplicationMaster, contenedores, colas, logs | [4](../04-trabajos-yarn.md) |
| [Pipelines de datos](pipelines.md) | Ingesta, ETL, almacenamiento, análisis, ML y resultados; qué herramienta para qué | [6](../06-pipeline.md) |
| [Interpretabilidad](interpretabilidad.md) | Por qué se puede mirar un modelo por dentro y qué se aprende de eso | [7](../07-machine-learning.md) |

Un orden posible: primero **la interfaz y el cluster** (para saber de dónde
sale cada número), después **salud de HDFS** y **YARN** (lo que más se ve en
las pantallas), y al final **pipelines** e **interpretabilidad**, que
juntan todo.

Para practicar lo que dice cada texto, está la
[evaluación](../evaluacion/README.md): preguntas de opción múltiple,
preguntas de desarrollo y ejercicios sobre la interfaz.
