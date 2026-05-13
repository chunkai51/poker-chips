// src/table-center-ui.js
// DOM builders for the poker table center area and table-action dialog bodies.

import { createButton, createParagraph } from "./ui-dom.js";

export function createCenterOperationHeader(titleText, metaItems = []) {
  const header = document.createElement("div");
  header.className = "table-center-operation-header";

  const title = document.createElement("strong");
  title.textContent = titleText;
  header.appendChild(title);

  if (metaItems.length > 0) {
    const meta = document.createElement("div");
    meta.className = "table-center-operation-meta";
    metaItems.forEach(text => {
      const item = document.createElement("span");
      item.textContent = text;
      meta.appendChild(item);
    });
    header.appendChild(meta);
  }

  return header;
}

export function createWaitingNotice(text) {
  const notice = document.createElement("div");
  notice.className = "table-waiting-notice";
  const dots = document.createElement("span");
  dots.className = "waiting-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  const label = document.createElement("strong");
  label.textContent = text;
  notice.append(dots, label);
  return notice;
}

export function createTableCenterPanel({ pot, metaItems = [], operations }) {
  const center = document.createElement("section");
  center.className = "poker-table-center";
  center.setAttribute("aria-label", "牌桌状态");

  const eyebrow = document.createElement("span");
  eyebrow.className = "prompt-eyebrow";
  eyebrow.textContent = "Poker Table";
  center.appendChild(eyebrow);

  const potBlock = document.createElement("div");
  potBlock.className = "table-center-pot";
  const potLabel = document.createElement("span");
  potLabel.textContent = "奖池";
  const potValue = document.createElement("strong");
  potValue.textContent = String(pot);
  potBlock.append(potLabel, potValue);
  center.appendChild(potBlock);

  const meta = document.createElement("div");
  meta.className = "table-center-meta";
  metaItems.forEach(text => {
    const item = document.createElement("span");
    item.textContent = text;
    meta.appendChild(item);
  });
  center.appendChild(meta);

  center.appendChild(operations);
  return center;
}

export function renderShowdownSelection(body, {
  pots,
  onToggleWinner,
  onConfirm,
  confirmDisabled
}) {
  body.replaceChildren();

  pots.forEach(potView => {
    const card = document.createElement("div");
    card.classList.add("pot-card");

    const heading = document.createElement("strong");
    heading.textContent = `奖池 ${potView.index + 1}: ${potView.amount} 筹码`;
    card.appendChild(heading);
    card.appendChild(createParagraph(`可争夺玩家: ${potView.contenderNames || "无"}`));

    const options = document.createElement("div");
    options.classList.add("winner-options");
    potView.options.forEach(optionView => {
      const option = createButton(optionView.label, () => {
        onToggleWinner(potView.index, optionView.playerId);
      }, optionView.disabled, "winner-option");
      if (optionView.selected) option.classList.add("selected");
      options.appendChild(option);
    });

    card.appendChild(options);
    body.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.classList.add("showdown-actions");
  actions.appendChild(createButton("预结算", onConfirm, confirmDisabled, "prompt-primary"));
  body.appendChild(actions);
}

export function renderSettlementPreviewContent(body, {
  preview,
  getPlayerLabel,
  waitingText = "",
  showWaiting = false,
  cancelDisabled = false,
  confirmDisabled = false,
  confirmLabel = "确认结算",
  onCancel,
  onConfirm
}) {
  const list = document.createElement("div");
  list.className = "settlement-preview-list";

  preview.pots.forEach(previewPot => {
    const card = document.createElement("div");
    card.className = "settlement-preview-card";

    const heading = document.createElement("strong");
    heading.textContent = `奖池 ${previewPot.index + 1}: ${previewPot.amount} 筹码`;
    card.appendChild(heading);

    previewPot.payouts.forEach(payout => {
      const row = document.createElement("p");
      row.className = "settlement-preview-row";
      row.appendChild(document.createTextNode(getPlayerLabel(payout.playerId)));
      const amount = document.createElement("span");
      amount.textContent = `+${payout.amount}`;
      row.appendChild(amount);
      card.appendChild(row);
    });

    list.appendChild(card);
  });
  body.appendChild(list);

  if (showWaiting && waitingText) {
    body.appendChild(createWaitingNotice(waitingText));
  }

  const actions = document.createElement("div");
  actions.className = "prompt-actions";
  actions.appendChild(createButton("取消，重新选择", onCancel, cancelDisabled, "prompt-secondary"));
  actions.appendChild(createButton(confirmLabel, onConfirm, confirmDisabled, "prompt-primary"));
  body.appendChild(actions);
}
