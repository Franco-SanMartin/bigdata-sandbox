# datos/

Carpeta compartida con el contenedor (adentro es `/datos`).
Poné acá tus CSV y scripts; lo que dejes acá NO se sube a git.

`ejemplos/` trae los datasets y scripts que usan las [guías](../guias/README.md):

| Archivo | Guía |
|---|---|
| `ventas.csv`, `generar_ventas.py` | [3. HDFS](../guias/03-hdfs.md) |
| `texto.txt`, `mapper.py`, `reducer.py` | [4. YARN y MapReduce](../guias/04-yarn-mapreduce.md) |
| `wordcount.pig`, `ventas.pig` | [5. Pig](../guias/05-pig.md) |
| `ventas.hql` | [6. Hive](../guias/06-hive.md) |
| `tienda.sql`, `tienda.hql`, `sqoop.sh` | [7. MySQL y Sqoop](../guias/07-mysql-sqoop.md) |
| `ventas.py` | [8. Spark](../guias/08-spark.md) |
| `tienda_mongo.js`, `consultas_mongo.js` | [10. MongoDB](../guias/10-mongodb.md) |

`ejemplos/ml/` es de la versión `ml` de la imagen: ETL de datos sucios con
pandas y con Spark, y modelos de scikit-learn y Spark MLlib.

Si editás un ejemplo, se guardan tus cambios; para recuperar el original,
borralo y reiniciá el contenedor (`docker restart bigdata`).
