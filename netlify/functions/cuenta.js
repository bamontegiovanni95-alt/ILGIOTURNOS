const {
  json, sb, LOCALES, cap, fechaLarga, fechaCorta, waNumber, emitir, leer, tokenDe, hashPass, checkPass, pausa
} = require("./_shared");
const { clavePublica, guardarSub, avisarPersonal } = require("./_push");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Método no permitido." });
  try {
    const b = JSON.parse(event.body || "{}");
    const A = b.accion;

    if (A === "vapid") return json(200, { key: await clavePublica() });

    if (A === "registro") {
      const name = String(b.name || "").trim().slice(0, 60);
      const phone = String(b.phone || "").trim().slice(0, 30);
      const pass = String(b.password || "");
      if (name.length < 2) return json(400, { error: "Escribí tu nombre." });
      if (phone.replace(/\D/g, "").length < 8) return json(400, { error: "Revisá tu número de WhatsApp." });
      if (pass.length < 6 || pass.length > 100) return json(400, { error: "La contraseña debe tener al menos 6 caracteres." });
      const key = waNumber(phone);
      const yaExiste = { error: "Ya hay una cuenta con ese teléfono. Ingresá con tu contraseña." };
      const ya = await sb(`customers?phone_key=eq.${encodeURIComponent(key)}&select=id`);
      if (ya.ok && (await ya.json()).length) return json(409, yaExiste);
      const r = await sb("customers?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ name, phone, phone_key: key, pass_hash: hashPass(pass) })
      });
      if (r.status === 409) return json(409, yaExiste);
      if (!r.ok) return json(500, { error: "No se pudo crear la cuenta." });
      const [c] = await r.json();
      return json(200, { token: emitir({ cid: c.id }, 90, "cliente"), name, phone });
    }

    if (A === "ingreso") {
      const key = waNumber(String(b.phone || ""));
      const r = await sb(`customers?phone_key=eq.${encodeURIComponent(key)}&select=id,name,phone,pass_hash`);
      const c = r.ok ? (await r.json())[0] : null;
      if (!c || !checkPass(b.password, c.pass_hash)) {
        await pausa(700);
        return json(401, { error: "Teléfono o contraseña incorrectos." });
      }
      return json(200, { token: emitir({ cid: c.id }, 90, "cliente"), name: c.name, phone: c.phone });
    }

    // Lo que sigue requiere haber ingresado
    const ses = leer(tokenDe(event), "cliente");
    if (!ses) return json(401, { error: "Tu sesión venció. Ingresá de nuevo." });
    const cid = Number(ses.cid);

    if (A === "yo") {
      const r = await sb(`customers?id=eq.${cid}&select=name,phone`);
      const c = r.ok ? (await r.json())[0] : null;
      if (!c) return json(401, { error: "Tu sesión venció. Ingresá de nuevo." });
      return json(200, c);
    }

    if (A === "turnos") {
      const desde = encodeURIComponent(new Date(Date.now() - 2 * 3600 * 1000).toISOString());
      const r = await sb(
        `appointments?select=id,location,barber,start_at,service,price,status&customer_id=eq.${cid}&status=in.(pending,confirmed)&start_at=gte.${desde}&order=start_at.asc`
      );
      if (!r.ok) return json(500, { error: "No se pudieron cargar tus turnos." });
      const filas = await r.json();
      const ahora = Date.now();
      return json(200, {
        turnos: filas.map((t) => ({
          id: t.id,
          cuando: fechaLarga(t.start_at),
          local: LOCALES[t.location] || t.location,
          barbero: cap(t.barber),
          servicio: t.service,
          precio: t.price,
          estado: t.status,
          futuro: new Date(t.start_at).getTime() > ahora
        }))
      });
    }

    if (A === "cancelar") {
      const id = Number(b.id);
      if (!Number.isInteger(id) || id < 1) return json(400, { error: "Turno inválido." });
      const ahora = encodeURIComponent(new Date().toISOString());
      const r = await sb(
        `appointments?id=eq.${id}&customer_id=eq.${cid}&status=in.(pending,confirmed)&start_at=gt.${ahora}`,
        { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "cancelled" }) }
      );
      const filas = r.ok ? await r.json() : [];
      if (!filas.length) return json(409, { error: "No se pudo cancelar: el turno ya pasó o ya estaba cancelado." });
      const t = filas[0];
      await avisarPersonal(t.barber, {
        title: "Turno cancelado",
        body: `${t.customer_name} canceló: ${fechaCorta(t.start_at)} · ${cap(t.barber)}`,
        url: "/admin",
        tag: "turno-" + t.id
      });
      return json(200, { ok: true });
    }

    if (A === "push") {
      const ok = await guardarSub({ role: "customer", customer_id: cid }, b.sub);
      return ok ? json(200, { ok: true }) : json(400, { error: "No se pudieron activar los avisos en este celular." });
    }

    return json(400, { error: "Acción inválida." });
  } catch (e) {
    return json(500, { error: "Error del servidor." });
  }
};
