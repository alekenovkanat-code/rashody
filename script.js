"use strict";

const STORAGE_KEY = "rashody.expenses.v1";
const categories = ["Еда", "Транспорт", "Жилье", "Другое"];
const form = document.querySelector("#expense-form");
const amountInput = document.querySelector("#amount");
const dateInput = document.querySelector("#date");
const categoryInput = document.querySelector("#category");
const commentInput = document.querySelector("#comment");
const status = document.querySelector("#status");
const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });
let expenses = [];
let storageReadable = true;

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

function render() {
  const now = new Date();
  const month = localDate(now).slice(0, 7);
  const total = expenses.reduce((sum, expense) => expense.date.slice(0, 7) === month ? sum + BigInt(expense.minor) : sum, 0n);
  const whole = total / 100n;
  const fraction = Number(total % 100n);
  document.querySelector("#total").textContent = `${money.format(whole).replace(/[\u00a0\u202f]/g, " ")}${fraction ? `,${String(fraction).padStart(2, "0")}` : ""} ₸`;
  document.querySelector("#month-label").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(now);
  document.querySelector("#empty").hidden = expenses.length > 0;
  const list = document.querySelector("#expenses");
  list.replaceChildren();
  for (const expense of expenses) {
    const item = document.createElement("li");
    const heading = document.createElement("div");
    heading.className = "expense-heading";
    const category = document.createElement("span");
    category.textContent = expense.category;
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
  const next = [{ minor, category: categoryInput.value, date: dateInput.value, comment: commentInput.value.trim() }, ...expenses];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    status.textContent = "Не удалось сохранить трату. Проверьте свободное место и доступ к хранилищу браузера.";
    return;
  }
  expenses = next;
  render();
  amountInput.value = "";
  commentInput.value = "";
  status.textContent = "Трата добавлена.";
  amountInput.focus();
});

window.addEventListener("focus", render);
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
setInterval(render, 60000);
