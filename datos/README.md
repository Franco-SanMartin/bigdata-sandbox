# datos/

Carpeta compartida con el contenedor (adentro es `/datos`).
Poné acá tus CSV y scripts; lo que dejes acá NO se sube a git.

`ejemplos/` trae los datasets y scripts que usan las [guía de `base`](../docs/base/guia.md):

| Archivo | Guía |
|---|---|
| `ventas.csv`, `generar_ventas.py` | [7. HDFS](../docs/base/guia.md#7-hdfs) |
| `texto.txt`, `mapper.py`, `reducer.py` | [8. YARN y MapReduce](../docs/base/guia.md#8-yarn-y-mapreduce) |
| `wordcount.pig`, `ventas.pig` | [9. Pig](../docs/base/guia.md#9-pig) |
| `ventas.hql` | [10. Hive](../docs/base/guia.md#10-hive) |
| `tienda.sql`, `tienda.hql`, `sqoop.sh` | [11. MySQL y Sqoop](../docs/base/guia.md#11-mysql-y-sqoop) |
| `ventas.py` | [12. Spark](../docs/base/guia.md#12-spark) |
| `tienda_mongo.js`, `consultas_mongo.js` | [13. MongoDB](../docs/base/guia.md#13-mongodb) |

`ejemplos/ml/` es de la versión `ml` de la imagen: ETL de datos sucios con
pandas y con Spark, y modelos de scikit-learn y Spark MLlib (ver la [guía de `ml`](../docs/ml/guia.md)).

Si editás un ejemplo, se guardan tus cambios; para recuperar el original,
borralo y reiniciá el contenedor (`docker restart bigdata`).
