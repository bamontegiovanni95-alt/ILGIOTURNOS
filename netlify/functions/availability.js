const { json, sb, STAFF } = require("./_shared");

exports.handler = async (event) => {
  try {
    const { location, barber, date } = event.queryStringParameters || {};
    if (!STAFF[location] || !STAFF[location][barber] || !/^\d{4}-\d{2}-\d{2}$/.test(date || ""))
      return json(400, { error: "Datos inválidos." });

    const from = `${date}T00:00:00-03:00`;
    const to = `${date}T23:59:59-03:00`;
    // Los turnos pendientes también ocupan el horario
    const r = await sb(
      `appointments?select=start_at&location=eq.${location}&barber=eq.${barber}&status=in.(pending,confirmed)&start_at=gte.${encodeURIComponent(from)}&start_at=lte.${encodeURIComponent(to)}`
    );
    if (!r.ok) return json(500, { error: "Error de base de datos." });

    const rows = await r.json();
    const booked = rows.map((x) => {
      const d = new Date(new Date(x.start_at).getTime() - 3 * 3600 * 1000); // hora Argentina
      return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    });
    return json(200, { booked });
  } catch (e) {
    return json(500, { error: "Error del servidor." });
  }
};
