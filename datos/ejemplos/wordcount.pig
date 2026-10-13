-- El clasico wordcount, en Pig Latin: cuantas veces aparece cada palabra.
-- Es el mismo calculo que el ejemplo wordcount de MapReduce en Java, pero en
-- 6 lineas.
--
-- Uso (adentro del contenedor, parado en /datos):
--   hdfs dfs -put -f ejemplos/texto.txt /user/root/
--   pig ejemplos/wordcount.pig
--
-- Sin cluster, sobre el archivo local (no usa HDFS ni YARN):
--   pig -x local -param entrada=ejemplos/texto.txt ejemplos/wordcount.pig

%default entrada '/user/root/texto.txt'

lineas   = LOAD '$entrada' AS (linea:chararray);
palabras = FOREACH lineas GENERATE FLATTEN(TOKENIZE(linea)) AS palabra;
grupos   = GROUP palabras BY palabra;
conteo   = FOREACH grupos GENERATE group AS palabra, COUNT(palabras) AS veces;
ordenado = ORDER conteo BY veces DESC, palabra ASC;
DUMP ordenado;
