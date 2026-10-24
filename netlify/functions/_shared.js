const STAFF = {
  boedo: { lautaro: [9, 14], julieta: [14, 20], brai: [9, 20] },
  matheu: { thiago: [11, 20] }
};
const SERVICES = { "Corte": 18000, "Corte y barba": 22000, "Barba": 14000 };

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

// Limpia espacios, saltos de línea o texto de más pegado en las variables
const limpiar = (valor, patron) => {
  const s = String(valor || "");
  const m = s.match(patron);
  return (m ? m[0] : s).trim();
};
const sbUrl = () =>
  limpiar(process.env.SUPABASE_URL, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
const sbKey = () =>
  limpiar(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    /sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/
  );

const sb = (path, options = {}) =>
  fetch(`${sbUrl()}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: sbKey(),
      Authorization: `Bearer ${sbKey()}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

const validSlot = (location, barber, time) => {
  const hours = STAFF[location] && STAFF[location][barber];
  if (!hours || !/^\d{2}:(00|30)$/.test(time)) return false;
  const [h, m] = time.split(":").map(Number);
  const mins = h * 60 + m;
  return mins >= hours[0] * 60 && mins + 30 <= hours[1] * 60;
};

module.exports = { STAFF, SERVICES, json, sb, validSlot };
