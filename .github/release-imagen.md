La imagen `base` para Intel/AMD (amd64) en un solo archivo: Ubuntu 24.04 + Hadoop (HDFS y YARN), Pig, Hive, Spark, Sqoop con MySQL, ZooKeeper y MongoDB. Es la misma que `latest`, la de la materia.

Sirve para bajarla una vez y repartirla en el aula, o para usarla en una compu sin internet.

**Cómo usarla sin internet**

1. Bajá `bigdata-sandbox.tar.gz` (abajo, en *Assets*) y el [`docker-compose.yml`](https://github.com/Franki-678/bigdata-sandbox/blob/main/docker-compose.yml) del repo, y ponelos en la misma carpeta.
2. Cargá la imagen (no hace falta descomprimirla):
   ```
   docker load -i bigdata-sandbox.tar.gz
   ```
   Quedan cargados los dos tags: `franki678/bigdata-sandbox:base` y `franki678/bigdata-sandbox:latest`.
3. Levantá el cluster desde esa carpeta:
   ```
   docker compose up -d
   ```

Para ARM (Mac M1–M4) no hay archivo: con internet, `docker compose up -d` baja sola la imagen que corresponde.

**Guías**

- [Instalación, con el paso a paso para el aula](https://github.com/Franki-678/bigdata-sandbox/blob/main/guias/01-instalacion.md)
- [Todas las guías](https://github.com/Franki-678/bigdata-sandbox/blob/main/guias/README.md)
