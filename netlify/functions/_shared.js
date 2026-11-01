const crypto = require("crypto");

const STAFF = {
  boedo: { lautaro: [9, 14], julieta: [14, 20] },
  matheu: { thiago: [11, 20] }
};
const SERVICES = { "Corte": 18000, "Corte y barba": 22000, "Barba": 14000 };
const LOCALES = { boedo: "Boedo", matheu: "Parque Patricios" };
// Quiénes pueden entrar al panel
const PERSONAL = ["dueno", "lautaro", "julieta", "thiago"];
const TZ = "America/Argentina/Buenos_Aires";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Limpia espacios, saltos de línea o texto de más pegado en las variables
const limpiar = (valor, patron) => {
  const s = String(valor || "");
  const m = s.match(patron);
  return (m ? m[0] : s).trim();
};
const sbUrl = () =>
  limpiar(process.env.SUPABASE_URL, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
const sbKey = () =>
  limpiar(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    /sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
  );

const sb = (path, options = {}) =>
  fetch(`${sbUrl()}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: sbKey(),
      Authorization: `Bearer ${sbKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

const validSlot = (location, barber, time) => {
  const hours = STAFF[location] && STAFF[location][barber];
  if (!hours || !/^\d{2}:(00|30)$/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= hours[0] * 60 && mins + 30 <= hours[1] * 60;
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// Firma de los enlaces del mail (nadie puede confirmar un turno sin el enlace)
const firmar = (id) => {
  const k = sbKey();
  if (!k) throw new Error("Falta la clave");
  return crypto.createHmac("sha256", k).update("turno:" + id).digest("hex").slice(0, 32);
};
const tokenOk = (id, t) => {
  try {
    const a = Buffer.from(firmar(id));
    const b = Buffer.from(String(t || ""));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
};

const fechaLarga = (iso) => {
  const d = new Date(iso);
  const dia = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: TZ }).format(d);
  const hora = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
  return `${dia} a las ${hora}`;
};
const fechaCorta = (iso) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("es-AR", {
      weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ
    })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return `${p.weekday} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
};

// Arma el número de WhatsApp argentino (549 + área + número)
const waNumber = (phone) => {
  let d = String(phone).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("549")) return d;
  if (d.startsWith("54")) return "549" + d.slice(2);
  d = d.replace(/^0+/, "");
  if (d.length === 12 && d.startsWith("11") && d.slice(2, 4) === "15") d = "11" + d.slice(4);
  else if (d.length === 12 && d.slice(3, 5) === "15") d = d.slice(0, 3) + d.slice(5);
  return "549" + d;
};
const waLink = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;

const baseUrl = (event) => {
  const h = (event && event.headers) || {};
  const host = h["x-forwarded-host"] || h.host || "";
  return host ? `https://${host}` : process.env.URL || "";
};

// ---- Sesiones (clientes y personal) y contraseñas ----
const b64u = (x) => Buffer.from(x).toString("base64url");
const claveSesion = (ctx) => crypto.createHash("sha256").update("sesion|" + ctx + "|" + sbKey()).digest();
const emitir = (datos, dias, ctx) => {
  if (!sbKey()) throw new Error("Falta la clave");
  const cuerpo = b64u(JSON.stringify({ ...datos, exp: Date.now() + dias * 86400000 }));
  const firma = b64u(crypto.createHmac("sha256", claveSesion(ctx)).update(cuerpo).digest());
  return cuerpo + "." + firma;
};
const leer = (token, ctx) => {
  try {
    const [cuerpo, firma] = String(token || "").split(".");
    if (!cuerpo || !firma) return null;
    const esperada = b64u(crypto.createHmac("sha256", claveSesion(ctx)).update(cuerpo).digest());
    const a = Buffer.from(esperada);
    const b = Buffer.from(firma);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8"));
    return datos.exp > Date.now() ? datos : null;
  } catch (e) {
    return null;
  }
};
const tokenDe = (event) => String((event.headers || {}).authorization || "").replace(/^Bearer\s+/i, "");

const hashPass = (pass) => {
  const sal = crypto.randomBytes(16);
  return sal.toString("hex") + ":" + crypto.scryptSync(String(pass), sal, 32).toString("hex");
};
const checkPass = (pass, guardada) => {
  try {
    const [sal, h] = String(guardada).split(":");
    const x = crypto.scryptSync(String(pass), Buffer.from(sal, "hex"), 32);
    const y = Buffer.from(h, "hex");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  } catch (e) {
    return false;
  }
};

module.exports = {
  STAFF, SERVICES, LOCALES, PERSONAL, json, sb, validSlot, pausa,
  esc, cap, firmar, tokenOk, fechaLarga, fechaCorta, waNumber, waLink, baseUrl,
  emitir, leer, tokenDe, hashPass, checkPass
};
