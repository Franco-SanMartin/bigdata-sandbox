-- Base de datos de ejemplo para Sqoop: "tienda", la empresa de las ventas de
-- los otros ejemplos, pero guardada en una base relacional (MySQL), como en
-- cualquier empresa. Sqoop la copia a HDFS para procesarla con Hadoop.
--
-- Se crea sola la primera vez que arranca el contenedor. Para recrearla de
-- cero (adentro del contenedor, parado en /datos):
--   python3 ejemplos/generar_ventas.py 200000 /tmp/tienda_ventas.csv
--   mysql < ejemplos/tienda.sql
--
-- Para mirarla:  mysql tienda      (y adentro: SHOW TABLES; SELECT ...; exit)

DROP DATABASE IF EXISTS tienda;
CREATE DATABASE tienda;
USE tienda;

-- Catalogo: a que categoria pertenece cada producto y cuanto sale
CREATE TABLE productos (
  producto  VARCHAR(20) PRIMARY KEY,
  categoria VARCHAR(20) NOT NULL,
  precio    INT         NOT NULL
);
INSERT INTO productos VALUES
  ('yerba',      'infusiones',  2500),
  ('cafe',       'infusiones',  6500),
  ('mate',       'accesorios',  8000),
  ('bombilla',   'accesorios',  3000),
  ('termo',      'accesorios', 35000),
  ('azucar',     'almacen',     1200),
  ('galletitas', 'almacen',     1800),
  ('facturas',   'panaderia',    900);

CREATE TABLE sucursales (
  sucursal  VARCHAR(20) PRIMARY KEY,
  encargado VARCHAR(30) NOT NULL,
  apertura  DATE        NOT NULL
);
INSERT INTO sucursales VALUES
  ('Centro', 'Laura Gomez',  '2015-03-01'),
  ('Norte',  'Martin Diaz',  '2018-08-15'),
  ('Sur',    'Sofia Perez',  '2020-02-10'),
  ('Oeste',  'Diego Romero', '2022-11-05');

-- Las 200.000 ventas, las mismas de ventas_grandes.csv. 'id' es la clave
-- primaria: Sqoop la usa para repartir la tabla entre varios mappers.
CREATE TABLE ventas (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  fecha    DATE        NOT NULL,
  sucursal VARCHAR(20) NOT NULL,
  producto VARCHAR(20) NOT NULL,
  cantidad INT         NOT NULL,
  precio   INT         NOT NULL
);
LOAD DATA LOCAL INFILE '/tmp/tienda_ventas.csv' INTO TABLE ventas
  FIELDS TERMINATED BY ',' IGNORE 1 LINES
  (fecha, sucursal, producto, cantidad, precio);

-- Vacia: aca vuelve el resultado calculado en Hadoop (sqoop export)
CREATE TABLE resumen_categoria (
  categoria VARCHAR(20) PRIMARY KEY,
  unidades  INT         NOT NULL,
  facturado BIGINT      NOT NULL
);
