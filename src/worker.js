const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
const frequencyValues = new Set(["weekly", "biweekly", "monthly"]);
const statusValues = new Set(["active", "paid", "archived"]);

function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: jsonHeaders }); }
function getUser(request, env) {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim().toLowerCase();
  if (!email) return null;
  return { email, role: email === String(env.OWNER_EMAIL || "").trim().toLowerCase() ? "owner" : "member" };
}
function sameOrigin(request) { const origin = request.headers.get("Origin"); return !origin || origin === new URL(request.url).origin; }
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "")); }
function cleanText(value, max = 120) { return String(value || "").trim().slice(0, max); }
function cleanNote(value) { return cleanText(value, 500); }
function normalizeEmails(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(validEmail))].slice(0, 20);
}
function mapLoan(row) {
  return {
    id: row.id, name: row.name, borrowerName: row.borrower_name, amount: row.principal_cents / 100,
    rate: row.annual_rate_bps / 10000, termYears: row.term_years, termMonths: row.term_months,
    frequency: row.frequency, firstDate: row.first_payment_date, status: row.status,
    updatedBy: row.updated_by, updatedAt: row.updated_at
  };
}
function mapEvent(row) {
  return {
    id: row.id, loanId: row.loan_id, type: row.event_type, scheduledDate: row.scheduled_date,
    paymentDate: row.payment_date, amount: row.amount_cents / 100, note: row.note,
    createdBy: row.created_by, createdAt: row.created_at, voidedBy: row.voided_by, voidedAt: row.voided_at
  };
}
async function readBody(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) throw new Error("JSON request required");
  return request.json();
}
function parseLoan(body) {
  const amount = Number(body.amount), rate = Number(body.rate), termYears = Math.floor(Number(body.termYears)), termMonths = Math.floor(Number(body.termMonths));
  const name = cleanText(body.name), borrowerName = cleanText(body.borrowerName), status = cleanText(body.status || "active");
  if (!name || !(amount > 0) || !(rate >= 0 && rate <= 1) || termYears < 0 || termMonths < 0 || termMonths > 11 || termYears * 12 + termMonths < 1 || !frequencyValues.has(body.frequency) || !validDate(body.firstDate) || !statusValues.has(status)) return null;
  return { name, borrowerName, amountCents: Math.round(amount * 100), rateBps: Math.round(rate * 10000), termYears, termMonths, frequency: body.frequency, firstDate: body.firstDate, status };
}
async function canAccessLoan(env, loanId, user) {
  if (user.role === "owner") return Boolean(await env.DB.prepare("SELECT 1 FROM loans WHERE id = ?").bind(loanId).first());
  return Boolean(await env.DB.prepare("SELECT 1 FROM loan_members m JOIN loans l ON l.id = m.loan_id WHERE m.loan_id = ? AND m.email = ? AND l.status != 'archived'").bind(loanId, user.email).first());
}

async function listLoans(env, user) {
  const result = user.role === "owner"
    ? await env.DB.prepare("SELECT * FROM loans ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paid' THEN 1 ELSE 2 END, updated_at DESC, name").all()
    : await env.DB.prepare("SELECT l.* FROM loans l JOIN loan_members m ON m.loan_id = l.id WHERE m.email = ? AND l.status != 'archived' ORDER BY CASE l.status WHEN 'active' THEN 0 ELSE 1 END, l.updated_at DESC, l.name").bind(user.email).all();
  return result.results.map(mapLoan);
}

async function getBootstrap(env, user) { return json({ user, loans: await listLoans(env, user) }); }

async function getLoan(loanId, env, user) {
  if (!await canAccessLoan(env, loanId, user)) return json({ error: "Loan not found" }, 404);
  const [loan, eventResult, memberResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(loanId).first(),
    env.DB.prepare("SELECT * FROM payment_events WHERE loan_id = ? ORDER BY created_at DESC").bind(loanId).all(),
    user.role === "owner" ? env.DB.prepare("SELECT email, role, assigned_at FROM loan_members WHERE loan_id = ? ORDER BY email").bind(loanId).all() : Promise.resolve({ results: [] })
  ]);
  if (!loan) return json({ error: "Loan not found" }, 404);
  return json({ loan: mapLoan(loan), events: eventResult.results.map(mapEvent), members: memberResult.results });
}

async function createLoan(request, env, user) {
  if (user.role !== "owner") return json({ error: "Owner access required" }, 403);
  const body = await readBody(request), loan = parseLoan(body), rawEmails = Array.isArray(body.assignedEmails) ? body.assignedEmails.filter(Boolean) : [], emails = normalizeEmails(rawEmails);
  if (!loan || emails.length !== rawEmails.length) return json({ error: "Invalid loan details or assigned email" }, 400);
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare(`INSERT INTO loans (id, name, borrower_name, principal_cents, annual_rate_bps, term_years, term_months, frequency, first_payment_date, status, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, loan.name, loan.borrowerName, loan.amountCents, loan.rateBps, loan.termYears, loan.termMonths, loan.frequency, loan.firstDate, loan.status, user.email, user.email)];
  for (const email of emails) statements.push(env.DB.prepare("INSERT INTO loan_members (loan_id, email, role, assigned_by) VALUES (?, ?, 'borrower', ?)").bind(id, email, user.email));
  await env.DB.batch(statements);
  return json({ loan: mapLoan(await env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(id).first()) }, 201);
}

async function updateLoan(loanId, request, env, user) {
  if (user.role !== "owner") return json({ error: "Owner access required" }, 403);
  const body = await readBody(request), loan = parseLoan(body), rawEmails = Array.isArray(body.assignedEmails) ? body.assignedEmails.filter(Boolean) : [], emails = normalizeEmails(rawEmails);
  if (!loan || !Array.isArray(body.assignedEmails) || emails.length !== rawEmails.length) return json({ error: "Invalid loan details or assigned email" }, 400);
  if (!await env.DB.prepare("SELECT id FROM loans WHERE id = ?").bind(loanId).first()) return json({ error: "Loan not found" }, 404);
  const statements = [
    env.DB.prepare(`UPDATE loans SET name = ?, borrower_name = ?, principal_cents = ?, annual_rate_bps = ?, term_years = ?, term_months = ?, frequency = ?, first_payment_date = ?, status = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`).bind(loan.name, loan.borrowerName, loan.amountCents, loan.rateBps, loan.termYears, loan.termMonths, loan.frequency, loan.firstDate, loan.status, user.email, loanId),
    env.DB.prepare("DELETE FROM loan_members WHERE loan_id = ?").bind(loanId)
  ];
  for (const email of emails) statements.push(env.DB.prepare("INSERT INTO loan_members (loan_id, email, role, assigned_by) VALUES (?, ?, 'borrower', ?)").bind(loanId, email, user.email));
  await env.DB.batch(statements);
  return getLoan(loanId, env, user);
}

async function createEvent(loanId, request, env, user) {
  if (!await canAccessLoan(env, loanId, user)) return json({ error: "Loan not found" }, 404);
  const body = await readBody(request), type = String(body.type || "");
  if (!["extra", "manual", "missed"].includes(type)) return json({ error: "Invalid payment event type" }, 400);
  const scheduledDate = type === "missed" ? body.scheduledDate : null, paymentDate = type === "missed" ? null : body.paymentDate, amountCents = type === "missed" ? 0 : Math.round(Number(body.amount) * 100);
  if ((type === "missed" && !validDate(scheduledDate)) || (type !== "missed" && (!validDate(paymentDate) || amountCents <= 0))) return json({ error: "Invalid payment event" }, 400);
  if (type === "missed" && await env.DB.prepare("SELECT id FROM payment_events WHERE loan_id = ? AND event_type = 'missed' AND scheduled_date = ? AND voided_at IS NULL").bind(loanId, scheduledDate).first()) return json({ error: "That scheduled payment is already marked missed" }, 409);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO payment_events (id, loan_id, event_type, scheduled_date, payment_date, amount_cents, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, loanId, type, scheduledDate, paymentDate, amountCents, cleanNote(body.note), user.email).run();
  return json({ event: mapEvent(await env.DB.prepare("SELECT * FROM payment_events WHERE id = ?").bind(id).first()) }, 201);
}

async function voidEvent(loanId, id, env, user) {
  if (user.role !== "owner") return json({ error: "Only the owner can void or restore payment records" }, 403);
  const result = await env.DB.prepare("UPDATE payment_events SET voided_by = ?, voided_at = datetime('now') WHERE id = ? AND loan_id = ? AND voided_at IS NULL").bind(user.email, id, loanId).run();
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
      if (request.method === "POST" && url.pathname === "/api/loans") return createLoan(request, env, user);
      const loanMatch = url.pathname.match(/^\/api\/loans\/([0-9a-z-]+)$/i);
      if (loanMatch && request.method === "GET") return getLoan(loanMatch[1], env, user);
      if (loanMatch && request.method === "PUT") return updateLoan(loanMatch[1], request, env, user);
      const eventsMatch = url.pathname.match(/^\/api\/loans\/([0-9a-z-]+)\/events$/i);
      if (eventsMatch && request.method === "POST") return createEvent(eventsMatch[1], request, env, user);
      const voidMatch = url.pathname.match(/^\/api\/loans\/([0-9a-z-]+)\/events\/([0-9a-f-]+)\/void$/i);
      if (voidMatch && request.method === "PATCH") return voidEvent(voidMatch[1], voidMatch[2], env, user);
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error(error);
      return json({ error: error instanceof Error ? error.message : "Unexpected server error" }, 500);
    }
  },
};
