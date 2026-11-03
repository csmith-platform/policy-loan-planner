const $ = (id) => document.getElementById(id);
const frequencyConfig = { weekly: { periods: 52, label: "every week" }, biweekly: { periods: 26, label: "every two weeks" }, monthly: { periods: 12, label: "every month" } };
const defaults = { amount: 5552.75, rate: 10, termYears: 5, termMonths: 0, frequency: "biweekly", firstDate: "2026-11-13" };
let events = [], currentSchedule = [], saveTimer, loadingSharedState = true;

function money(value) { return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0); }
function dateLabel(date) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date); }
function parseDate(value) { return new Date(`${value}T12:00:00Z`); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function addPaymentPeriod(date, frequency, index) { const next = new Date(date); if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * index); if (frequency === "biweekly") next.setUTCDate(next.getUTCDate() + 14 * index); if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + index); return next; }
function regularPayment(principal, annualRate, periods, count) { const r = annualRate / periods; return round(r ? principal * r / (1 - Math.pow(1 + r, -count)) : principal / count); }

function readInputs() {
  return { amount: Math.max(0, Number($("loanAmount").value)), rate: Math.max(0, Number($("interestRate").value)) / 100, termYears: Math.max(0, Math.floor(Number($("loanTermYears").value))), termMonths: Math.min(11, Math.max(0, Math.floor(Number($("loanTermMonths").value)))), frequency: $("frequency").value, firstDate: $("firstPaymentDate").value };
}
function writeInputs(loan) { $("loanAmount").value = loan.amount; $("interestRate").value = round(loan.rate * 100); $("loanTermYears").value = loan.termYears; $("loanTermMonths").value = loan.termMonths; $("frequency").value = loan.frequency; $("firstPaymentDate").value = loan.firstDate; $("extraDate").value = loan.firstDate; }

function calculate(inputs, includeEvents = true) {
  const config = frequencyConfig[inputs.frequency], totalMonths = Math.max(1, inputs.termYears * 12 + inputs.termMonths), plannedCount = Math.max(1, Math.round(totalMonths * config.periods / 12));
  const payment = regularPayment(inputs.amount, inputs.rate, config.periods, plannedCount), start = parseDate(inputs.firstDate), active = includeEvents ? events.filter((event) => !event.voidedAt) : [];
  const missedByDate = new Map(active.filter((event) => event.type === "missed").map((event) => [event.scheduledDate, event]));
  const payments = active.filter((event) => event.type === "extra" || event.type === "manual").map((event) => ({ ...event, applied: false }));
  let balance = round(inputs.amount), totalInterest = 0, totalPaid = 0; const rows = [], maxRows = plannedCount + config.periods * 20;
  for (let i = 0; i < maxRows && balance > 0; i++) {
    const date = addPaymentPeriod(start, inputs.frequency, i), dateKey = isoDate(date), opening = balance, interest = round(opening * inputs.rate / config.periods), due = round(opening + interest), missedEvent = missedByDate.get(dateKey), scheduled = missedEvent ? 0 : Math.min(payment, due);
    const applicable = payments.filter((event) => !event.applied && event.paymentDate <= dateKey), otherRequested = round(applicable.reduce((sum, event) => sum + event.amount, 0)); applicable.forEach((event) => { event.applied = true; });
    const total = Math.min(due, round(scheduled + otherRequested)), other = round(Math.max(0, total - scheduled)), principal = round(total - interest); balance = round(Math.max(0, due - total)); totalInterest = round(totalInterest + interest); totalPaid = round(totalPaid + total);
    rows.push({ number: i + 1, date, dateKey, opening, interest, scheduled, other, principal, closing: balance, missedEvent, hasOther: other > 0 });
  }
  return { rows, payment, totalInterest, totalPaid, payoffDate: rows.at(-1)?.date };
}

function recalculate({ save = true } = {}) {
  const inputs = readInputs(); if (!inputs.amount || !inputs.firstDate) return; const plan = calculate(inputs, true), baseline = calculate(inputs, false); currentSchedule = plan.rows;
  $("paymentAmount").textContent = money(plan.payment); $("paymentFrequencyLabel").textContent = frequencyConfig[inputs.frequency].label; $("totalInterest").textContent = money(plan.totalInterest); $("totalPaid").textContent = money(plan.totalPaid); $("payoffDate").textContent = plan.payoffDate ? dateLabel(plan.payoffDate) : "—"; $("paymentCount").textContent = plan.rows.length.toLocaleString("en-CA"); $("scheduleCount").textContent = plan.rows.length;
  const saved = round(Math.max(0, baseline.totalInterest - plan.totalInterest)), paymentsSaved = Math.max(0, baseline.rows.length - plan.rows.length); $("interestSaved").textContent = money(saved); $("timeSaved").textContent = events.some((event) => !event.voidedAt) ? `${paymentsSaved} payment${paymentsSaved === 1 ? "" : "s"} sooner` : "Record a payment to compare";
  renderSchedule(plan.rows); if (save && !loadingSharedState) scheduleLoanSave(inputs);
}

function renderSchedule(rows) {
  $("scheduleBody").innerHTML = rows.map((row) => {
    const status = row.missedEvent ? '<span class="status-missed">Missed</span>' : row.hasOther ? '<span class="status-paid">Payment recorded</span>' : "Scheduled";
    const action = row.missedEvent ? `<button class="row-action restore-payment" type="button" data-id="${row.missedEvent.id}">Restore</button>` : `<button class="row-action miss-payment" type="button" data-date="${row.dateKey}">Mark missed</button>`;
    return `<tr class="${row.hasOther ? "has-extra" : ""}"><td>${row.number}</td><td>${dateLabel(row.date)}</td><td>${money(row.opening)}</td><td>${money(row.interest)}</td><td>${row.missedEvent ? "—" : money(row.scheduled)}</td><td class="${row.hasOther ? "extra-cell" : ""}">${row.other ? money(row.other) : "—"}</td><td>${money(row.principal)}</td><td>${money(row.closing)}</td><td>${status}</td><td>${action}</td></tr>`;
  }).join("");
}

function renderEvents() {
  const active = events.filter((event) => !event.voidedAt && (event.type === "extra" || event.type === "manual")).sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  $("extrasEmpty").hidden = active.length > 0;
  $("extrasList").innerHTML = active.map((event) => `<div class="extra-item"><div><strong>${money(event.amount)} · ${event.type === "manual" ? "Manual" : "Extra"}</strong><span>${dateLabel(parseDate(event.paymentDate))} · recorded by ${event.createdBy}</span></div><button type="button" class="remove-extra" data-id="${event.id}" aria-label="Void ${money(event.amount)} payment">Void</button></div>`).join("");
}

async function api(path, options = {}) { const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload; }
function setStatus(message, error = false) { $("storageStatus").textContent = message; $("storageStatus").classList.toggle("is-error", error); }

async function loadSharedState() {
  setStatus("Connecting to the shared loan ledger…");
  try { const data = await api("/api/bootstrap"); events = data.events; writeInputs(data.loan); $("currentUser").textContent = data.user.email; loadingSharedState = false; renderEvents(); recalculate({ save: false }); setStatus("Shared ledger connected. Changes are saved automatically."); }
  catch (error) { setStatus(error.message, true); }
}

function scheduleLoanSave(inputs) { clearTimeout(saveTimer); setStatus("Saving loan terms…"); saveTimer = setTimeout(async () => { try { await api("/api/loan", { method: "PUT", body: JSON.stringify(inputs) }); setStatus("Shared ledger connected. Changes are saved automatically."); } catch (error) { setStatus(error.message, true); } }, 600); }
async function addEvent(body) { const data = await api("/api/events", { method: "POST", body: JSON.stringify(body) }); events.unshift(data.event); renderEvents(); recalculate({ save: false }); }
async function voidEvent(id) { const data = await api(`/api/events/${encodeURIComponent(id)}/void`, { method: "PATCH", body: "{}" }); events = events.map((event) => event.id === id ? data.event : event); renderEvents(); recalculate({ save: false }); }
function switchTab(tab) { document.querySelectorAll(".tab").forEach((button) => { const active = button.dataset.tab === tab; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); }); $("plannerPanel").classList.toggle("is-active", tab === "planner"); $("schedulePanel").classList.toggle("is-active", tab === "schedule"); }
function downloadCsv() { const header = ["Payment #", "Payment date", "Opening balance", "Interest", "Scheduled payment", "Other payment", "Principal", "Closing balance", "Status"]; const lines = currentSchedule.map((row) => [row.number, row.dateKey, row.opening.toFixed(2), row.interest.toFixed(2), row.scheduled.toFixed(2), row.other.toFixed(2), row.principal.toFixed(2), row.closing.toFixed(2), row.missedEvent ? "Missed" : "Scheduled"].join(",")); const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "amortization-schedule.csv"; link.click(); URL.revokeObjectURL(link.href); }

$("loanForm").addEventListener("input", () => recalculate());
$("extraPaymentForm").addEventListener("submit", async (event) => { event.preventDefault(); const amount = round(Number($("extraAmount").value)), paymentDate = $("extraDate").value; if (!amount || !paymentDate) return; try { await addEvent({ type: $("paymentType").value, amount, paymentDate }); $("extraAmount").value = ""; setStatus("Payment recorded in the shared ledger."); } catch (error) { setStatus(error.message, true); } });
$("extrasList").addEventListener("click", async (event) => { const button = event.target.closest(".remove-extra"); if (!button || !confirm("Void this payment record?")) return; try { await voidEvent(button.dataset.id); } catch (error) { setStatus(error.message, true); } });
$("scheduleBody").addEventListener("click", async (event) => { const missed = event.target.closest(".miss-payment"), restore = event.target.closest(".restore-payment"); try { if (missed) await addEvent({ type: "missed", scheduledDate: missed.dataset.date }); if (restore) await voidEvent(restore.dataset.id); } catch (error) { setStatus(error.message, true); } });
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
$("downloadCsv").addEventListener("click", downloadCsv);
$("resetButton").addEventListener("click", () => { if (!confirm("Reset the shared loan terms to the original defaults? Payment records will be preserved.")) return; writeInputs(defaults); recalculate(); });

writeInputs(defaults); recalculate({ save: false }); loadSharedState();

