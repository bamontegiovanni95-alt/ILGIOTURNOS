const { json, sb, STAFF, SERVICES, validSlot } = require("./_shared");

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

    // libera el horario si había un turno cancelado
    await sb(
      `appointments?location=eq.${b.location}&barber=eq.${b.barber}&start_at=eq.${encodeURIComponent(startAt)}&status=eq.cancelled`,
      { method: "DELETE" }
    );

    const r = await sb("appointments", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        location: b.location,
        barber: b.barber,
        start_at: startAt,
        service: b.service,
        price: SERVICES[b.service],
        duration_minutes: 30,
        customer_name: name,
        customer_phone: phone
      })
    });

    if (r.status === 409) return json(409, { error: "Ese horario se acaba de ocupar. Elegí otro." });
    if (!r.ok) return json(500, { error: "No se pudo registrar el turno." });
    return json(200, { ok: true });
  } catch (e) {
    return json(500, { error: "Error del servidor." });
  }
};
