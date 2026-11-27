"use strict";

const STORAGE_KEY = "rashody.expenses.v1";
const categories = ["Еда", "Транспорт", "Жилье", "Другое"];
const BUDGET_KEY = "rashody.budgets.v1";
const DATA_KEY = "rashody.data.v1";
const BACKUP_META_KEY = "rashody.backup-meta.v1";
let dataRevision = null;
let backupMetaError = "";
let budgets = {};
let budgetReadable = true;
let budgetMonth = "";
let selectedMonth = null;
const limitIndicators = new Map();
const budgetStatus = document.querySelector("#budget-status");
const form = document.querySelector("#expense-form");
const amountInput = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const commentInput = document.querySelector("#comment");
const status = document.querySelector("#status");
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
let expenses = [];
let storageReadable = true;
let editingExpense = null;
let deletedExpense = null;

function localDate(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}

function parseAmount(value) {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(/[.,]/);
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function formatMoney(minor) {
  return formatTotal(BigInt(minor));
}

function formatTotal(total) {
  const whole = total / 100n;
  const fraction = Number(total % 100n);
  return `${money.format(whole).replace(/[\u00a0\u202f]/g, " ")}${fraction ? `,${String(fraction).padStart(2, "0")}` : ""} ₸`;
}

function render() {
  renderBackupReminder();
  const now = new Date();
  const month = selectedMonth || localDate(now).slice(0, 7);
  const periodDate = new Date(`${month}-01T12:00:00`);
  document.querySelector("#selected-month").value = month;
  renderLimits(month, periodDate);
  const totals = new Map(categories.map(category => [category, 0n]));
  for (const expense of expenses) {
    if (expense.date.slice(0, 7) === month) {
      totals.set(expense.category, totals.get(expense.category) + BigInt(expense.minor));
    }
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0n);
  const limits = Object.values(budgets[month] || {});
  const budgetTotal = limits.reduce((sum, minor) => sum + BigInt(minor), 0n);
  document.querySelector("#budget-total").textContent = !budgetReadable
    ? "Бюджет недоступен"
    : limits.length ? `Общий бюджет: ${formatTotal(budgetTotal)}` : "Бюджет не задан";
  const budgetCount = document.querySelector("#budget-count");
  budgetCount.hidden = !budgetReadable;
  budgetCount.textContent = `Лимиты заданы: ${limits.length} из 4`;
  document.querySelector("#budget-spent").textContent = `Потрачено: ${formatTotal(total)}`;
  const budgetRemaining = document.querySelector("#budget-remaining");
  const budgetBalance = budgetTotal - total;
  budgetRemaining.hidden = !budgetReadable || limits.length === 0;
  budgetRemaining.className = budgetBalance < 0n ? "limit-overrun" : "";
  budgetRemaining.textContent = budgetRemaining.hidden ? "" : budgetBalance < 0n
    ? `Перерасход ${formatTotal(-budgetBalance)}`
    : `Осталось ${formatTotal(budgetBalance)}`;
  for (const [category, spent] of totals) {
    const { spending, remaining, progress, usage } = limitIndicators.get(category);
    spending.textContent = `Потрачено: ${formatTotal(spent)}`;
    const limit = budgets[month]?.[category];
    remaining.hidden = limit === undefined;
    progress.hidden = usage.hidden = limit === undefined;
    if (limit !== undefined) {
      const percent = BigInt(limit) > 0n ? spent * 100n / BigInt(limit) : 0n;
      progress.value = Number(percent > 100n ? 100n : percent);
      usage.textContent = `Использовано ${percent}%`;
      progress.setAttribute("aria-label", `Использовано лимита: ${category}`);
    }
    const balance = limit === undefined ? 0n : BigInt(limit) - spent;
    remaining.className = balance < 0n ? "limit-remaining limit-overrun" : "limit-remaining";
    remaining.textContent = limit === undefined ? "" : balance < 0n
      ? `Перерасход ${formatTotal(-balance)}`
      : `Осталось ${formatTotal(balance)}`;
  }
  document.querySelector("#total").textContent = formatTotal(total);
  renderDashboard(month, total, budgetTotal, limits.length);
  const categoryTotals = document.querySelector("#category-totals");
  categoryTotals.replaceChildren();
  for (const [category, amount] of totals) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    label.textContent = category === "Жилье" ? "Дом" : category;
    const value = document.createElement("dd");
    value.textContent = formatTotal(amount);
    const share = total > 0n ? Number(amount * 1000n / total) / 10 : 0;
    const percent = document.createElement("span");
    percent.className = "category-share";
    percent.textContent = money.format(share) + "%";
    value.append(percent);
    const track = document.createElement("div");
    track.className = "category-track";
    track.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "category-fill";
    const colors = ["#f48e88", "#809cff", "#74d7b0", "#baa3ff"];
    fill.style.setProperty("--share", share + "%");
    fill.style.setProperty("--category-color", colors[categories.indexOf(category)]);
    track.append(fill);
    row.append(label, value, track);
    categoryTotals.append(row);
  }
  document.querySelector("#month-label").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(periodDate);
  document.querySelector("#report-month").textContent = document.querySelector("#month-label").textContent;
  document.querySelector("#report-total").textContent = `Итого: ${formatTotal(total)}`;
  const topCategories = [...totals].filter(([, amount]) => amount > 0n)
    .sort((a, b) => a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1).slice(0, 3);
  const reportCategories = document.querySelector("#report-categories");
  reportCategories.replaceChildren();
  document.querySelector("#report-empty").hidden = topCategories.length > 0;
  for (const [category, amount] of topCategories) {
    const item = document.createElement("li");
    item.textContent = `${category === "Жилье" ? "Дом" : category} — ${formatTotal(amount)}`;
    reportCategories.append(item);
  }
  const previous = previousMonth(month);
  const previousTotal = expenses.filter(expense => expense.date.slice(0, 7) === previous)
    .reduce((sum, expense) => sum + BigInt(expense.minor), 0n);
  const difference = total - previousTotal;
  document.querySelector("#report-comparison").textContent = `Прошлый месяц: ${formatTotal(previousTotal)}. ${difference === 0n ? "Без изменений" : `На ${formatTotal(difference < 0n ? -difference : difference)} ${difference > 0n ? "больше" : "меньше"}`}.`;
  document.querySelector("#report-text").value = [
    `Отчёт за ${document.querySelector("#report-month").textContent}`,
    document.querySelector("#report-total").textContent,
    "Самые затратные категории:",
    ...(topCategories.length ? [...reportCategories.children].map(item => item.textContent) : ["Расходов нет."]),
    document.querySelector("#report-comparison").textContent
  ].join("\n");
  const query = document.querySelector("#search-expenses").value.trim().toLocaleLowerCase("ru-RU");
  const filterCategory = document.querySelector("#filter-category").value;
  const visibleExpenses = expenses.filter(expense => expense.date.slice(0, 7) === month && (!filterCategory || expense.category === filterCategory) && (!query || expense.comment.toLocaleLowerCase("ru-RU").includes(query))).sort((a, b) => b.date.localeCompare(a.date));
  document.querySelector("#found-total").textContent = `Найдено: ${visibleExpenses.length} · ${formatTotal(visibleExpenses.reduce((sum, expense) => sum + BigInt(expense.minor), 0n))}`;
  document.querySelector("#empty").textContent = query || filterCategory ? "По этим условиям трат нет." : "В этом месяце пока нет трат.";
  document.querySelector("#empty").hidden = visibleExpenses.length > 0;
  const list = document.querySelector("#expenses");
  list.replaceChildren();
  let lastDay = "";
  for (const expense of visibleExpenses) {
    if (lastDay !== expense.date) {
      const day = document.createElement("li");
      day.className = "day-heading";
      const title = document.createElement("h3");
      const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
      const prefix = expense.date === localDate(now) ? "Сегодня · " : expense.date === localDate(yesterday) ? "Вчера · " : "";
      title.textContent = prefix + expense.date.split("-").reverse().join(".");
      day.append(title); list.append(day); lastDay = expense.date;
    }
    const item = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "expense-heading";
    const category = document.createElement("span");
    category.textContent = expense.category === "Жилье" ? "Дом" : expense.category;
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(expense.minor);
    heading.append(category, amount);
    const date = document.createElement("time");
    date.className = "expense-date";
    date.dateTime = expense.date;
    date.textContent = expense.date.split("-").reverse().join(".");
    item.append(heading, date);
    if (expense.comment) {
      const comment = document.createElement("p");
      comment.className = "expense-comment";
      comment.textContent = expense.comment;
      item.append(comment);
    }
    const actions = document.createElement("div");
    actions.className = "expense-actions";
    for (const [title, action] of [["Повторить", () => repeatExpense(expense)], ["Изменить", () => startEdit(expense)], ["Удалить", () => deleteExpense(expense)]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = title;
      button.disabled = !storageReadable;
      button.addEventListener("click", action);
      actions.append(button);
    }
    item.append(actions);
    list.append(item);
  }
}

let savedSnapshot = null;
let snapshotBroken = false;
try {
  const raw = localStorage.getItem(DATA_KEY);
  if (raw !== null) { savedSnapshot = JSON.parse(raw); if (!validBackup(savedSnapshot)) throw new Error("Invalid snapshot"); dataRevision = typeof savedSnapshot.revision === "string" ? savedSnapshot.revision : null; }
} catch { snapshotBroken = true; }

try {
  if (snapshotBroken) throw new Error("Invalid snapshot");
  const saved = savedSnapshot ? JSON.stringify(savedSnapshot.expenses) : localStorage.getItem(STORAGE_KEY);
  if (saved !== null) {
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(item => item && Number.isSafeInteger(item.minor) && item.minor > 0 && categories.includes(item.category) && typeof item.date === "string" && validDate(item.date) && typeof item.comment === "string")) throw new Error("Invalid saved expenses");
    expenses = parsed;
  }
} catch {
  storageReadable = false;
  status.textContent = "Не удалось прочитать сохраненные траты. Проверьте доступ к хранилищу браузера; данные не перезаписаны.";
}

try {
  if (snapshotBroken) throw new Error("Invalid snapshot");
  const saved = savedSnapshot ? JSON.stringify(savedSnapshot.budgets) : localStorage.getItem(BUDGET_KEY);
  if (saved !== null) {
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        !Object.entries(parsed).every(([month, limits]) =>
          validDate(`${month}-01`) && month.length === 7 &&
          limits && typeof limits === "object" && !Array.isArray(limits) &&
          Object.entries(limits).every(([category, minor]) => categories.includes(category) && Number.isSafeInteger(minor) && minor > 0))) {
      throw new Error("Invalid saved budgets");
    }
    budgets = parsed;
  }
} catch {
  budgetReadable = false;
  budgetStatus.textContent = "Не удалось прочитать лимиты. Данные не перезаписаны; сохранение лимитов недоступно. Траты можно добавлять.";
}

function renderLimits(month, now) {
  // Не пересоздаем поля при обновлении расходов: несохраненный ввод остается на месте.
  if (budgetMonth === month) return;
  budgetMonth = month;
  document.querySelector("#budget-month").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(now);
  const container = document.querySelector("#budget-limits");
  container.replaceChildren();
  limitIndicators.clear();
  categories.forEach((category, index) => {
    const name = category === "Жилье" ? "Дом" : category;
    const limitForm = document.createElement("form");
    limitForm.className = "limit-form";
    limitForm.noValidate = true;
    const heading = document.createElement("h3");
    heading.textContent = name;
    const value = document.createElement("p");
    value.className = "limit-value";
    const indicators = document.createElement("div");
    indicators.setAttribute("aria-live", "polite");
    const spending = document.createElement("p");
    spending.className = "limit-spending";
    const remaining = document.createElement("p");
    indicators.append(spending, remaining);
    const progress = document.createElement("progress");
    progress.max = 100;
    const usage = document.createElement("p");
    usage.className = "limit-usage";
    indicators.append(progress, usage);
    limitIndicators.set(category, { spending, remaining, progress, usage });
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.id = `limit-${index}`;
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "10 000";
    label.htmlFor = input.id;
    label.textContent = `Лимит: ${name}, ₸`;
    const error = document.createElement("p");
    error.id = `${input.id}-error`;
    error.className = "error";
    error.setAttribute("aria-live", "polite");
    input.setAttribute("aria-describedby", error.id);
    const actions = document.createElement("div");
    actions.className = "limit-actions";
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Сохранить";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "limit-remove";
    remove.textContent = "Убрать лимит";
    function refresh() {
      const minor = budgets[month]?.[category];
      value.textContent = minor === undefined ? "Лимит не задан" : `Лимит: ${formatTotal(BigInt(minor))}`;
      input.value = minor === undefined ? "" : formatMoney(minor).replace(/ ₸$/, "");
      remove.hidden = minor === undefined;
    }
    function persist(minor) {
      const currentMonth = selectedMonth || localDate(new Date()).slice(0, 7);
      if (currentMonth !== month) {
        render();
        budgetStatus.textContent = "Начался новый месяц. Задайте лимит заново.";
        return;
      }
      if (!budgetReadable) return;
      const limits = { ...budgets[month] };
      if (minor === null) delete limits[category];
      else limits[category] = minor;
      const next = { ...budgets, [month]: limits };
      try {
        persistState(expenses, next);
      } catch {
        budgetStatus.textContent = "Лимит не сохранен. Проверьте доступ к хранилищу и изменения в другой вкладке, затем повторите.";
        return;
      }
      budgets = next;
      showError(input, "");
      refresh();
      render();
      budgetStatus.textContent = minor === null ? `Лимит «${name}» убран.` : `Лимит «${name}» сохранен.`;
    }
    limitForm.addEventListener("submit", event => {
      event.preventDefault();
      const minor = parseAmount(input.value);
      showError(input, minor === null ? "Введите сумму больше нуля, например 10 000 или 1 250,50." : "");
      if (minor === null) { input.focus(); return; }
      persist(minor);
    });
    remove.addEventListener("click", () => persist(null));
    input.disabled = save.disabled = remove.disabled = !budgetReadable;
    actions.append(save, remove);
    const settings = document.createElement("details");
    const toggle = document.createElement("summary");
    toggle.textContent = "Настроить лимит";
    settings.append(toggle, label, input, error, actions);
    limitForm.append(heading, value, indicators, settings);
    container.append(limitForm);
    refresh();
  });
}

let storageVersion = readStorageVersion();
dateInput.value = localDate(new Date());
render();

function showError(input, message) {
  document.querySelector(`#${input.id}-error`).textContent = message;
  input.setAttribute("aria-invalid", String(Boolean(message)));
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const minor = parseAmount(amountInput.value);
  const dateIsValid = validDate(dateInput.value);
  showError(amountInput, minor === null ? "Введите сумму больше нуля, например 5 000 или 1 250,50." : "");
  showError(dateInput, dateIsValid ? "" : "Укажите корректную дату.");
  if (minor === null || !dateIsValid) {
    (minor === null ? amountInput : dateInput).focus();
    return;
  }
  if (!categories.includes(categoryInput.value)) return;
  if (!storageReadable) {
    status.textContent = "Сохранение недоступно: сначала восстановите доступ к сохраненным данным браузера.";
    return;
  }
  const updated = { minor, category: categoryInput.value, date: dateInput.value, comment: commentInput.value.trim() };
  const wasEditing = editingExpense !== null;
  const next = wasEditing ? expenses.map(item => item === editingExpense ? updated : item) : [updated, ...expenses];
  if (!saveExpenses(next)) return;
  clearUndo();
  cancelEdit();
  render();
  status.textContent = (wasEditing ? "Трата изменена." : "Трата добавлена.") + (updated.date.slice(0, 7) !== (selectedMonth || localDate(new Date()).slice(0, 7)) ? " Она относится к другому месяцу." : "");
  amountInput.focus();
});

window.addEventListener("focus", () => { syncStorage(); render(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { syncStorage(); render(); } });
setInterval(render, 60000);

function saveExpenses(next) {
  if (!storageReadable) return false;
  try { persistState(next, budgets); }
  catch { status.textContent = "Трата не сохранена. Проверьте сообщения о хранилище и изменения в другой вкладке, затем повторите."; return false; }
  expenses = next;
  return true;
}
function cancelEdit() {
  editingExpense = null;
  amountInput.value = commentInput.value = "";
  showError(amountInput, ""); showError(dateInput, "");
  document.querySelector("#form-title").textContent = "Добавить трату";
  document.querySelector("#save-expense").textContent = "Добавить";
  document.querySelector("#cancel-edit").hidden = true;
}
function startEdit(expense) {
  editingExpense = expense;
  amountInput.value = formatMoney(expense.minor).replace(/ ₸$/, "");
  categoryInput.value = expense.category;
  dateInput.value = expense.date;
  commentInput.value = expense.comment;
  showError(amountInput, ""); showError(dateInput, "");
  document.querySelector("#form-title").textContent = "Изменить трату";
  document.querySelector("#save-expense").textContent = "Сохранить изменения";
  document.querySelector("#cancel-edit").hidden = false;
  status.textContent = "";
  amountInput.focus();
}
function repeatExpense(expense) {
  if (!storageReadable) return;
  selectedMonth = null;
  cancelEdit();
  document.querySelector("#search-expenses").value = "";
  document.querySelector("#filter-category").value = "";
  amountInput.value = formatMoney(expense.minor).replace(/ ₸$/, "");
  categoryInput.value = expense.category;
  dateInput.value = localDate(new Date());
  commentInput.value = expense.comment;
  render();
  status.textContent = "Форма заполнена для новой траты. Проверьте данные и нажмите „Добавить“";
  amountInput.focus();
}
function clearUndo() {
  deletedExpense = null;
  document.querySelector("#undo-panel").hidden = true;
}
function deleteExpense(expense) {
  const index = expenses.indexOf(expense);
  if (index < 0 || !saveExpenses(expenses.filter(item => item !== expense))) return;
  deletedExpense = { expense, index };
  if (editingExpense === expense) cancelEdit();
  document.querySelector("#undo-panel").hidden = false;
  render();
  document.querySelector("#undo-delete").focus();
}
document.querySelector("#cancel-edit").addEventListener("click", () => { cancelEdit(); amountInput.focus(); });
document.querySelector("#undo-delete").addEventListener("click", () => {
  if (!deletedExpense) return;
  const next = [...expenses];
  next.splice(deletedExpense.index, 0, deletedExpense.expense);
  if (!saveExpenses(next)) return;
  clearUndo(); render(); status.textContent = "Трата восстановлена.";
  amountInput.focus();
});

function changeMonth(month) {
  if (!validDate(month + "-01") || month.length !== 7) {
    document.querySelector("#selected-month").value = selectedMonth || localDate(new Date()).slice(0, 7);
    status.textContent = "Выберите корректный месяц.";
    return;
  }
  selectedMonth = month === localDate(new Date()).slice(0, 7) ? null : month;
  cancelEdit();
  dateInput.value = selectedMonth ? month + "-01" : localDate(new Date());
  render();
  status.textContent = "Показан выбранный месяц.";
}
document.querySelector("#selected-month").addEventListener("change", event => changeMonth(event.target.value));
document.querySelector("#current-month").addEventListener("click", () => changeMonth(localDate(new Date()).slice(0, 7)));

function validExpenses(items) {
  return Array.isArray(items) && items.every(item => item && Number.isSafeInteger(item.minor) && item.minor > 0 && categories.includes(item.category) && typeof item.date === "string" && validDate(item.date) && typeof item.comment === "string");
}
function validBudgets(items) {
  return items && typeof items === "object" && !Array.isArray(items) && Object.entries(items).every(([month, limits]) => month.length === 7 && validDate(month + "-01") && limits && typeof limits === "object" && !Array.isArray(limits) && Object.entries(limits).every(([category, minor]) => categories.includes(category) && Number.isSafeInteger(minor) && minor > 0));
}
function validBackup(data) { return data && data.version === 1 && validExpenses(data.expenses) && validBudgets(data.budgets); }
function makeBackup(items = expenses, limits = budgets) { return { version: 1, expenses: items, budgets: limits }; }
function persistState(items, limits, replaceAll = false) {
  if (!replaceAll && readStorageVersion() !== storageVersion) { syncStorage(); throw new Error("Storage changed"); }
  // Если старое хранилище частично повреждено, не затираем его новым снимком.
  if (!replaceAll && !budgetReadable && limits === budgets) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); storageVersion = readStorageVersion(); return; }
  if (!replaceAll && !storageReadable && items === expenses) { localStorage.setItem(BUDGET_KEY, JSON.stringify(limits)); storageVersion = readStorageVersion(); return; }
  // Ревизия сохраняется атомарно с данными; в скачиваемый JSON она не входит.
  const revision = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  localStorage.setItem(DATA_KEY, JSON.stringify({ ...makeBackup(items, limits), revision }));
  dataRevision = revision;
  storageVersion = readStorageVersion();
}

function readBackupMeta() {
  const raw = localStorage.getItem(BACKUP_META_KEY);
  if (raw === null) return null;
  const meta = JSON.parse(raw);
  if (!meta || typeof meta.preparedAt !== "string" || !Number.isFinite(Date.parse(meta.preparedAt)) ||
      !(meta.revision === null || typeof meta.revision === "string")) throw new Error("Invalid backup metadata");
  return meta;
}

function renderBackupReminder() {
  const last = document.querySelector("#backup-last");
  const reminder = document.querySelector("#backup-reminder");
  let meta;
  try { meta = readBackupMeta(); }
  catch {
    last.textContent = "Дата последней копии неизвестна";
    reminder.hidden = false;
    reminder.textContent = "Не удалось прочитать отметку копии. Состояние копии неизвестно; скачайте новую.";
    return;
  }
  last.textContent = meta ? "Последняя подготовка: " + new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short", timeStyle: "short"
  }).format(new Date(meta.preparedAt)) : "Копия ещё не создавалась";
  const hasData = expenses.length > 0 || Object.values(budgets).some(limits => Object.keys(limits).length > 0);
  const unavailable = !storageReadable || !budgetReadable;
  reminder.textContent = backupMetaError || (unavailable
    ? "Не удалось прочитать все данные. Состояние копии неизвестно; восстановите данные перед подготовкой копии."
    : !meta ? "Скачайте копию, чтобы сохранить историю вне браузера"
    : "Есть изменения после последней копии");
  reminder.hidden = !backupMetaError && !unavailable && (!hasData || (meta !== null && meta.revision === dataRevision));
}
let pendingImport = null;
let importRequest = 0;
function cancelImport() {
  importRequest++;
  pendingImport = null;
  document.querySelector("#import-file").value = "";
  document.querySelector("#import-preview").hidden = true;
}
function previewBackup(data) {
  if (!validBackup(data)) throw new Error("Invalid backup");
  pendingImport = { version: 1, expenses: data.expenses.map(({minor, category, date, comment}) => ({minor, category, date, comment})), budgets: Object.fromEntries(Object.entries(data.budgets).map(([month, limits]) => [month, {...limits}])) };
  document.querySelector("#import-description").textContent = "В копии: трат — " + pendingImport.expenses.length + ", месяцев бюджета — " + Object.keys(pendingImport.budgets).length + ".";
  document.querySelector("#import-preview").hidden = false;
}
document.querySelector("#export-data").addEventListener("click", () => {
  syncStorage();
  const message = document.querySelector("#backup-status");
  if (!storageReadable || !budgetReadable) { message.textContent = "Не удалось прочитать все данные. Неполная копия не создана."; return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(makeBackup(), null, 2)], {type: "application/json"}));
  const link = document.createElement("a");
  link.href = url; link.download = "rashody-" + localDate(new Date()) + ".json";
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message.textContent = "Копия подготовлена. Проверьте папку загрузок.";
  try {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ preparedAt: new Date().toISOString(), revision: dataRevision }));
    backupMetaError = "";
  } catch {
    backupMetaError = "Не удалось сохранить отметку копии. Состояние копии неизвестно; проверьте папку загрузок.";
  }
  renderBackupReminder();
});
document.querySelector("#import-file").addEventListener("change", async event => {
  const file = event.target.files[0];
  cancelImport();
  const request = importRequest;
  const message = document.querySelector("#backup-status");
  message.textContent = "";
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { message.textContent = "Выберите копию размером до 10 МБ."; return; }
  try {
    const data = JSON.parse(await file.text());
    if (request !== importRequest) return;
    previewBackup(data);
  } catch { if (request === importRequest) message.textContent = "Не удалось прочитать копию. Нужен JSON этой страницы с корректными суммами, датами и бюджетами."; }
});
document.querySelector("#cancel-import").addEventListener("click", cancelImport);
document.querySelector("#confirm-import").addEventListener("click", () => {
  if (!pendingImport) return;
  try { persistState(pendingImport.expenses, pendingImport.budgets, true); }
  catch { document.querySelector("#backup-status").textContent = "Не удалось восстановить копию. Текущие данные не изменены."; return; }
  expenses = pendingImport.expenses; budgets = pendingImport.budgets;
  storageReadable = budgetReadable = true;
  cancelEdit(); clearUndo(); cancelImport(); budgetMonth = "";
  status.textContent = budgetStatus.textContent = "";
  render();
  document.querySelector("#backup-status").textContent = "Расходы и бюджеты восстановлены.";
});

for (const id of ["#search-expenses", "#filter-category"]) { document.querySelector(id).addEventListener("input", render); }
document.querySelector("#reset-filters").addEventListener("click", () => { document.querySelector("#search-expenses").value = document.querySelector("#filter-category").value = ""; render(); });

function previousMonth(month) {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? String(year - 1).padStart(4, "0") + "-12" : String(year).padStart(4, "0") + "-" + String(number - 1).padStart(2, "0");
}
document.querySelector("#copy-report").addEventListener("click", async () => {
  const copyStatus = document.querySelector("#report-copy-status");
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(document.querySelector("#report-text").value);
    copyStatus.textContent = "Отчёт скопирован.";
  } catch {
    copyStatus.textContent = "Не удалось скопировать. Выделите текст отчёта и скопируйте вручную.";
  }
});
document.querySelector("#copy-budget").addEventListener("click", () => {
  if (!budgetReadable) { budgetStatus.textContent = "Сначала восстановите доступ к данным бюджета."; return; }
  const month = selectedMonth || localDate(new Date()).slice(0, 7);
  const source = budgets[previousMonth(month)] || {};
  const limits = { ...budgets[month] };
  let count = 0;
  for (const category of categories) {
    if (limits[category] === undefined && source[category] !== undefined) { limits[category] = source[category]; count++; }
  }
  if (!count) { budgetStatus.textContent = "Нет лимитов для переноса. Заданные лимиты не меняются."; return; }
  const next = { ...budgets, [month]: limits };
  try { persistState(expenses, next); }
  catch { budgetStatus.textContent = "Не удалось сохранить перенос. Лимиты не изменены."; return; }
  budgets = next; budgetMonth = ""; render();
  budgetStatus.textContent = "Лимитов перенесено: " + count + ". Уже заданные суммы сохранены.";
});

function readStorageVersion() {
  try { return JSON.stringify([localStorage.getItem(DATA_KEY), localStorage.getItem(STORAGE_KEY), localStorage.getItem(BUDGET_KEY)]); }
  catch { return null; }
}
function syncStorage() {
  const version = readStorageVersion();
  if (version === storageVersion) { renderBackupReminder(); return; }
  try {
    if (version === null) throw new Error("Storage unavailable");
    const [snapshot, oldExpenses, oldBudgets] = JSON.parse(version);
    const data = snapshot !== null ? JSON.parse(snapshot) : {version: 1, expenses: JSON.parse(oldExpenses || "[]"), budgets: JSON.parse(oldBudgets || "{}")};
    if (!validBackup(data)) throw new Error("Invalid storage");
    expenses = data.expenses; budgets = data.budgets;
    dataRevision = typeof data.revision === "string" ? data.revision : null;
    storageReadable = budgetReadable = true;
    cancelEdit(); clearUndo(); cancelImport(); budgetMonth = "";
    storageVersion = version;
    render();
    budgetStatus.textContent = "";
    status.textContent = "Данные обновлены из другой вкладки. Незавершенное изменение отменено; проверьте записи перед повторным сохранением.";
  } catch {
    storageReadable = budgetReadable = false;
    budgetMonth = ""; render();
    status.textContent = "Хранилище изменилось, но прочитать его не удалось. Сохранение отключено; восстановите корректную копию.";
  }
}
window.addEventListener("storage", event => {
  if (event.key === null || [DATA_KEY, STORAGE_KEY, BUDGET_KEY, BACKUP_META_KEY].includes(event.key)) {
    if (event.key === BACKUP_META_KEY || event.key === null) backupMetaError = "";
    syncStorage();
  }
});

function renderDashboard(month, total, budgetTotal, limitCount) {
  const monthExpenses = expenses.filter(expense => expense.date.slice(0, 7) === month);
  const balance = budgetTotal - total;
  document.querySelector("#dashboard-budget").textContent = !budgetReadable ? "Недоступен" : limitCount ? formatTotal(budgetTotal) : "—";
  document.querySelector("#dashboard-limits").textContent = budgetReadable ? "Лимитов задано: " + limitCount + " из 4" : "Проверьте хранилище";
  document.querySelector("#dashboard-balance-title").textContent = limitCount && balance < 0n ? "Перерасход бюджета" : "Остаток бюджета";
  const balanceValue = document.querySelector("#dashboard-balance");
  balanceValue.textContent = budgetReadable && limitCount ? formatTotal(balance < 0n ? -balance : balance) : "—";
  balanceValue.className = "kpi-value" + (budgetReadable && limitCount && balance < 0n ? " is-overrun" : "");
  document.querySelector("#dashboard-balance-note").textContent = !budgetReadable ? "Проверьте хранилище" : !limitCount ? "Задайте лимиты категорий" : limitCount < 4 ? "Бюджет задан частично" : "По всем категориям";
  document.querySelector("#dashboard-count").textContent = String(monthExpenses.length);
  document.querySelector("#dashboard-average").textContent = "Средняя трата " + (monthExpenses.length ? formatTotal((total + BigInt(Math.floor(monthExpenses.length / 2))) / BigInt(monthExpenses.length)) : "—");
  const days = new Date(month + "-01T12:00:00");
  days.setMonth(days.getMonth() + 1, 0);
  const daily = Array.from({length: days.getDate()}, () => 0n);
  for (const expense of monthExpenses) daily[Number(expense.date.slice(8)) - 1] += BigInt(expense.minor);
  renderDailyChart(daily, monthExpenses.length);
}
function renderDailyChart(daily, count) {
  const container = document.querySelector("#daily-chart");
  const description = document.querySelector("#daily-description");
  container.replaceChildren();
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "За этот месяц пока нет расходов";
    container.append(empty);
    description.textContent = "Добавьте трату, чтобы увидеть динамику.";
    return;
  }
  const max = daily.reduce((a, b) => a > b ? a : b, 0n);
  const peakDay = daily.findIndex(amount => amount === max) + 1;
  const activeDays = daily.filter(amount => amount > 0n).length;
  description.textContent = "Максимум за день: " + formatTotal(max) + " · " + peakDay + " число. Дней с тратами: " + activeDays + ".";
  const ns = "http://www.w3.org/2000/svg";
  const element = (name, attrs, text) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const compact = window.matchMedia?.("(max-width: 520px)").matches;
  const chartWidth = compact ? 340 : 640;
  const svg = element("svg", {viewBox: "0 0 " + chartWidth + " 224", role: "img", "aria-labelledby": "daily-svg-title daily-svg-description"});
  svg.append(element("title", {id: "daily-svg-title"}, "Расходы по дням месяца"));
  svg.append(element("desc", {id: "daily-svg-description"}, daily.map((amount, index) => (index + 1) + ": " + formatTotal(amount)).join("; ")));
  const left = compact ? 68 : 78, right = chartWidth - 18, top = 16, bottom = 192;
  for (let step = 0; step <= 4; step++) {
    const y = top + (bottom - top) * step / 4;
    const value = max * BigInt(4 - step) / 4n;
    const whole = value / 100n;
    const label = whole >= 1000000000n ? money.format(Number(whole / 1000000n) / 1000) + " млрд" : whole >= 1000000n ? money.format(Number(whole / 1000n) / 1000) + " млн" : whole >= 1000n ? money.format(Number(whole) / 1000) + " тыс." : money.format(Number(value) / 100);
    svg.append(element("line", {x1:left,x2:right,y1:y,y2:y,stroke:"#34405a","stroke-width":1,"stroke-dasharray":"3 4"}));
    svg.append(element("text", {x:left-10,y:y+4,fill:"#a7b0c8","font-size":10,"text-anchor":"end"}, label));
  }
  const points = daily.map((value, index) => [left + index * (right - left) / (daily.length - 1), bottom - Number(value * 10000n / max) / 10000 * (bottom - top)]);
  const line = points.map(([x,y], index) => (index ? "L" : "M") + x.toFixed(2) + "," + y.toFixed(2)).join(" ");
  svg.append(element("path", {d:line + " L" + right + "," + bottom + " L" + left + "," + bottom + " Z",fill:"#f48e88","fill-opacity":.10}));
  svg.append(element("path", {d:line,fill:"none",stroke:"#f48e88","stroke-width":2.5,"stroke-linejoin":"round","stroke-linecap":"round"}));
  for (const day of [1,5,10,15,20,25,daily.length]) {
    const x = left + (day - 1) * (right - left) / (daily.length - 1);
    svg.append(element("text", {x,y:214,fill:"#a7b0c8","font-size":10,"text-anchor":"middle"}, String(day)));
  }
  const peak = points[peakDay - 1];
  svg.append(element("circle", {cx:peak[0],cy:peak[1],r:4,fill:"#f48e88",stroke:"#202940","stroke-width":2}));
  container.append(svg);
}

window.matchMedia?.("(max-width: 520px)").addEventListener("change", render);
