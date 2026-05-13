// src/raise-ui.js
// DOM builder for the raise action panel.

import { createButton } from "./ui-dom.js";

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function renderRaisePanelContent(body, {
  infoItems = [],
  presets = [],
  nudges = [],
  defaultTarget = 0,
  maximumTarget = 0,
  step = 1,
  disabled = false,
  getValidation,
  onConfirm
}) {
  const panel = document.createElement("div");
  panel.className = "raise-panel";

  const info = document.createElement("div");
  info.className = "raise-panel-info";
  infoItems.forEach(text => {
    const item = document.createElement("span");
    item.textContent = text;
    info.appendChild(item);
  });
  panel.appendChild(info);

  const presetGrid = document.createElement("div");
  presetGrid.className = "raise-preset-grid";
  presets.forEach(({ label, target }) => {
    presetGrid.appendChild(createButton(`${label} ${target}`, () => {
      setTarget(target);
    }, disabled || target <= 0, "raise-preset-button"));
  });
  panel.appendChild(presetGrid);

  const inputRow = document.createElement("div");
  inputRow.className = "raise-input-row";

  const inputWrap = document.createElement("label");
  inputWrap.className = "raise-target-field";
  const inputLabel = document.createElement("span");
  inputLabel.textContent = "加到";
  const raiseInput = document.createElement("input");
  raiseInput.type = "number";
  raiseInput.inputMode = "numeric";
  raiseInput.min = "0";
  raiseInput.step = String(step);
  raiseInput.value = String(defaultTarget);
  inputWrap.appendChild(inputLabel);
  inputWrap.appendChild(raiseInput);
  inputRow.appendChild(inputWrap);

  const nudgeGrid = document.createElement("div");
  nudgeGrid.className = "raise-nudge-grid";
  nudges.forEach(({ label, delta }) => {
    nudgeGrid.appendChild(createButton(label, () => {
      setTarget(toPositiveInteger(raiseInput.value, 0) + delta);
    }, disabled, "raise-nudge-button"));
  });
  inputRow.appendChild(nudgeGrid);
  panel.appendChild(inputRow);

  const preview = document.createElement("div");
  preview.className = "raise-preview";
  const previewTarget = document.createElement("span");
  const previewCommit = document.createElement("span");
  const previewMessage = document.createElement("em");
  preview.appendChild(previewTarget);
  preview.appendChild(previewCommit);
  preview.appendChild(previewMessage);
  panel.appendChild(preview);

  const confirmButton = createButton("确认 Raise", () => {
    onConfirm(raiseInput.value);
  }, disabled, "action-btn action-confirm raise-confirm-button");
  panel.appendChild(confirmButton);

  function setTarget(value) {
    const nextValue = Math.max(0, Math.min(toPositiveInteger(value, 0), maximumTarget));
    raiseInput.value = String(nextValue);
    updatePreview();
  }

  function updatePreview() {
    const validation = getValidation(raiseInput.value);
    previewTarget.textContent = `加到 ${validation.targetBet || 0}`;
    previewCommit.textContent = `本次投入 ${validation.commitAmount || 0}`;
    previewMessage.textContent = validation.message;
    preview.classList.toggle("is-invalid", !validation.valid);
    confirmButton.textContent = validation.valid
      ? `确认加到 ${validation.targetBet}`
      : "确认 Raise";
    confirmButton.disabled = disabled || !validation.valid;
  }

  raiseInput.addEventListener("input", updatePreview);
  updatePreview();
  body.appendChild(panel);
  requestAnimationFrame(() => raiseInput.focus());
}
