const $ = (id) => document.getElementById(id);
const frequencyConfig = {
  weekly: { periods: 52, label: "every week" },
  biweekly: { periods: 26, label: "every two weeks" },
  monthly: { periods: 12, label: "every month" },
};

const defaults = { amount: 5552.75, rate: 10, termYears: 5, termMonths: 0, frequency: "biweekly", firstDate: "2026-11-13" };
let extras = loadExtras();
let currentSchedule = [];

function money(value) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(value || 0);
}

function dateLabel(date) {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function parseDate(value) {
  return new Date(`${value}T12:00:00Z`);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addPaymentPeriod(date, frequency, index) {
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * index);
  if (frequency === "biweekly") next.setUTCDate(next.getUTCDate() + 14 * index);
  if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + index);
  return next;
}

function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

function regularPayment(principal, annualRate, periods, count) {
  const r = annualRate / periods;
  if (!r) return round(principal / count);
  return round(principal * r / (1 - Math.pow(1 + r, -count)));
}

function readInputs() {
  return {
    amount: Math.max(0, Number($("loanAmount").value)),
    rate: Math.max(0, Number($("interestRate").value)) / 100,
    termYears: Math.max(0, Math.floor(Number($("loanTermYears").value))),
    termMonths: Math.min(11, Math.max(0, Math.floor(Number($("loanTermMonths").value)))),
    frequency: $("frequency").value,
    firstDate: $("firstPaymentDate").value,
  };
}

function calculate(inputs, includeExtras = true) {
  const config = frequencyConfig[inputs.frequency];
  const totalMonths = Math.max(1, inputs.termYears * 12 + inputs.termMonths);
  const plannedCount = Math.max(1, Math.round(totalMonths * config.periods / 12));
  const payment = regularPayment(inputs.amount, inputs.rate, config.periods, plannedCount);
  const start = parseDate(inputs.firstDate);
  let balance = round(inputs.amount);
  let totalInterest = 0;
  let totalPaid = 0;
  const rows = [];
  const maxRows = plannedCount + config.periods * 20;

  for (let i = 0; i < maxRows && balance > 0; i++) {
    const date = addPaymentPeriod(start, inputs.frequency, i);
    const opening = balance;
    const interest = round(opening * inputs.rate / config.periods);
    const due = round(opening + interest);
    const scheduled = Math.min(payment, due);
    const extra = includeExtras ? round(extras.filter((item) => !item.applied && item.date <= isoDate(date)).reduce((sum, item) => sum + item.amount, 0)) : 0;

    if (includeExtras && extra > 0) extras.filter((item) => !item.applied && item.date <= isoDate(date)).forEach((item) => { item.applied = true; });

    const total = Math.min(due, round(scheduled + extra));
    const extraApplied = round(Math.max(0, total - scheduled));
    const principal = round(total - interest);
    balance = round(Math.max(0, due - total));
    totalInterest = round(totalInterest + interest);
    totalPaid = round(totalPaid + total);
    rows.push({ number: i + 1, date, opening, interest, scheduled, extra: extraApplied, principal, closing: balance });
  }
  extras.forEach((item) => delete item.applied);
  return { rows, payment, totalInterest, totalPaid, payoffDate: rows.at(-1)?.date, plannedCount };
}

function recalculate() {
  const inputs = readInputs();
  if (!inputs.amount || !inputs.firstDate) return;
  const plan = calculate(inputs, true);
  const baseline = calculate(inputs, false);
  currentSchedule = plan.rows;

  $("paymentAmount").textContent = money(plan.payment);
  $("paymentFrequencyLabel").textContent = frequencyConfig[inputs.frequency].label;
  $("totalInterest").textContent = money(plan.totalInterest);
  $("totalPaid").textContent = money(plan.totalPaid);
  $("payoffDate").textContent = plan.payoffDate ? dateLabel(plan.payoffDate) : "—";
  $("paymentCount").textContent = plan.rows.length.toLocaleString("en-CA");
  $("scheduleCount").textContent = plan.rows.length;

  const saved = round(Math.max(0, baseline.totalInterest - plan.totalInterest));
  const paymentsSaved = Math.max(0, baseline.rows.length - plan.rows.length);
  $("interestSaved").textContent = money(saved);
  $("timeSaved").textContent = extras.length ? `${paymentsSaved} payment${paymentsSaved === 1 ? "" : "s"} sooner` : "Add an extra payment to compare";
  renderSchedule(plan.rows);
  persistInputs(inputs);
}

function renderSchedule(rows) {
  $("scheduleBody").innerHTML = rows.map((row) => `
    <tr class="${row.extra ? "has-extra" : ""}">
      <td>${row.number}</td><td>${dateLabel(row.date)}</td><td>${money(row.opening)}</td><td>${money(row.interest)}</td>
      <td>${money(row.scheduled)}</td><td class="${row.extra ? "extra-cell" : ""}">${row.extra ? money(row.extra) : "—"}</td>
      <td>${money(row.principal)}</td><td>${money(row.closing)}</td>
    </tr>`).join("");
}

function renderExtras() {
  const sorted = [...extras].sort((a, b) => a.date.localeCompare(b.date));
  $("extrasEmpty").hidden = sorted.length > 0;
  $("extrasList").innerHTML = sorted.map((item) => `
    <div class="extra-item">
      <div><strong>${money(item.amount)}</strong><span>Entered for ${dateLabel(parseDate(item.date))}</span></div>
      <button type="button" class="remove-extra" data-id="${item.id}" aria-label="Remove ${money(item.amount)} extra payment">Remove</button>
    </div>`).join("");
}

function loadExtras() {
  try { return JSON.parse(localStorage.getItem("familyLoanExtras")) || []; } catch { return []; }
}

function saveExtras() { localStorage.setItem("familyLoanExtras", JSON.stringify(extras)); }
function persistInputs(inputs) { localStorage.setItem("familyLoanInputs", JSON.stringify(inputs)); }

function loadInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem("familyLoanInputs"));
    if (!saved) return;
    $("loanAmount").value = saved.amount;
    $("interestRate").value = round(saved.rate * 100);
    const savedTotalMonths = saved.termYears !== undefined
      ? saved.termYears * 12 + (saved.termMonths || 0)
      : Math.round((saved.term || defaults.termYears) * 12);
    $("loanTermYears").value = Math.floor(savedTotalMonths / 12);
    $("loanTermMonths").value = savedTotalMonths % 12;
    $("frequency").value = saved.frequency;
    $("firstPaymentDate").value = saved.firstDate;
  } catch {}
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("plannerPanel").classList.toggle("is-active", tab === "planner");
  $("schedulePanel").classList.toggle("is-active", tab === "schedule");
}

function downloadCsv() {
  const header = ["Payment #", "Payment date", "Opening balance", "Interest", "Scheduled payment", "Extra payment", "Principal", "Closing balance"];
  const lines = currentSchedule.map((r) => [r.number, isoDate(r.date), r.opening.toFixed(2), r.interest.toFixed(2), r.scheduled.toFixed(2), r.extra.toFixed(2), r.principal.toFixed(2), r.closing.toFixed(2)].join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "amortization-schedule.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

$("loanForm").addEventListener("input", recalculate);
$("extraPaymentForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = round(Number($("extraAmount").value));
  const date = $("extraDate").value;
  if (!amount || !date) return;
  extras.push({ id: crypto.randomUUID(), amount, date });
  saveExtras();
  renderExtras();
  recalculate();
  $("extraAmount").value = "";
});
$("extrasList").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-extra");
  if (!button) return;
  extras = extras.filter((item) => item.id !== button.dataset.id);
  saveExtras();
  renderExtras();
  recalculate();
});
document.querySelectorAll(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
$("downloadCsv").addEventListener("click", downloadCsv);
$("resetButton").addEventListener("click", () => {
  if (!confirm("Reset the loan details and remove all extra payments?")) return;
  localStorage.removeItem("familyLoanInputs");
  localStorage.removeItem("familyLoanExtras");
  extras = [];
  $("loanAmount").value = defaults.amount;
  $("interestRate").value = defaults.rate;
  $("loanTermYears").value = defaults.termYears;
  $("loanTermMonths").value = defaults.termMonths;
  $("frequency").value = defaults.frequency;
  $("firstPaymentDate").value = defaults.firstDate;
  $("extraDate").value = defaults.firstDate;
  renderExtras();
  recalculate();
});

loadInputs();
$("extraDate").value = $("firstPaymentDate").value;
renderExtras();
recalculate();

