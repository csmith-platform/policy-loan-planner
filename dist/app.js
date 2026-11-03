const $ = (id) => document.getElementById(id);
const frequencyConfig = { weekly: { periods: 52, label: "every week" }, biweekly: { periods: 26, label: "every two weeks" }, monthly: { periods: 12, label: "every month" } };
let user = null, loans = [], currentLoan = null, members = [], events = [], currentSchedule = [];

function money(value) { return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0); }
function dateLabel(date) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date); }
function parseDate(value) { return new Date(`${value}T12:00:00Z`); }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]); }
function isOwner() { return user?.role === "owner"; }
function addPaymentPeriod(date, frequency, index) { const next = new Date(date); if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * index); if (frequency === "biweekly") next.setUTCDate(next.getUTCDate() + 14 * index); if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + index); return next; }
function regularPayment(principal, annualRate, periods, count) { const rate = annualRate / periods; return round(rate ? principal * rate / (1 - Math.pow(1 + rate, -count)) : principal / count); }
function assignedEmailValues() { return $("assignedEmails").value.split(/[,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean); }

function readInputs() {
  return {
    name: $("loanName").value.trim(), borrowerName: $("borrowerName").value.trim(), assignedEmails: assignedEmailValues(), status: $("loanRecordStatus").value,
    amount: Math.max(0, Number($("loanAmount").value)), rate: Math.max(0, Number($("interestRate").value)) / 100,
    termYears: Math.max(0, Math.floor(Number($("loanTermYears").value))), termMonths: Math.min(11, Math.max(0, Math.floor(Number($("loanTermMonths").value)))),
    frequency: $("frequency").value, firstDate: $("firstPaymentDate").value
  };
}

function writeInputs(loan) {
  $("loanName").value = loan.name; $("borrowerName").value = loan.borrowerName || ""; $("assignedEmails").value = members.map((member) => member.email).join(", ");
  $("loanRecordStatus").value = loan.status; $("loanAmount").value = loan.amount; $("interestRate").value = round(loan.rate * 100);
  $("loanTermYears").value = loan.termYears; $("loanTermMonths").value = loan.termMonths; $("frequency").value = loan.frequency;
  $("firstPaymentDate").value = loan.firstDate; $("extraDate").value = loan.firstDate;
}

function calculate(inputs, includeEvents = true) {
  const config = frequencyConfig[inputs.frequency], totalMonths = Math.max(1, inputs.termYears * 12 + inputs.termMonths), plannedCount = Math.max(1, Math.round(totalMonths * config.periods / 12));
  const payment = regularPayment(inputs.amount, inputs.rate, config.periods, plannedCount), start = parseDate(inputs.firstDate), active = includeEvents ? events.filter((event) => !event.voidedAt) : [];
  const missedByDate = new Map(active.filter((event) => event.type === "missed").map((event) => [event.scheduledDate, event]));
  const payments = active.filter((event) => event.type === "extra" || event.type === "manual").map((event) => ({ ...event, applied: false }));
  let balance = round(inputs.amount), totalInterest = 0, totalPaid = 0; const rows = [], maxRows = plannedCount + config.periods * 20;
  for (let index = 0; index < maxRows && balance > 0; index++) {
    const date = addPaymentPeriod(start, inputs.frequency, index), dateKey = isoDate(date), opening = balance, interest = round(opening * inputs.rate / config.periods), due = round(opening + interest), missedEvent = missedByDate.get(dateKey), scheduled = missedEvent ? 0 : Math.min(payment, due);
    const applicable = payments.filter((event) => !event.applied && event.paymentDate <= dateKey), otherRequested = round(applicable.reduce((sum, event) => sum + event.amount, 0)); applicable.forEach((event) => { event.applied = true; });
    const total = Math.min(due, round(scheduled + otherRequested)), other = round(Math.max(0, total - scheduled)), principal = round(total - interest); balance = round(Math.max(0, due - total)); totalInterest = round(totalInterest + interest); totalPaid = round(totalPaid + total);
    rows.push({ number: index + 1, date, dateKey, opening, interest, scheduled, other, principal, closing: balance, missedEvent, hasOther: other > 0 });
  }
  return { rows, payment, totalInterest, totalPaid, payoffDate: rows.at(-1)?.date };
}

function recalculate() {
  const inputs = readInputs(); if (!inputs.amount || !inputs.firstDate || !frequencyConfig[inputs.frequency]) return;
  const plan = calculate(inputs, true), baseline = calculate(inputs, false); currentSchedule = plan.rows;
  $("paymentAmount").textContent = money(plan.payment); $("paymentFrequencyLabel").textContent = frequencyConfig[inputs.frequency].label;
  $("totalInterest").textContent = money(plan.totalInterest); $("totalPaid").textContent = money(plan.totalPaid); $("payoffDate").textContent = plan.payoffDate ? dateLabel(plan.payoffDate) : "—";
  $("paymentCount").textContent = plan.rows.length.toLocaleString("en-CA"); $("scheduleCount").textContent = plan.rows.length;
  const saved = round(Math.max(0, baseline.totalInterest - plan.totalInterest)), paymentsSaved = Math.max(0, baseline.rows.length - plan.rows.length);
  $("interestSaved").textContent = money(saved); $("timeSaved").textContent = events.some((event) => !event.voidedAt) ? `${paymentsSaved} payment${paymentsSaved === 1 ? "" : "s"} sooner` : "Record a payment to compare";
  renderSchedule(plan.rows);
}

function renderSchedule(rows) {
  $("scheduleBody").innerHTML = rows.map((row) => {
    const status = row.missedEvent ? '<span class="status-missed">Missed</span>' : row.hasOther ? '<span class="status-paid">Payment recorded</span>' : "Scheduled";
    let action;
    if (row.missedEvent) action = isOwner() ? `<button class="row-action restore-payment" type="button" data-id="${row.missedEvent.id}">Restore</button>` : '<span class="action-note">Owner can restore</span>';
    else action = `<button class="row-action miss-payment" type="button" data-date="${row.dateKey}">Mark missed</button>`;
    return `<tr class="${row.hasOther ? "has-extra" : ""}"><td>${row.number}</td><td>${dateLabel(row.date)}</td><td>${money(row.opening)}</td><td>${money(row.interest)}</td><td>${row.missedEvent ? "—" : money(row.scheduled)}</td><td class="${row.hasOther ? "extra-cell" : ""}">${row.other ? money(row.other) : "—"}</td><td>${money(row.principal)}</td><td>${money(row.closing)}</td><td>${status}</td><td>${action}</td></tr>`;
  }).join("");
}

function renderEvents() {
  const active = events.filter((event) => !event.voidedAt && (event.type === "extra" || event.type === "manual")).sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));
  $("extrasEmpty").hidden = active.length > 0;
  $("extrasList").innerHTML = active.map((event) => `<div class="extra-item"><div><strong>${money(event.amount)} · ${event.type === "manual" ? "Manual" : "Extra"}</strong><span>${dateLabel(parseDate(event.paymentDate))} · recorded by ${escapeHtml(event.createdBy)}</span></div>${isOwner() ? `<button type="button" class="remove-extra" data-id="${event.id}" aria-label="Void ${money(event.amount)} payment">Void</button>` : ""}</div>`).join("");
}

function renderLoanList(selectedId) {
  $("loanSelect").replaceChildren(...loans.map((loan) => new Option(`${loan.name}${loan.borrowerName ? ` — ${loan.borrowerName}` : ""}`, loan.id, false, loan.id === selectedId)));
}

function setOwnerMode() {
  document.querySelectorAll(".owner-only").forEach((element) => { element.hidden = !isOwner(); });
  document.querySelectorAll(".financial-fields input, .financial-fields select").forEach((element) => { element.disabled = !isOwner(); });
  $("editModePill").innerHTML = isOwner() ? "<span></span> Owner editable" : "View only";
  $("termsNote").textContent = isOwner() ? "Only the owner can change terms or assignments. Interest uses the nominal annual rate divided by payment periods per year." : "Loan terms are managed by the owner. You can record payments and mark scheduled payments as missed.";
}

function updateLoanIdentity() {
  $("selectedLoanName").textContent = currentLoan.name; $("selectedBorrower").textContent = currentLoan.borrowerName ? `Borrower: ${currentLoan.borrowerName}` : "No borrower name recorded";
  $("loanStatus").textContent = currentLoan.status === "paid" ? "Paid off" : currentLoan.status[0].toUpperCase() + currentLoan.status.slice(1);
  $("loanStatus").className = `loan-status status-${currentLoan.status}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`); return payload;
}
function setStatus(message, error = false) { $("storageStatus").textContent = message; $("storageStatus").classList.toggle("is-error", error); }

async function loadLoan(loanId) {
  setStatus("Opening the selected loan ledger…");
  try {
    const data = await api(`/api/loans/${encodeURIComponent(loanId)}`); currentLoan = data.loan; events = data.events; members = data.members;
    const index = loans.findIndex((loan) => loan.id === currentLoan.id); if (index >= 0) loans[index] = currentLoan;
    localStorage.setItem("loan-planner-selected", currentLoan.id); renderLoanList(currentLoan.id); writeInputs(currentLoan); updateLoanIdentity(); renderEvents(); recalculate();
    $("loanWorkspace").hidden = false; $("emptyState").hidden = true; setStatus("Shared ledger connected. Payment entries are saved immediately.");
  } catch (error) { setStatus(error.message, true); }
}

async function loadSharedState(preferredId) {
  setStatus("Connecting to your loan ledgers…");
  try {
    const data = await api("/api/bootstrap"); user = data.user; loans = data.loans; $("currentUser").textContent = user.email; setOwnerMode();
    if (!loans.length) { $("loanWorkspace").hidden = true; $("emptyState").hidden = false; $("loanSelect").replaceChildren(); $("selectedLoanName").textContent = "No assigned loans"; $("selectedBorrower").textContent = ""; setStatus("Signed in successfully."); return; }
    const storedId = preferredId || localStorage.getItem("loan-planner-selected"), selected = loans.find((loan) => loan.id === storedId) || loans[0]; renderLoanList(selected.id); await loadLoan(selected.id);
  } catch (error) { setStatus(error.message, true); }
}

async function addEvent(body) {
  const data = await api(`/api/loans/${encodeURIComponent(currentLoan.id)}/events`, { method: "POST", body: JSON.stringify(body) }); events.unshift(data.event); renderEvents(); recalculate();
}
async function voidEvent(id) {
  const data = await api(`/api/loans/${encodeURIComponent(currentLoan.id)}/events/${encodeURIComponent(id)}/void`, { method: "PATCH", body: "{}" }); events = events.map((event) => event.id === id ? data.event : event); renderEvents(); recalculate();
}
function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => { const active = button.dataset.tab === tab; button.classList.toggle("is-active", active); button.setAttribute("aria-selected", String(active)); });
  $("plannerPanel").classList.toggle("is-active", tab === "planner"); $("schedulePanel").classList.toggle("is-active", tab === "schedule");
}
function downloadCsv() {
  const header = ["Payment #", "Payment date", "Opening balance", "Interest", "Scheduled payment", "Other payment", "Principal", "Closing balance", "Status"];
  const lines = currentSchedule.map((row) => [row.number, row.dateKey, row.opening.toFixed(2), row.interest.toFixed(2), row.scheduled.toFixed(2), row.other.toFixed(2), row.principal.toFixed(2), row.closing.toFixed(2), row.missedEvent ? "Missed" : "Scheduled"].join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `${currentLoan.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-schedule.csv`; link.click(); URL.revokeObjectURL(link.href);
}
function openNewLoanDialog() { $("newFirstDate").value = isoDate(new Date()); $("loanDialog").showModal(); }
function closeNewLoanDialog() { $("loanDialog").close(); }

$("loanSelect").addEventListener("change", (event) => loadLoan(event.target.value));
$("loanForm").addEventListener("input", recalculate);
$("loanForm").addEventListener("submit", async (event) => {
  event.preventDefault(); if (!isOwner()) return;
  try {
    setStatus("Saving loan details…"); const data = await api(`/api/loans/${encodeURIComponent(currentLoan.id)}`, { method: "PUT", body: JSON.stringify(readInputs()) });
    currentLoan = data.loan; events = data.events; members = data.members; const index = loans.findIndex((loan) => loan.id === currentLoan.id); if (index >= 0) loans[index] = currentLoan;
    renderLoanList(currentLoan.id); writeInputs(currentLoan); updateLoanIdentity(); renderEvents(); recalculate(); setStatus("Loan details and assignments saved.");
  } catch (error) { setStatus(error.message, true); }
});
$("extraPaymentForm").addEventListener("submit", async (event) => {
  event.preventDefault(); const amount = round(Number($("extraAmount").value)), paymentDate = $("extraDate").value; if (!amount || !paymentDate) return;
  try { await addEvent({ type: $("paymentType").value, amount, paymentDate }); $("extraAmount").value = ""; setStatus("Payment recorded in this loan ledger."); } catch (error) { setStatus(error.message, true); }
});
$("extrasList").addEventListener("click", async (event) => {
  const button = event.target.closest(".remove-extra"); if (!button || !confirm("Void this payment record? The audit history will be preserved.")) return;
  try { await voidEvent(button.dataset.id); setStatus("Payment record voided."); } catch (error) { setStatus(error.message, true); }
});
$("scheduleBody").addEventListener("click", async (event) => {
  const missed = event.target.closest(".miss-payment"), restore = event.target.closest(".restore-payment");
  try { if (missed) { await addEvent({ type: "missed", scheduledDate: missed.dataset.date }); setStatus("Scheduled payment marked missed."); } if (restore) { await voidEvent(restore.dataset.id); setStatus("Scheduled payment restored."); } } catch (error) { setStatus(error.message, true); }
});
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
$("downloadCsv").addEventListener("click", downloadCsv);
$("newLoanButton").addEventListener("click", openNewLoanDialog); $("closeLoanDialog").addEventListener("click", closeNewLoanDialog); $("cancelNewLoan").addEventListener("click", closeNewLoanDialog);
$("newLoanForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = { name: $("newLoanName").value.trim(), borrowerName: $("newBorrowerName").value.trim(), assignedEmails: [$("newAssignedEmails").value.trim().toLowerCase()], status: "active", amount: Number($("newLoanAmount").value), rate: Number($("newInterestRate").value) / 100, termYears: Number($("newTermYears").value), termMonths: Number($("newTermMonths").value), frequency: $("newFrequency").value, firstDate: $("newFirstDate").value };
  try { setStatus("Creating the new loan…"); const data = await api("/api/loans", { method: "POST", body: JSON.stringify(body) }); closeNewLoanDialog(); $("newLoanForm").reset(); await loadSharedState(data.loan.id); setStatus("New loan created and assigned."); } catch (error) { setStatus(error.message, true); }
});

loadSharedState();
