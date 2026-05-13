// src/dialogs.js
// Shared modal/dialog helpers. Business flows provide content and callbacks.

import { createButton, createParagraph } from "./ui-dom.js";

function closeAppDialog(result = false) {
  const backdrop = document.querySelector(".app-dialog-backdrop");
  if (!backdrop) return;

  const resolver = backdrop._resolveDialog;
  const previousFocus = backdrop._previousFocus;
  backdrop.remove();
  if (previousFocus && typeof previousFocus.focus === "function") {
    try {
      previousFocus.focus({ preventScroll: true });
    } catch (_) {
      previousFocus.focus();
    }
  }
  if (resolver) resolver(result);
}

function showAppDialog({
  title = "提示",
  message = "",
  confirmLabel = "知道了",
  cancelLabel = "",
  danger = false
} = {}) {
  closeAppDialog(false);

  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "app-dialog-backdrop";
    backdrop._resolveDialog = resolve;
    backdrop._previousFocus = previousFocus;

    const dialog = document.createElement("section");
    dialog.className = "app-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.addEventListener("click", event => event.stopPropagation());

    const heading = document.createElement("h3");
    heading.textContent = title;
    dialog.appendChild(heading);

    if (message) {
      const content = createParagraph(message);
      content.className = "app-dialog-message";
      dialog.appendChild(content);
    }

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    if (cancelLabel) {
      actions.appendChild(createButton(cancelLabel, () => {
        closeAppDialog(false);
      }, false, "app-dialog-button app-dialog-cancel"));
    }

    const confirmButton = createButton(confirmLabel, () => {
      closeAppDialog(true);
    }, false, danger ? "app-dialog-button app-dialog-confirm danger" : "app-dialog-button app-dialog-confirm");
    actions.appendChild(confirmButton);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", () => {
      closeAppDialog(false);
    });
    backdrop.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAppDialog(false);
      }
    });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => confirmButton.focus());
  });
}

export function showAppAlert(message, title = "提示") {
  return showAppDialog({
    title,
    message,
    confirmLabel: "知道了"
  });
}

export function showAppConfirm(message, {
  title = "请确认",
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false
} = {}) {
  return showAppDialog({
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger
  });
}

export function closeTableActionDialog() {
  document.querySelectorAll(".table-action-dialog-backdrop").forEach(dialog => dialog.remove());
}

export function openTableActionDialog({ title, description = "", className = "", buildContent }) {
  closeTableActionDialog();

  const backdrop = document.createElement("div");
  backdrop.className = className
    ? `table-action-dialog-backdrop ${className}`
    : "table-action-dialog-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeTableActionDialog();
  });

  const panel = document.createElement("section");
  panel.className = "table-action-dialog";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.addEventListener("click", event => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "table-action-dialog-header";

  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  copy.appendChild(heading);
  if (description) {
    copy.appendChild(createParagraph(description));
  }
  header.appendChild(copy);

  const closeButton = createButton("×", closeTableActionDialog, false, "table-action-dialog-close");
  closeButton.setAttribute("aria-label", "关闭浮窗");
  header.appendChild(closeButton);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "table-action-dialog-body";
  buildContent(body, closeTableActionDialog);
  panel.appendChild(body);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
}
