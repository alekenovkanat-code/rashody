"use strict";

const STORAGE_KEY = "rashody.expenses.v1";
const categories = ["Еда", "Транспорт", "Жилье", "Другое"];
const BUDGET_KEY = "rashody.budgets.v1";
let budgets = {};
let budgetReadable = true;
let budgetMonth = "";
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
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && localDate(date) === value;
}

function parseAmount(value) {
  const normalized = value.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized.replace(",", "."));
  const minor = Math.round(amount * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

function formatMoney(minor) {
  return `${money.format(minor / 100).replace(/[\u00a0\u202f]/g, " ")} ₸`;
}

function formatTotal(total) {
  const whole = total / 100n;
  const fraction = Number(total % 100n);
  return `${money.format(whole).replace(/[\u00a0\u202f]/g, " ")}${fraction ? `,${String(fraction).padStart(2, "0")}` : ""} ₸`;
}

function render() {
  const now = new Date();
  const month = localDate(now).slice(0, 7);
  renderLimits(month, now);
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
  const categoryTotals = document.querySelector("#category-totals");
  categoryTotals.replaceChildren();
  for (const [category, amount] of totals) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    label.textContent = category === "Жилье" ? "Дом" : category;
    const value = document.createElement("dd");
    value.textContent = formatTotal(amount);
    row.append(label, value);
    categoryTotals.append(row);
  }
  document.querySelector("#month-label").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(now);
  document.querySelector("#empty").hidden = expenses.length > 0;
  const list = document.querySelector("#expenses");
  list.replaceChildren();
  for (const expense of expenses) {
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
    for (const [title, action] of [["Изменить", () => startEdit(expense)], ["Удалить", () => deleteExpense(expense)]]) {
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

try {
  const saved = localStorage.getItem(STORAGE_KEY);
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
  const saved = localStorage.getItem(BUDGET_KEY);
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
      input.value = minor === undefined ? "" : money.format(minor / 100).replace(/[\u00a0\u202f]/g, " ");
      remove.hidden = minor === undefined;
    }
    function persist(minor) {
      const currentMonth = localDate(new Date()).slice(0, 7);
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
        localStorage.setItem(BUDGET_KEY, JSON.stringify(next));
      } catch {
        budgetStatus.textContent = "Не удалось сохранить лимит. Проверьте свободное место и доступ к хранилищу браузера.";
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
  status.textContent = wasEditing ? "Трата изменена." : "Трата добавлена.";
  amountInput.focus();
});

window.addEventListener("focus", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
setInterval(render, 60000);

function saveExpenses(next) {
  if (!storageReadable) return false;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); }
  catch { status.textContent = "Не удалось сохранить траты. Проверьте доступ к хранилищу браузера."; return false; }
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
  amountInput.value = money.format(expense.minor / 100);
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
