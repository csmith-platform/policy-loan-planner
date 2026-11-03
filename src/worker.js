const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function allowedEmails(env) { return new Set(String(env.ALLOWED_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)); }
function getUser(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLowerCase();
  if (!email || !allowedEmails(env).has(email)) return null;
  return { email, role: email === String(env.OWNER_EMAIL || "").trim().toLowerCase() ? "owner" : "member" };
}
function sameOrigin(request) { const origin = request.headers.get("Origin"); return !origin || origin === new URL(request.url).origin; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function cleanNote(value) { return String(value || "").trim().slice(0, 500); }
function mapLoan(row) { return { amount: row.principal_cents / 100, rate: row.annual_rate_bps / 10000, termYears: row.term_years, termMonths: row.term_months, frequency: row.frequency, firstDate: row.first_payment_date, updatedBy: row.updated_by, updatedAt: row.updated_at }; }
function mapEvent(row) { return { id: row.id, type: row.event_type, scheduledDate: row.scheduled_date, paymentDate: row.payment_date, amount: row.amount_cents / 100, note: row.note, createdBy: row.created_by, createdAt: row.created_at, voidedBy: row.voided_by, voidedAt: row.voided_at }; }
async function readBody(request) { if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) throw new Error("JSON request required"); return request.json(); }

async function getBootstrap(env, user) {
  const [loan, eventResult] = await Promise.all([env.DB.prepare("SELECT * FROM loan_settings WHERE id = 1").first(), env.DB.prepare("SELECT * FROM payment_events ORDER BY created_at DESC").all()]);
  if (!loan) return json({ error: "Loan settings have not been initialized" }, 503);
  return json({ user, loan: mapLoan(loan), events: eventResult.results.map(mapEvent) });
}

async function updateLoan(request, env, user) {
  const body = await readBody(request);
  const amount = Number(body.amount), rate = Number(body.rate), termYears = Math.floor(Number(body.termYears)), termMonths = Math.floor(Number(body.termMonths));
  if (!(amount > 0) || !(rate >= 0 && rate <= 1) || termYears < 0 || termMonths < 0 || termMonths > 11 || termYears * 12 + termMonths < 1 || !["weekly", "biweekly", "monthly"].includes(body.frequency) || !validDate(body.firstDate)) return json({ error: "Invalid loan settings" }, 400);
  await env.DB.prepare(`UPDATE loan_settings SET principal_cents = ?, annual_rate_bps = ?, term_years = ?, term_months = ?, frequency = ?, first_payment_date = ?, updated_by = ?, updated_at = datetime('now') WHERE id = 1`).bind(Math.round(amount * 100), Math.round(rate * 10000), termYears, termMonths, body.frequency, body.firstDate, user.email).run();
  return json({ loan: mapLoan(await env.DB.prepare("SELECT * FROM loan_settings WHERE id = 1").first()) });
}

async function createEvent(request, env, user) {
  const body = await readBody(request), type = String(body.type || "");
  if (!["extra", "manual", "missed"].includes(type)) return json({ error: "Invalid payment event type" }, 400);
  const scheduledDate = type === "missed" ? body.scheduledDate : null, paymentDate = type === "missed" ? null : body.paymentDate, amountCents = type === "missed" ? 0 : Math.round(Number(body.amount) * 100);
  if ((type === "missed" && !validDate(scheduledDate)) || (type !== "missed" && (!validDate(paymentDate) || amountCents <= 0))) return json({ error: "Invalid payment event" }, 400);
  if (type === "missed" && await env.DB.prepare("SELECT id FROM payment_events WHERE event_type = 'missed' AND scheduled_date = ? AND voided_at IS NULL").bind(scheduledDate).first()) return json({ error: "That scheduled payment is already marked missed" }, 409);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO payment_events (id, event_type, scheduled_date, payment_date, amount_cents, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, type, scheduledDate, paymentDate, amountCents, cleanNote(body.note), user.email).run();
  return json({ event: mapEvent(await env.DB.prepare("SELECT * FROM payment_events WHERE id = ?").bind(id).first()) }, 201);
}

async function voidEvent(id, env, user) {
  const result = await env.DB.prepare("UPDATE payment_events SET voided_by = ?, voided_at = datetime('now') WHERE id = ? AND voided_at IS NULL").bind(user.email, id).run();
  if (!result.meta.changes) return json({ error: "Active payment event not found" }, 404);
  return json({ event: mapEvent(await env.DB.prepare("SELECT * FROM payment_events WHERE id = ?").bind(id).first()) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!env.DB) return json({ error: "D1 binding DB is not configured" }, 503);
    const user = getUser(request, env);
    if (!user) return json({ error: "Cloudflare Access authentication required" }, 403);
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) return json({ error: "Cross-origin request blocked" }, 403);
    try {
      if (request.method === "GET" && url.pathname === "/api/bootstrap") return getBootstrap(env, user);
      if (request.method === "PUT" && url.pathname === "/api/loan") return updateLoan(request, env, user);
      if (request.method === "POST" && url.pathname === "/api/events") return createEvent(request, env, user);
      const match = url.pathname.match(/^\/api\/events\/([0-9a-f-]+)\/void$/i);
      if (request.method === "PATCH" && match) return voidEvent(match[1], env, user);
      return json({ error: "Not found" }, 404);
    } catch (error) { console.error(error); return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500); }
  },
};

