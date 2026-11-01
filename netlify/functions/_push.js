// Avisos al celular (Web Push), sin librerías externas.
const crypto = require("crypto");
const { sb, LOCALES, cap, fechaCorta } = require("./_shared");

const SUBJECT = "mailto:barberiailgio2031@gmail.com";
const b64u = (x) => Buffer.from(x).toString("base64url");

// Solo se aceptan los servidores de avisos de Google, Apple, Mozilla y Microsoft
const SERVIDOR_OK =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;

// Las claves se crean solas la primera vez y quedan guardadas en la base de datos
async function claves() {
  for (let i = 0; i < 2; i++) {
    const r = await sb("app_config?key=eq.vapid&select=value");
    if (r.ok) {
      const filas = await r.json();
      if (filas.length) return JSON.parse(filas[0].value);
    }
    const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    await sb("app_config", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ key: "vapid", value: JSON.stringify(privateKey.export({ format: "jwk" })) })
    });
  }
  throw new Error("No se pudieron crear las claves de avisos");
}
const publica = (jwk) =>
  b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
const clavePublica = async () => publica(await claves());

// Cifrado del mensaje (RFC 8291, aes128gcm)
function cifrar(sub, texto) {
  const receptor = Buffer.from(sub.p256dh, "base64url");
  const auth = Buffer.from(sub.auth, "base64url");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const emisor = ecdh.getPublicKey();
  const secreto = ecdh.computeSecret(receptor);
  const ikm = Buffer.from(
    crypto.hkdfSync("sha256", secreto, auth, Buffer.concat([Buffer.from("WebPush: info\0"), receptor, emisor]), 32)
  );
  const sal = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, sal, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cifrador = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const dato = Buffer.concat([
    cifrador.update(Buffer.concat([Buffer.from(texto, "utf8"), Buffer.from([2])])),
    cifrador.final(),
    cifrador.getAuthTag()
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([emisor.length]), emisor, dato]);
}

// Identificación del servidor (VAPID)
function jwt(jwk, endpoint) {
  const cab = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const cuerpo = b64u(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })
  );
  const firma = crypto.sign("sha256", Buffer.from(cab + "." + cuerpo), {
    key: crypto.createPrivateKey({ key: jwk, format: "jwk" }),
    dsaEncoding: "ieee-p1363"
  });
  return cab + "." + cuerpo + "." + b64u(firma);
}

async function enviar(jwk, sub, payload) {
  const ctrl = new AbortController();
  const corte = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(sub.endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `vapid t=${jwt(jwk, sub.endpoint)}, k=${publica(jwk)}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high"
      },
      body: cifrar(sub, JSON.stringify(payload))
    });
    return r.status;
  } catch (e) {
    return 0;
  } finally {
    clearTimeout(corte);
  }
}

async function notificar(filtro, payload) {
  try {
    const jwk = await claves();
    const r = await sb(`push_subs?select=id,endpoint,p256dh,auth&${filtro}`);
    if (!r.ok) return;
    const subs = await r.json();
    await Promise.all(
      subs.map(async (s) => {
        const estado = await enviar(jwk, s, payload);
        if (estado === 404 || estado === 410) await sb(`push_subs?id=eq.${s.id}`, { method: "DELETE" });
      })
    );
  } catch (e) {
    console.error("No se pudo enviar el aviso:", e.name);
  }
}

// Al dueño y al barbero del turno
const avisarPersonal = (barber, payload) =>
  notificar(`role=eq.staff&or=(who.eq.dueno,who.eq.${barber})`, payload);
const avisarCliente = (cid, payload) =>
  cid ? notificar(`role=eq.customer&customer_id=eq.${Number(cid)}`, payload) : Promise.resolve();

async function guardarSub(fila, sub) {
  if (!sub || typeof sub.endpoint !== "string" || sub.endpoint.length > 700 || !SERVIDOR_OK.test(sub.endpoint)) return false;
  const k = sub.keys || {};
  if (Buffer.from(String(k.p256dh || ""), "base64url").length !== 65) return false;
  if (Buffer.from(String(k.auth || ""), "base64url").length !== 16) return false;
  const r = await sb("push_subs?on_conflict=endpoint", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ endpoint: sub.endpoint, p256dh: k.p256dh, auth: k.auth, who: null, customer_id: null, ...fila })
  });
  return r.ok;
}

// Texto del aviso que recibe el cliente cuando cambia su turno
function avisoEstado(t, estado) {
  const local = LOCALES[t.location] || t.location;
  const cuando = fechaCorta(t.start_at);
  if (estado === "confirmed")
    return { title: "Turno confirmado ✅", body: `${cuando} · ${cap(t.barber)} (${local}). ¡Te esperamos!`, url: "/", tag: "turno-" + t.id };
  if (estado === "rejected")
    return { title: "Turno no disponible", body: `No pudimos confirmar tu turno del ${cuando}. Elegí otro horario en la app.`, url: "/", tag: "turno-" + t.id };
  return { title: "Turno cancelado", body: `El local canceló tu turno del ${cuando}. Podés pedir otro en la app.`, url: "/", tag: "turno-" + t.id };
}

module.exports = { clavePublica, guardarSub, avisarPersonal, avisarCliente, avisoEstado, cifrar, jwt, claves, publica };
