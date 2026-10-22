# datos/

Carpeta compartida con el contenedor (adentro es `/datos`).
Poné acá tus CSV y scripts; lo que dejes acá NO se sube a git.

`ejemplos/` trae los datasets y scripts del [tutorial](../TUTORIAL.md): ventas
por producto en MapReduce (`mapper.py` + `reducer.py`), Pig (`ventas.pig`),
Hive (`ventas.hql`) y Spark (`ventas.py`), Sqoop (`sqoop.sh`, que trae la
base MySQL `tienda.sql` a HDFS y la cruza en Hive con `tienda.hql`), más un
generador de datos (`generar_ventas.py`) y el wordcount. Para MongoDB
(versiones `base` y `ml` de la imagen): la base `tienda_mongo.js` y
`consultas_mongo.js`. En `ejemplos/ml/` (versión `ml`): ETL de datos sucios
con pandas y con Spark, y modelos de scikit-learn y Spark MLlib sobre datos
generados con reglas conocidas (ver el [README](../README.md), sección 10).
Si los editás, se guardan tus cambios; para recuperar uno original, borralo
y reiniciá el contenedor.
