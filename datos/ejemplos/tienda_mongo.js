// Base de ejemplo de MongoDB: "tienda", la misma empresa de la base MySQL
// (tienda.sql), pero con lo que a una base relacional le cuesta guardar:
// productos que tienen cada uno sus propios datos, clientes de los que se sabe
// mas o menos cosas, y pedidos con sus renglones ADENTRO del pedido.
//
// Se carga sola la primera vez que arranca el contenedor con MONGODB=si. Para
// recrearla de cero (adentro del contenedor, parado en /datos):
//   mongosh --quiet ejemplos/tienda_mongo.js
//
// Para mirarla:  mongosh tienda      (y adentro: show collections,
//                db.productos.find(), ... ; salir: exit)
// Consultas de ejemplo: ejemplos/consultas_mongo.js
//
// Colecciones (una "coleccion" es como una tabla, pero sin columnas fijas):
//   productos    9 documentos: los 8 de MySQL + uno nuevo con campos nuevos
//   clientes     2.000 documentos: cada uno con los datos que dejo
//   pedidos      20.000 pedidos online, cada uno con sus items adentro
//
// Siempre genera los mismos datos (numeros al azar con semilla fija), asi
// todos obtienen los mismos resultados.

db = db.getSiblingDB("tienda");
db.dropDatabase();

// Generador de numeros al azar con semilla fija (mulberry32): Math.random()
// daria datos distintos en cada carga
let semilla = 2026;
function azar() { // numero entre 0 y 1
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function entero(min, max) { return min + Math.floor(azar() * (max - min + 1)); }
function elegir(lista) { return lista[Math.floor(azar() * lista.length)]; }
function siCon(probabilidad) { return azar() < probabilidad; }

// ---------------------------------------------------------------------------
// productos: los campos comunes (_id, categoria, precio) y, ademas, los que
// tienen sentido para CADA producto. En MySQL haria falta una columna para
// cada dato posible (casi todas vacias) o una tabla aparte de "atributos".
// ---------------------------------------------------------------------------
db.productos.insertMany([
  { _id: "yerba", categoria: "infusiones", precio: 2500,
    peso_kg: 1, con_palo: true, origen: "Misiones",
    variedades: ["tradicional", "suave", "barbacua"] },
  { _id: "cafe", categoria: "infusiones", precio: 6500,
    peso_kg: 0.5, molido: true, tueste: "intenso", origen: "Brasil" },
  { _id: "mate", categoria: "accesorios", precio: 8000,
    material: "calabaza", requiere_curado: true, colores: ["natural", "negro"] },
  { _id: "bombilla", categoria: "accesorios", precio: 3000,
    material: "alpaca", largo_cm: 16 },
  { _id: "termo", categoria: "accesorios", precio: 35000,
    capacidad_l: 1, material: "acero inoxidable", garantia_meses: 24,
    colores: ["negro", "verde", "rojo"],
    resenas: [
      { cliente_id: 12, estrellas: 5, texto: "Mantiene el agua caliente todo el dia" },
      { cliente_id: 87, estrellas: 4, texto: "Muy bueno, un poco pesado" },
      { cliente_id: 301, estrellas: 2, texto: "Llego con un golpe" }
    ] },
  { _id: "azucar", categoria: "almacen", precio: 1200,
    peso_kg: 1, tipo: "comun" },
  { _id: "galletitas", categoria: "almacen", precio: 1800,
    peso_kg: 0.3, sabores: ["vainilla", "chocolate", "limon"], sin_tacc: false },
  { _id: "facturas", categoria: "panaderia", precio: 900,
    por_docena: true, tipos: ["medialuna", "vigilante", "cañoncito", "bola de fraile"],
    dura_dias: 1 },
  // El producto nuevo trae datos que ningun otro tiene: se agrega y listo,
  // sin ALTER TABLE ni tocar los documentos que ya estaban
  { _id: "yerba organica", categoria: "infusiones", precio: 4200,
    peso_kg: 0.5, con_palo: false, origen: "Misiones",
    certificaciones: ["organico", "comercio justo"], lanzamiento: new Date("2026-04-01") }
]);

// ---------------------------------------------------------------------------
// clientes: de cada uno se sabe lo que dejo. Los campos que no tiene, NO
// estan (no es lo mismo que un NULL: el campo directamente no existe).
// ---------------------------------------------------------------------------
const NOMBRES = ["Ana", "Bruno", "Carla", "Diego", "Elena", "Facundo", "Gabriela", "Hernan",
                 "Ines", "Julian", "Lucia", "Matias", "Natalia", "Pablo", "Romina", "Santiago",
                 "Tamara", "Valentin"];
const APELLIDOS = ["Gomez", "Fernandez", "Lopez", "Diaz", "Martinez", "Perez", "Romero",
                   "Sosa", "Torres", "Alvarez", "Ruiz", "Benitez", "Acosta", "Medina"];
const CIUDADES = ["CABA", "La Plata", "Quilmes", "Moron", "San Isidro", "Lanus"];
const SUCURSALES = ["Centro", "Norte", "Sur", "Oeste"];
const CLIENTES = 2000;

const clientes = [];
for (let id = 1; id <= CLIENTES; id++) {
  const nombre = elegir(NOMBRES), apellido = elegir(APELLIDOS);
  const c = {
    _id: id,
    nombre: nombre + " " + apellido,
    alta: new Date(Date.UTC(2020 + entero(0, 6), entero(0, 11), entero(1, 28)))
  };
  if (siCon(0.7)) c.email = (nombre + "." + apellido + id + "@correo.com").toLowerCase();
  if (siCon(0.5)) c.telefono = "11-" + entero(4000, 6999) + "-" + entero(1000, 9999);
  if (siCon(0.4)) {
    // Una o dos direcciones, dentro del mismo cliente
    c.direcciones = [{ tipo: "casa", calle: elegir(APELLIDOS), numero: entero(1, 5000),
                       ciudad: elegir(CIUDADES) }];
    if (siCon(0.3)) c.direcciones.push({ tipo: "trabajo", calle: elegir(APELLIDOS),
                                         numero: entero(1, 5000), ciudad: "CABA" });
  }
  if (siCon(0.3)) c.preferencias = { newsletter: siCon(0.5), sucursal: elegir(SUCURSALES) };
  if (siCon(0.05)) {
    // Mayoristas (almacenes, kioscos): datos de facturacion y descuento
    c.mayorista = { cuit: "30-" + entero(10000000, 99999999) + "-" + entero(0, 9),
                    razon_social: apellido + " Hnos. SRL", descuento_pct: elegir([5, 10, 15]) };
  }
  clientes.push(c);
}
db.clientes.insertMany(clientes);

// ---------------------------------------------------------------------------
// pedidos: cada pedido guarda ADENTRO sus items (lo que en MySQL seria una
// tabla "items_pedido" con una fila por renglon y un JOIN para juntarlos), y
// la forma de entrega, que tiene distintos datos segun sea envio o retiro.
// ---------------------------------------------------------------------------
const PRECIOS = {};
db.productos.find({}, { precio: 1 }).forEach(p => { PRECIOS[p._id] = p.precio; });
// Mas probable lo que mas se vende (como en generar_ventas.py)
const PRODUCTOS_PESADOS = [].concat(
  Array(30).fill("yerba"), Array(20).fill("facturas"), Array(15).fill("azucar"),
  Array(14).fill("galletitas"), Array(8).fill("mate"), Array(6).fill("bombilla"),
  Array(5).fill("cafe"), Array(2).fill("termo"), Array(4).fill("yerba organica"));
const PEDIDOS = 20000;
const INICIO = Date.UTC(2026, 0, 1);

let lote = [];
for (let id = 1; id <= PEDIDOS; id++) {
  const items = [];
  const vistos = {};
  for (let k = entero(1, 4); k > 0; k--) {
    const producto = elegir(PRODUCTOS_PESADOS);
    if (vistos[producto]) continue;           // cada producto una sola vez por pedido
    vistos[producto] = true;
    items.push({ producto: producto, cantidad: entero(1, 5), precio: PRECIOS[producto] });
  }
  const p = {
    _id: id,
    cliente_id: entero(1, CLIENTES),
    fecha: new Date(INICIO + entero(0, 180) * 86400000 + entero(8, 21) * 3600000),
    canal: elegir(["web", "web", "app", "app", "app", "telefono"]),
    items: items
  };
  let total = items.reduce((suma, i) => suma + i.cantidad * i.precio, 0);
  if (siCon(0.6)) {
    p.entrega = { tipo: "envio", ciudad: elegir(CIUDADES), costo: elegir([0, 1500, 2500]) };
    total += p.entrega.costo;
  } else {
    p.entrega = { tipo: "retiro", sucursal: elegir(SUCURSALES) };
  }
  if (siCon(0.1)) {
    p.cupon = { codigo: elegir(["MATE10", "OTONO15", "BIENVENIDA20"]) };
    p.cupon.descuento_pct = Number(p.cupon.codigo.replace(/\D/g, ""));
    total = Math.round(total * (100 - p.cupon.descuento_pct) / 100);
  }
  if (siCon(0.3)) p.calificacion = entero(1, 5);
  if (siCon(0.05)) p.nota = elegir(["Tocar timbre 2B", "Dejar en porteria", "Llamar antes",
                                    "Es para regalo"]);
  p.total = total;
  lote.push(p);
  if (lote.length === 1000) { db.pedidos.insertMany(lote); lote = []; }
}
if (lote.length) db.pedidos.insertMany(lote);

// Indices: para buscar rapido por cliente y por producto (ver .explain() en
// consultas_mongo.js)
db.pedidos.createIndex({ cliente_id: 1 });
db.pedidos.createIndex({ "items.producto": 1 });

print("Base 'tienda' de MongoDB cargada: " +
      db.productos.countDocuments() + " productos, " +
      db.clientes.countDocuments() + " clientes, " +
      db.pedidos.countDocuments() + " pedidos");
