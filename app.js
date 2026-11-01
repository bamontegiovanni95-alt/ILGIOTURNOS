const $ = (id) => document.getElementById(id);
const staff = {
  boedo: [
    { id: "lautaro", name: "Lautaro", start: 9, end: 14 },
    { id: "julieta", name: "Julieta", start: 14, end: 20 }
  ],
  matheu: [{ id: "thiago", name: "Thiago", start: 11, end: 20 }]
};
const loc = $("location"), barber = $("barber"), date = $("date"), slots = $("slots"), time = $("selectedTime"), msg = $("message");
let chosen = "", token = "", yo = null, registro = false, instalador = null;
try { token = localStorage.getItem("ilgio_token") || ""; } catch (e) {}

const now = new Date();
date.min = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const service = () => {
  const r = document.querySelector('input[name="service"]:checked');
  return { name: r.value, price: +r.dataset.price };
};
const money = (n) => new Intl.NumberFormat("es-AR").format(n);
const clock = (n) => String(n).padStart(2, "0");
function note(t, c) { msg.textContent = t; msg.className = "show " + c; }
function clear() { msg.textContent = ""; msg.className = ""; }
function caja(el, texto, tipo) { el.textContent = texto || ""; el.className = texto ? "msgbox show " + tipo : "msgbox"; }
function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}
function summary() { const s = service(); $("summary").textContent = `${s.name} · $${money(s.price)} · 30 min`; }

// ---------- Conexión con el servidor ----------
async function api(accion, datos = {}) {
  const r = await fetch("/.netlify/functions/cuenta", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify({ accion, ...datos })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Algo salió mal. Probá de nuevo."), { status: r.status });
  return d;
}

// ---------- Cuenta ----------
function pintarSesion() {
  const dentro = !!yo;
  $("vistaAuth").hidden = dentro;
  $("vistaYo").hidden = !dentro;
  $("needLogin").hidden = dentro;
  $("submit").disabled = !dentro;
  const nombre = dentro ? yo.name.split(" ")[0] : "";
  $("navCuenta").textContent = dentro ? "Hola, " + nombre + " ↗" : "Ingresar ↗";
  if (dentro) {
    $("yoSaludo").textContent = "Hola, " + nombre + " 👋";
    $("yoTel").textContent = "WhatsApp: " + yo.phone;
  }
}
function guardarSesion(d) {
  token = d.token;
  yo = { name: d.name, phone: d.phone };
  try { localStorage.setItem("ilgio_token", token); } catch (e) {}
  pintarSesion();
  cargarTurnos();
  renovarAvisos();
  estadoAvisos();
}
function cerrarSesion() {
  token = ""; yo = null;
  try { localStorage.removeItem("ilgio_token"); } catch (e) {}
  $("misTurnos").innerHTML = "";
  modo(false);
  pintarSesion();
}
function modo(esRegistro) {
  registro = esRegistro;
  $("tabIngreso").classList.toggle("on", !esRegistro);
  $("tabRegistro").classList.toggle("on", esRegistro);
  $("campoNombre").hidden = !esRegistro;
  $("olvide").hidden = esRegistro;
  $("cSubmit").textContent = esRegistro ? "Crear cuenta →" : "Ingresar →";
  $("cPass").autocomplete = esRegistro ? "new-password" : "current-password";
  caja($("cMsg"), "");
}
$("tabIngreso").onclick = () => modo(false);
$("tabRegistro").onclick = () => modo(true);
$("btnSalir").onclick = cerrarSesion;

$("authForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("cName").value.trim(), phone = $("cPhone").value.trim(), password = $("cPass").value;
  if (registro && name.length < 2) return caja($("cMsg"), "Escribí tu nombre.", "error");
  if (phone.replace(/\D/g, "").length < 8) return caja($("cMsg"), "Revisá tu número de WhatsApp.", "error");
  if (password.length < 6) return caja($("cMsg"), "La contraseña debe tener al menos 6 caracteres.", "error");
  $("cSubmit").disabled = true;
  caja($("cMsg"), "");
  try {
    const d = await api(registro ? "registro" : "ingreso", { name, phone, password });
    $("cPass").value = "";
    guardarSesion(d);
    location.hash = "#reservar";
  } catch (err) {
    caja($("cMsg"), err.message, "error");
  } finally {
    $("cSubmit").disabled = false;
  }
};

// ---------- Mis turnos ----------
async function cargarTurnos() {
  const L = $("misTurnos");
  try {
    const { turnos } = await api("turnos");
    L.innerHTML = "";
    if (!turnos.length) { L.appendChild(el("div", "fine", "Todavía no tenés turnos. ¡Reservá el primero!")); return; }
    turnos.forEach((t) => {
      const c = el("div", "turno");
      c.appendChild(el("b", "", t.cuando));
      c.appendChild(el("span", "est " + (t.estado === "confirmed" ? "c" : "p"), t.estado === "confirmed" ? "Confirmado ✓" : "Esperando confirmación"));
      c.appendChild(el("div", "", `${t.servicio} · $${money(t.precio)}`));
      c.appendChild(el("div", "", `${t.barbero} · ${t.local}`));
      if (t.futuro) {
        const b = el("button", "cancelar", "Cancelar turno");
        b.type = "button";
        b.onclick = async () => {
          if (!confirm("¿Querés cancelar este turno?")) return;
          try { await api("cancelar", { id: t.id }); } catch (err) { alert(err.message); }
          cargarTurnos();
          getSlots();
        };
        c.appendChild(b);
      }
      L.appendChild(c);
    });
  } catch (err) {
    if (err.status === 401) cerrarSesion();
  }
}

// ---------- Instalar la app ----------
const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const instalada = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
function pintarInstalacion() {
  if (instalada) { $("appbar").hidden = true; return; }
  $("appbar").hidden = false;
  $("appmsg").textContent = esIOS
    ? "Instalá la app en tu iPhone: tocá el botón Compartir (el cuadrado con la flecha) y elegí «Agregar a inicio»."
    : "Instalá la app en tu celular para reservar más rápido y recibir avisos de tus turnos.";
}
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  instalador = e;
  $("btnInstalar").hidden = false;
});
$("btnInstalar").onclick = async () => {
  if (!instalador) return;
  instalador.prompt();
  await instalador.userChoice;
  instalador = null;
  $("btnInstalar").hidden = true;
};
window.addEventListener("appinstalled", () => { $("appbar").hidden = true; });

// ---------- Avisos al celular ----------
const puedePush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const aBytes = (b64) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
async function suscripcion() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function estadoAvisos() {
  const txt = $("avisoEstado"), btn = $("btnAvisos");
  if (!puedePush) {
    btn.hidden = true;
    txt.textContent = esIOS && !instalada
      ? "Para recibir avisos en iPhone, primero instalá la app (Compartir → Agregar a inicio) y abrila desde el ícono."
      : "Este navegador no permite avisos.";
    return;
  }
  if (Notification.permission === "denied") {
    btn.hidden = true;
    txt.textContent = "Los avisos están bloqueados. Activalos desde los ajustes de notificaciones del celular.";
    return;
  }
  let activo = false;
  if (Notification.permission === "granted") { try { activo = !!(await suscripcion()); } catch (e) {} }
  btn.hidden = activo;
  txt.textContent = activo
    ? "🔔 Avisos activados: te avisamos cuando el local confirme tu turno."
    : "Activá los avisos para enterarte enseguida cuando el local confirme tu turno.";
}
async function activarAvisos() {
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") throw new Error("No se activaron los avisos.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api("vapid");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(key) });
  }
  await api("push", { sub: sub.toJSON() });
}
// Si el celular ya tenía avisos, los vincula a la cuenta que acaba de ingresar
async function renovarAvisos() {
  if (!puedePush || Notification.permission !== "granted") return;
  try { const sub = await suscripcion(); if (sub) await api("push", { sub: sub.toJSON() }); } catch (e) {}
}
$("btnAvisos").onclick = async () => {
  $("btnAvisos").disabled = true;
  try { await activarAvisos(); } catch (err) { $("avisoEstado").textContent = err.message; }
  $("btnAvisos").disabled = false;
  estadoAvisos();
};

// ---------- Reservas ----------
function setBarbers() {
  const list = staff[loc.value] || [];
  barber.innerHTML = '<option value="">Seleccionar barbero</option>' + list.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  barber.disabled = !list.length;
  chosen = ""; time.value = "";
  slots.innerHTML = '<div class="empty">Elegí barbero y día para consultar horarios.</div>';
  clear();
}
async function getSlots() {
  chosen = ""; time.value = ""; clear();
  if (!loc.value || !barber.value || !date.value) {
    slots.innerHTML = '<div class="empty">Elegí local, barbero y día para consultar horarios.</div>';
    return;
  }
  const b = (staff[loc.value] || []).find((x) => x.id === barber.value);
  const all = [];
  for (let m = b.start * 60; m + 30 <= b.end * 60; m += 30) all.push(`${clock(Math.floor(m / 60))}:${clock(m % 60)}`);
  $("hint").textContent = "Consultando…";
  try {
    const r = await fetch(`/.netlify/functions/availability?location=${loc.value}&barber=${barber.value}&date=${date.value}`);
    if (!r.ok) throw Error();
    const data = await r.json(), booked = new Set(data.booked || []);
    const d = new Date(), today = `${d.getFullYear()}-${clock(d.getMonth() + 1)}-${clock(d.getDate())}`;
    const free = all.filter((t) => !booked.has(t) && !(date.value === today && t <= `${clock(d.getHours())}:${clock(d.getMinutes())}`));
    slots.innerHTML = free.length
      ? free.map((t) => `<button type="button" class="slot" data-time="${t}">${t}</button>`).join("")
      : '<div class="empty">No quedan horarios libres. Probá otra fecha.</div>';
    slots.querySelectorAll("button").forEach((btn) => (btn.onclick = () => {
      slots.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      btn.classList.add("selected");
      chosen = btn.dataset.time; time.value = chosen; clear();
    }));
    $("hint").textContent = `${free.length} horarios disponibles`;
  } catch {
    slots.innerHTML = '<div class="empty">No pudimos cargar los horarios. Probá de nuevo en un minuto.</div>';
    $("hint").textContent = "Sin conexión";
  }
}
loc.onchange = setBarbers; barber.onchange = getSlots; date.onchange = getSlots;
document.querySelectorAll('[name="service"]').forEach((x) => (x.onchange = summary));

$("bookingForm").onsubmit = async (e) => {
  e.preventDefault(); clear();
  if (!yo) { note("Ingresá o creá tu cuenta para reservar.", "error"); location.hash = "#cuenta"; return; }
  if (!chosen) { note("Elegí un horario disponible antes de continuar.", "error"); return; }
  const s = service();
  const body = { location: loc.value, barber: barber.value, date: date.value, time: chosen, service: s.name };
  $("submit").disabled = true; $("submit").textContent = "Enviando…";
  try {
    const r = await fetch("/.netlify/functions/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) cerrarSesion();
    if (!r.ok) throw Error(data.error || "No se pudo registrar el turno.");
    const person = staff[body.location].find((x) => x.id === body.barber);
    await getSlots();
    cargarTurnos();
    const avisos = puedePush && Notification.permission === "granted" ? "" : " Activá los avisos en «Tu cuenta» para enterarte enseguida.";
    note(`¡Solicitud enviada! ${body.date} a las ${body.time} con ${person.name}. ${s.name} · $${money(s.price)}. El local va a confirmar tu turno.${avisos}`, "success");
  } catch (err) {
    await getSlots();
    note(err.message, "error");
  } finally {
    $("submit").disabled = !yo;
    $("submit").textContent = "Solicitar turno →";
  }
};

// ---------- Inicio ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
(async function iniciar() {
  summary();
  pintarInstalacion();
  pintarSesion();
  if (token) {
    try { yo = await api("yo"); } catch (err) { if (err.status === 401) cerrarSesion(); }
    pintarSesion();
    if (yo) { cargarTurnos(); renovarAvisos(); }
  }
  estadoAvisos();
})();
