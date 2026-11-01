// Íconos y datos de instalación de la app (sin archivos de imagen que subir)
const zlib = require("zlib");

const VERDE = [24, 61, 48];
const CREMA = [246, 244, 238];

// ---- Ícono: círculo con las letras IG, dibujado por código ----
function dentroDeLetras(x, y) {
  // Coordenadas de 0 a 1. Letra I con remates:
  if (x >= 0.375 && x <= 0.405 && y >= 0.38 && y <= 0.62) return true;
  if (x >= 0.345 && x <= 0.435 && ((y >= 0.38 && y <= 0.397) || (y >= 0.603 && y <= 0.62))) return true;
  // Letra G: anillo abierto a la derecha + barra interior
  const dx = x - 0.58, dy = y - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  const abierto = dx > 0 && dy < 0 && -dy <= dx;
  if (r >= 0.098 && r <= 0.122 && !abierto) return true;
  if (x >= 0.585 && x <= 0.702 && y >= 0.488 && y <= 0.512) return true;
  return false;
}
function dentroDelAro(x, y) {
  const r = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2);
  return r >= 0.318 && r <= 0.338;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function trozo(tipo, datos) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
}

const guardados = {};
function icono(tam) {
  if (guardados[tam]) return guardados[tam];
  const filas = Buffer.alloc((tam * 3 + 1) * tam);
  const S = 3; // suavizado de bordes
  for (let py = 0; py < tam; py++) {
    filas[py * (tam * 3 + 1)] = 0;
    for (let px = 0; px < tam; px++) {
      let crema = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / tam;
          const y = (py + (sy + 0.5) / S) / tam;
          if (dentroDelAro(x, y) || dentroDeLetras(x, y)) crema++;
        }
      const t = crema / (S * S);
      const o = py * (tam * 3 + 1) + 1 + px * 3;
      for (let i = 0; i < 3; i++) filas[o + i] = Math.round(VERDE[i] * (1 - t) + CREMA[i] * t);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0);
  ihdr.writeUInt32BE(tam, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // color RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(filas)),
    trozo("IEND", Buffer.alloc(0))
  ]);
  guardados[tam] = png;
  return png;
}

const ICONOS = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
  { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
];
const MANIFIESTOS = {
  cliente: {
    name: "Il Gio Coffee & Barbería",
    short_name: "Il Gio",
    description: "Reservá tu turno en Il Gio Coffee & Barbería",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ee",
    theme_color: "#183d30",
    lang: "es-AR",
    icons: ICONOS
  },
  admin: {
    name: "Il Gio · Panel de turnos",
    short_name: "Il Gio Panel",
    description: "Turnos y clientes de Il Gio",
    id: "/admin",
    start_url: "/admin",
    scope: "/admin",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f4ee",
    theme_color: "#183d30",
    lang: "es-AR",
    icons: ICONOS
  }
};

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  if (q.r === "icon") {
    const tam = Number(q.size);
    if (![180, 192, 512].includes(tam)) return { statusCode: 400, body: "Tamaño inválido" };
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" },
      body: icono(tam).toString("base64")
    };
  }
  if (q.r === "manifest") {
    const m = MANIFIESTOS[q.app === "admin" ? "admin" : "cliente"];
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify(m)
    };
  }
  return { statusCode: 404, body: "No encontrado" };
};
