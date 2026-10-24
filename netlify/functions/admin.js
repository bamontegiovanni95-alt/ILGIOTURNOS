const crypto = require("crypto");
const { json, sb } = require("./_shared");

const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
const igual = (a, b) => crypto.timingSafeEqual(hash(a), hash(b));

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
        `appointments?select=id,location,barber,start_at,service,price,customer_name,customer_phone&status=eq.confirmed&start_at=gte.${from}&start_at=lte.${to}&order=start_at.asc`
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
          phone: x.customer_phone
        };
      });
      return json(200, { turnos });
    }

    if (b.action === "cancel") {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id < 1) return json(400, { error: "Turno inválido." });
      const r = await sb(`appointments?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled" })
      });
      if (!r.ok) return json(500, { error: "No se pudo cancelar." });
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
