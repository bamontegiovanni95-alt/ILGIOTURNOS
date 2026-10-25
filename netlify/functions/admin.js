const crypto = require("crypto");
const { json, sb } = require("./_shared");

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
    if (!igual(b.password || "", secret)) {
      await new Promise((r) => setTimeout(r, 800));
      return json(401, { error: "Contraseña incorrecta." });
    }

    if (b.action === "list") {
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

    if (b.action === "set") {
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
      return json(200, { ok: true });
    }

    return json(400, { error: "Acción inválida." });
  } catch (e) {
    const detalle = `${e.name}: ${String(e.message)}`
      .slice(0, 120)
      .replace(/sb_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+/g, "***");
    return json(500, { error: "Error del servidor (" + detalle + ")" });
  }
};
