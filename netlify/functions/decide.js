const { sb, tokenOk, esc, cap, LOCALES, fechaLarga, waLink, baseUrl } = require("./_shared");

const ESTADOS = { pending: "pendiente", confirmed: "confirmado", rejected: "rechazado", cancelled: "cancelado" };

const CSS =
  "body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f4ee;color:#1e2823}" +
  ".w{max-width:480px;margin:0 auto;padding:28px 18px}h1{font-size:22px;color:#183d30;margin:0 0 14px}" +
  ".box{background:#fff;border:1px solid #e6e8e2;border-radius:12px;padding:16px;line-height:1.7;margin-bottom:18px}" +
  ".b{display:block;width:100%;text-align:center;border:0;border-radius:10px;padding:16px;font-size:17px;font-weight:700;color:#fff;text-decoration:none;cursor:pointer;margin-top:10px;font-family:inherit}" +
  ".ok{background:#183d30}.no{background:#a3372a}.wa{background:#1f9d55}" +
  ".small{font-size:13px;color:#6e7771;text-align:center;margin-top:18px}.small a{color:#183d30}";

const page = (statusCode, title, inner) => ({
  statusCode,
  headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  body: `<!doctype html><html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="w">${inner}</div></body></html>`
});

const detalle = (t) =>
  `<div class="box"><b>${esc(fechaLarga(t.start_at))}</b><br>Local: ${esc(LOCALES[t.location] || t.location)}<br>Barbero: ${esc(cap(t.barber))}<br>Servicio: ${esc(t.service)} ($${Number(t.price).toLocaleString("es-AR")})<br>Cliente: ${esc(t.customer_name)}<br>WhatsApp: ${esc(t.customer_phone)}</div>`;

const waText = (t, estado, base) =>
  estado === "confirmed"
    ? `Hola ${t.customer_name}! Tu turno en Il Gio (${LOCALES[t.location]}) con ${cap(t.barber)} el ${fechaLarga(t.start_at)} está CONFIRMADO ✅. ¡Te esperamos!`
    : `Hola ${t.customer_name}, lamentablemente no podemos atender tu turno del ${fechaLarga(t.start_at)} en Il Gio. Podés elegir otro horario acá: ${base}`;

const botonWa = (t, estado, base) =>
  `<a class="b wa" href="${esc(waLink(t.customer_phone, waText(t, estado, base)))}">Avisar al cliente por WhatsApp</a>`;

exports.handler = async (event) => {
  try {
    const esPost = event.httpMethod === "POST";
    let p;
    if (esPost) {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
      p = Object.fromEntries(new URLSearchParams(raw));
    } else {
      p = event.queryStringParameters || {};
    }

    const id = Number(p.id);
    if (!Number.isInteger(id) || id < 1 || !tokenOk(id, p.t))
      return page(403, "Enlace inválido", "<h1>Enlace inválido</h1><div class=\"box\">Este enlace no es válido o está incompleto. Usá los botones del mail original.</div>");

    const r = await sb(`appointments?id=eq.${id}&select=*`);
    const filas = r.ok ? await r.json() : null;
    if (!filas || !filas.length)
      return page(404, "No encontrado", "<h1>Turno no encontrado</h1><div class=\"box\">Puede que ya haya sido eliminado.</div>");

    const t = filas[0];
    const base = baseUrl(event);
    const accion = p.a === "reject" ? "reject" : "confirm";

    // Ya respondido antes
    const yaRespondido = () =>
      page(
        200,
        "Turno ya respondido",
        `<h1>Este turno ya está ${esc(ESTADOS[t.status] || t.status)}</h1>${detalle(t)}` +
          (t.status === "confirmed" || t.status === "rejected" ? botonWa(t, t.status, base) : "")
      );

    if (esPost) {
      if (t.status !== "pending") return yaRespondido();
      const nuevo = accion === "reject" ? "rejected" : "confirmed";
      const u = await sb(`appointments?id=eq.${id}&status=eq.pending`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: nuevo })
      });
      const filasU = u.ok ? await u.json() : [];
      if (!filasU.length) return yaRespondido();
      const bien = nuevo === "confirmed";
      return page(
        200,
        "Listo",
        `<h1>${bien ? "✅ Turno confirmado" : "❌ Turno rechazado"}</h1>${detalle(t)}<p>Avisale al cliente:</p>${botonWa(t, nuevo, base)}<p class="small"><a href="${esc(base)}/admin">Ver todos los turnos</a></p>`
      );
    }

    // GET: muestra el turno y pide el botón final (evita confirmar por error o por escáneres de mail)
    if (t.status !== "pending") return yaRespondido();
    const confirmar = accion === "confirm";
    const otro = `${base}/.netlify/functions/decide?id=${id}&t=${encodeURIComponent(p.t)}&a=${confirmar ? "reject" : "confirm"}`;
    return page(
      200,
      "Turno pendiente",
      `<h1>${confirmar ? "¿Confirmar este turno?" : "¿Rechazar este turno?"}</h1>${detalle(t)}` +
        `<form method="POST" action="/.netlify/functions/decide"><input type="hidden" name="id" value="${id}"><input type="hidden" name="t" value="${esc(p.t)}"><input type="hidden" name="a" value="${accion}"><button class="b ${confirmar ? "ok" : "no"}" type="submit">${confirmar ? "✅ Sí, confirmar turno" : "❌ Sí, rechazar turno"}</button></form>` +
        `<p class="small"><a href="${esc(otro)}">${confirmar ? "Mejor rechazarlo" : "Mejor confirmarlo"}</a></p>`
    );
  } catch (e) {
    return page(500, "Error", "<h1>Error del servidor</h1><div class=\"box\">Probá de nuevo en un minuto.</div>");
  }
};
