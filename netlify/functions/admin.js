const crypto = require("crypto");
const {
  json, sb, waNumber, emitir, leer, tokenDe, hashPass, pausa, PERSONAL
} = require("./_shared");
const { avisarCliente, avisoEstado, guardarSub } = require("./_push");

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const igual = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

// Cambios de estado permitidos: nuevo estado -> estado desde el que se puede llegar
const DESDE = { confirmed: "pending", rejected: "pending", cancelled: "confirmed" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const secret = process.env.ADMIN_PASSWORD;
    if (!secret) return json(500, { error: "Falta configurar ADMIN_PASSWORD en Netlify." });
    const b = JSON.parse(event.body || "{}");
    const A = b.accion;

    if (A === "login") {
      if (!PERSONAL.includes(b.who) || !igual(b.password || "", secret)) {
        await pausa(800);
        return json(401, { error: "Contraseña incorrecta." });
      }
      return json(200, { token: emitir({ who: b.who }, 90, "staff|" + secret), who: b.who });
    }

    // Lo demás requiere haber ingresado (cambiar la contraseña cierra todas las sesiones)
    const ses = leer(tokenDe(event), "staff|" + secret);
    if (!ses) return json(401, { error: "Tu sesión venció. Ingresá de nuevo." });

    if (A === "list") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return json(400, { error: "Fecha inválida." });
      const from = encodeURIComponent(`${b.date}T00:00:00-03:00`);
      const to = encodeURIComponent(`${b.date}T23:59:59-03:00`);
      const r = await sb(
        `appointments?select=id,location,barber,start_at,service,price,customer_name,customer_phone,status&status=in.(pending,confirmed)&start_at=gte.${from}&start_at=lte.${to}&order=start_at.asc`
      );
      if (!r.ok) return json(500, { error: "Error de base de datos." });
      const rows = await r.json();
      const turnos = rows.map((x) => {
        const d = new Date(new Date(x.start_at).getTime() - 3 * 3600 * 1000);
        return {
          id: x.id,
          time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
          location: x.location,
          barber: x.barber,
          service: x.service,
          price: x.price,
          name: x.customer_name,
          phone: x.customer_phone,
          status: x.status
        };
      });
      return json(200, { turnos });
    }

    if (A === "clients") {
      // Clientes = personas con turnos + personas registradas. Se arma solo.
      const [ra, rc] = await Promise.all([
        sb("appointments?select=customer_name,customer_phone,start_at,status&status=in.(pending,confirmed)&order=start_at.desc&limit=1000"),
        sb("customers?select=id,name,phone&order=created_at.desc&limit=1000")
      ]);
      if (!ra.ok || !rc.ok) return json(500, { error: "Error de base de datos." });
      const turnos = await ra.json();
      const cuentas = await rc.json();
      const ahora = Date.now();
      const mapa = new Map();
      for (const x of turnos) {
        const clave = waNumber(x.customer_phone).slice(-10);
        let c = mapa.get(clave);
        if (!c) {
          c = { name: x.customer_name, phone: x.customer_phone, total: 0, visitas: 0, ultima: null, proximo: null, cid: null };
          mapa.set(clave, c);
        }
        const t = new Date(x.start_at).getTime();
        c.total++;
        if (t <= ahora) {
          if (x.status === "confirmed") {
            c.visitas++;
            if (!c.ultima || t > new Date(c.ultima).getTime()) c.ultima = x.start_at;
          }
        } else if (!c.proximo || t < new Date(c.proximo).getTime()) {
          c.proximo = x.start_at;
        }
      }
      for (const u of cuentas) {
        const clave = waNumber(u.phone).slice(-10);
        const c = mapa.get(clave) || { name: u.name, phone: u.phone, total: 0, visitas: 0, ultima: null, proximo: null };
        c.cid = u.id;
        mapa.set(clave, c);
      }
      return json(200, { clientes: [...mapa.values()] });
    }

    if (A === "set") {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id < 1 || !DESDE[b.to]) return json(400, { error: "Datos inválidos." });
      const r = await sb(`appointments?id=eq.${id}&status=eq.${DESDE[b.to]}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: b.to })
      });
      if (!r.ok) return json(500, { error: "No se pudo actualizar el turno." });
      const filas = await r.json();
      if (!filas.length) return json(409, { error: "Ese turno ya cambió de estado. Se actualiza la lista." });
      // Aviso al celular del cliente
      await avisarCliente(filas[0].customer_id, avisoEstado(filas[0], b.to));
      return json(200, { ok: true });
    }

    if (A === "reset") {
      const cid = Number(b.cid);
      const pass = String(b.password || "");
      if (!Number.isInteger(cid) || cid < 1) return json(400, { error: "Cliente inválido." });
      if (pass.length < 6 || pass.length > 100) return json(400, { error: "La contraseña debe tener al menos 6 caracteres." });
      const r = await sb(`customers?id=eq.${cid}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ pass_hash: hashPass(pass) })
      });
      return r.ok ? json(200, { ok: true }) : json(500, { error: "No se pudo cambiar la contraseña." });
    }

    if (A === "push") {
      const ok = await guardarSub({ role: "staff", who: ses.who }, b.sub);
      return ok ? json(200, { ok: true }) : json(400, { error: "No se pudieron activar los avisos en este celular." });
    }

    return json(400, { error: "Acción inválida." });
  } catch (e) {
    const detalle = `${e.name}: ${String(e.message)}`
      .slice(0, 120)
      .replace(/sb_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+/g, "***");
    return json(500, { error: "Error del servidor (" + detalle + ")" });
  }
};
