const {
  json, sb, STAFF, SERVICES, LOCALES, validSlot, esc, cap, firmar, fechaLarga, baseUrl
} = require("./_shared");

// Mail del dueño: recibe TODOS los turnos y confirma o rechaza
const DUENO = "barberiailgio2031@gmail.com";

async function avisar(event, id, b, name, phone, startAt) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("Falta RESEND_API_KEY: no se envió el mail al dueño.");
    return;
  }
  const to = process.env.NOTIFY_EMAIL || DUENO;
  const base = baseUrl(event);
  const t = firmar(id);
  const confirmar = `${base}/.netlify/functions/decide?id=${id}&t=${t}&a=confirm`;
  const rechazar = `${base}/.netlify/functions/decide?id=${id}&t=${t}&a=reject`;
  const local = LOCALES[b.location] || b.location;
  const fecha = fechaLarga(startAt);
  const html = `
  <div style="font-family:system-ui,Arial,sans-serif;max-width:480px">
    <h2 style="color:#183d30">Nuevo turno para confirmar</h2>
    <p style="font-size:18px"><b>${esc(fecha)}</b></p>
    <p>Local: ${esc(local)}<br>Barbero: ${esc(cap(b.barber))}<br>Servicio: ${esc(b.service)} ($${SERVICES[b.service].toLocaleString("es-AR")})<br>Cliente: ${esc(name)}<br>WhatsApp: ${esc(phone)}</p>
    <p style="margin-top:22px">
      <a href="${esc(confirmar)}" style="background:#183d30;color:#ffffff;padding:13px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">✅ Confirmar</a>
      &nbsp;
      <a href="${esc(rechazar)}" style="background:#a3372a;color:#ffffff;padding:13px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:bold">❌ Rechazar</a>
    </p>
    <p style="color:#777;font-size:12px">Al tocar un botón se abre una página para confirmar tu decisión. Mientras no respondas, el horario queda reservado como pendiente.</p>
  </div>`;
  try {
    const resp = await Promise.race([
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Il Gio Turnos <onboarding@resend.dev>",
          to: [to],
          subject: `Turno pendiente: ${fecha} - ${cap(b.barber)} (${local})`,
          html
        })
      }),
      new Promise((resolve) => setTimeout(resolve, 6000))
    ]);
    if (resp && !resp.ok) console.error("Resend rechazó el mail:", resp.status, await resp.text());
  } catch (e) {
    console.error("No se pudo enviar el mail:", e.name);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const b = JSON.parse(event.body || "{}");
    const name = String(b.name || "").trim().slice(0, 80);
    const phone = String(b.phone || "").trim().slice(0, 30);

    if (!STAFF[b.location] || !STAFF[b.location][b.barber] || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || ""))
      return json(400, { error: "Datos inválidos." });
    if (!(b.service in SERVICES)) return json(400, { error: "Servicio inválido." });
    if (!validSlot(b.location, b.barber, b.time)) return json(400, { error: "Horario inválido." });
    if (name.length < 2 || phone.replace(/\D/g, "").length < 8)
      return json(400, { error: "Revisá tu nombre y tu WhatsApp." });

    const startAt = `${b.date}T${b.time}:00-03:00`;
    if (new Date(startAt).getTime() <= Date.now())
      return json(400, { error: "Ese horario ya pasó." });

    // libera el horario si había un turno cancelado o rechazado
    await sb(
      `appointments?location=eq.${b.location}&barber=eq.${b.barber}&start_at=eq.${encodeURIComponent(startAt)}&status=in.(cancelled,rejected)`,
      { method: "DELETE" }
    );

    const r = await sb("appointments?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        location: b.location,
        barber: b.barber,
        start_at: startAt,
        service: b.service,
        price: SERVICES[b.service],
        duration_minutes: 30,
        customer_name: name,
        customer_phone: phone,
        status: "pending"
      })
    });

    if (r.status === 409) return json(409, { error: "Ese horario se acaba de ocupar. Elegí otro." });
    if (!r.ok) return json(500, { error: "No se pudo registrar el turno." });

    const filas = await r.json();
    const id = filas && filas[0] && filas[0].id;
    if (id) await avisar(event, id, b, name, phone, startAt);
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "Error del servidor." });
  }
};
