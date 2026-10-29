# 5. El dataset de la clase: NYC Taxi 2024

El dataset elegido es **un año de viajes de los taxis amarillos de Nueva
York (2024)**, en Parquet, publicado por la Comisión de Taxis de Nueva York
(TLC). Son 12 archivos de unos 50 MB cada uno: **unos 600 MB en total**.

[← Índice de `empresa`](README.md) · [3. El laboratorio](03-laboratorio.md)

## Por qué este

- **Entra en la red del aula**: a los ~6 MB/s que midió la sonda, se sube en
  **unos 2 minutos** (ver [qué tamaño de dataset](03-laboratorio.md#qué-tamaño-de-dataset)).
- **Se reparte**: con bloques de 128 MB (el de fábrica) cada archivo es un
  bloque, o sea 12 bloques; con réplica 2, cada uno queda en una PC y en el
  maestro. Con 2 o 3 PCs se ve el reparto; con 20, cada PC guarda pocos.
- **Parquet**: pesa menos que el CSV y Spark lee solo las columnas que usa.
- **Datos reales y conocidos**: fechas, distancias, montos y propinas; da
  para consultas, agregaciones y ML (predecir la propina o la tarifa).

Para la clase grande, si se quiere que cada PC tenga más bloques, se puede
sumar 2023 (otros ~600 MB, mismo formato) y quedar cerca de la
recomendación de 1 a 3 GB de la guía 3.

## 1. Bajarlo (en casa, con internet)

En PowerShell (Windows), al pendrive. **La carpeta no puede tener espacios**:
`empresa-profe.cmd` separa los argumentos por espacios.

<!-- prueba: no (PowerShell en Windows, baja ~600 MB) -->
```powershell
$dir = 'E:\taxi-2024'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
1..12 | ForEach-Object {
  $m = '{0:D2}' -f $_
  curl.exe -L -o "$dir\yellow_tripdata_2024-$m.parquet" "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-$m.parquet"
}
```

En Linux o Mac:

<!-- prueba: no (baja ~600 MB) -->
```bash
mkdir -p taxi-2024
for m in 01 02 03 04 05 06 07 08 09 10 11 12; do
  curl -L -o taxi-2024/yellow_tripdata_2024-$m.parquet \
    "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-$m.parquet"
done
```

Cada archivo pesa unos 50 MB (enero: 49.961.641 bytes). Si alguno pesa unos
pocos KB, se bajó una página de error: volver a bajarlo.

## 2. Cargarlo en HDFS (en el aula, PC del profe)

Con el maestro andando y las PCs ya sumadas (verdes en la vista Aula), desde
la carpeta de `empresa-profe.cmd`, en una ventana de `cmd`:

<!-- prueba: no (cmd en la PC del profe) -->
```bat
empresa-profe.cmd cargar E:\taxi-2024 /aula/datos/taxi
```

Sube los 12 archivos a `/aula/datos/taxi/` sin copiarlos antes al disco,
muestra la velocidad de cada uno y la total, y termina con cómo quedaron los
bloques. Algo así (los nombres y números dependen de cuántas PCs haya):

```
[aula] 12 archivo(s), 6xx MB, de E:\taxi-2024 a HDFS /aula/datos/taxi
[aula] Replicacion 2: cada bloque va a una PC y al maestro (la copia del maestro no pasa por la red).
[aula] yellow_tripdata_2024-01.parquet: 47,6 MB en ... s (... MB/s, ... Mbit/s)
...
[aula] Como quedaron repartidos los bloques (cuantos tiene cada PC):
  maestro  10.13.0.1      /profe        12 copias  (la del maestro: una de cada bloque)
  pc01     10.13.0.11     /fila1         4 copias
  pc02     10.13.0.12     /fila1         4 copias
  pc03     10.13.0.13     /fila1         4 copias
  12 bloques en /aula/datos/taxi (replicacion 2)
```

Lo que importa: **el maestro con una copia de cada bloque** y el resto
repartido entre las PCs. La velocidad queda en
`%USERPROFILE%\bigdata-aula\cargas.txt`.

Cargarlo **antes** de que se sumen las PCs también anda, pero entonces las
dos copias no tienen dónde ir: los bloques quedan sub-replicados y HDFS los
copia a las PCs a medida que llegan (por el túnel, en ese momento).

## Una consulta para probar

En la interfaz del maestro (<http://localhost:8080>, *Consultas*, Spark SQL)
o en la ventana de `cmd`:

<!-- prueba: no (cmd en la PC del profe, con el dataset cargado) -->
```bat
docker exec bigdata-maestro spark-sql -e "SELECT month(tpep_pickup_datetime) AS mes, count(*) AS viajes, round(avg(tip_amount),2) AS propina FROM parquet.`/aula/datos/taxi` GROUP BY 1 ORDER BY 1"
```

Da los viajes y la propina promedio por mes (unos 3 millones de viajes por
mes; puede haber algunas filas con fechas fuera de 2024, que vienen así en
los datos). Mientras corre, en <http://localhost:8088> se ve el trabajo en
YARN y en qué PCs corren sus contenedores.

[← 4. Prueba piloto](04-prueba-piloto.md) · Siguiente: [6. Plan B →](06-plan-b.md)
