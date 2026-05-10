// src/ui-dom.js
// Small DOM factories shared by UI modules.

export function createParagraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

export function createButton(label, onClick, disabled = false, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}
