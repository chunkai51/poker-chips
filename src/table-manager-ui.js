// src/table-manager-ui.js
// DOM builders for the seat and identity management panel.

import { SEAT_STATUS_LABELS, isEligibleForNextHand } from "./game-rules.js";
import { normalizeAdminPlayerIds, normalizePlayerOwnerId } from "./identity.js";
import { createButton, createParagraph } from "./ui-dom.js";

export function renderTableManagerView({
  panel,
  context,
  identity,
  requests = [],
  callbacks,
  formatters
}) {
  panel.replaceChildren();

  panel.appendChild(createTableManagerHeader(context, callbacks));
  if (context.isRoomMode && identity) {
    panel.appendChild(createIdentityManagerPanel(identity, callbacks));
    const requestsPanel = createSeatRequestsPanel({
      requests,
      canManageRoom: context.canManageRoom,
      isActionLocked: context.isActionLocked,
      callbacks
    });
    if (requestsPanel) panel.appendChild(requestsPanel);
  }

  const summary = document.createElement("div");
  summary.className = "table-manager-summary";
  summary.textContent = context.summaryText;
  panel.appendChild(summary);

  const rows = document.createElement("div");
  rows.className = "table-manager-rows";
  context.tableDraft.forEach((draftPlayer, index) => {
    rows.appendChild(createTableManagerRow({
      draftPlayer,
      index,
      context,
      callbacks,
      formatters
    }));
  });
  panel.appendChild(rows);
  panel.appendChild(createTableManagerFooter(context, callbacks));
}

function createTableManagerHeader(context, callbacks) {
  const header = document.createElement("div");
  header.className = "table-manager-header";

  const copy = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "prompt-eyebrow";
  eyebrow.textContent = "Room Seats";
  copy.appendChild(eyebrow);

  const title = document.createElement("h3");
  title.id = "table-manager-title";
  title.textContent = "席位与身份管理";
  copy.appendChild(title);
  copy.appendChild(createParagraph(context.description));
  header.appendChild(copy);

  const closeButton = createButton("×", callbacks.onClose, false, "table-manager-close");
  closeButton.setAttribute("aria-label", "关闭牌桌管理");
  header.appendChild(closeButton);
  return header;
}

function createIdentityManagerPanel(identity, callbacks) {
  const panel = document.createElement("div");
  panel.className = "identity-manager-panel";

  const summary = document.createElement("div");
  summary.className = "identity-manager-summary";
  const title = document.createElement("strong");
  title.textContent = identity.titleText;
  const detail = document.createElement("span");
  detail.textContent = identity.detailText;
  summary.append(title, detail);
  panel.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "identity-manager-actions";
  if (identity.hasCurrentPlayer) {
    actions.appendChild(createButton("退出当前玩家", callbacks.onReleaseCurrentPlayer, identity.isActionLocked, "table-chip-button"));
  }

  actions.appendChild(createButton("复制邀请", callbacks.onCopyInvite, !identity.roomId, "table-chip-button"));

  if (identity.isAdmin && identity.pendingRequestCount > 0) {
    actions.appendChild(createButton(`处理请求 ${identity.pendingRequestCount}`, () => {
      callbacks.onShowPendingRequests(identity.pendingRequestCount);
    }, false, "table-chip-button"));
  }

  panel.appendChild(actions);
  return panel;
}

function createSeatRequestsPanel({ requests, canManageRoom, isActionLocked, callbacks }) {
  if (!requests.length) return null;
  const panel = document.createElement("div");
  panel.className = "seat-requests-panel";

  const title = document.createElement("strong");
  title.textContent = requests.length
    ? `入座请求（${requests.length}）`
    : "入座请求";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "seat-request-list";
  requests.forEach(request => {
    const row = document.createElement("div");
    row.className = "seat-request-row";
    const copy = document.createElement("span");
    copy.textContent = request.text;
    row.appendChild(copy);

    if (canManageRoom) {
      const actions = document.createElement("div");
      actions.className = "seat-request-actions";
      actions.appendChild(createButton("批准", () => callbacks.onApproveSeatRequest(request.clientId), isActionLocked, "table-chip-button"));
      actions.appendChild(createButton("拒绝", () => callbacks.onDeclineSeatRequest(request.clientId), isActionLocked, "table-chip-button table-danger-button"));
      row.appendChild(actions);
    }
    list.appendChild(row);
  });
  panel.appendChild(list);
  return panel;
}

function createTableManagerFooter(context, callbacks) {
  const footer = document.createElement("div");
  footer.className = "table-manager-footer";

  const addButton = createButton(context.addButtonLabel, callbacks.onAddPlayer, context.addDisabled, "prompt-secondary");
  footer.appendChild(addButton);

  const actionGroup = document.createElement("div");
  actionGroup.className = "table-manager-save-actions";
  actionGroup.appendChild(createButton("取消", callbacks.onClose, false, "prompt-secondary"));
  actionGroup.appendChild(createButton("保存牌桌", () => callbacks.onSave({ startNextHand: false }), context.saveDisabled, "prompt-secondary"));
  actionGroup.appendChild(createButton("保存并开始下一局", () => callbacks.onSave({ startNextHand: true }), context.saveAndStartDisabled, "prompt-primary"));
  footer.appendChild(actionGroup);
  return footer;
}

function createTableManagerRow({ draftPlayer, index, context, callbacks, formatters }) {
  const row = document.createElement("div");
  row.className = "table-manager-row";
  if (!isEligibleForNextHand(context.normalizeDraftPlayer(draftPlayer, index))) {
    row.classList.add("is-inactive");
  }

  row.appendChild(createSeatCell({ index, context, callbacks }));
  row.appendChild(createNameInput({ draftPlayer, index, context, callbacks }));
  row.appendChild(createChipsCell({ draftPlayer, index, context, callbacks, formatters }));
  row.appendChild(createStatusCell({ draftPlayer, index, context, callbacks, formatters }));

  if (context.isRoomMode) {
    row.appendChild(createSeatIdentityCell({
      draftPlayer,
      index,
      context,
      callbacks,
      formatters
    }));
  }

  return row;
}

function createSeatCell({ index, context, callbacks }) {
  const seat = document.createElement("div");
  seat.className = "table-seat-cell";
  const seatLabel = document.createElement("strong");
  seatLabel.textContent = `座位 ${index + 1}`;
  seat.appendChild(seatLabel);

  const moveActions = document.createElement("div");
  moveActions.className = "table-seat-actions";
  moveActions.appendChild(createButton("↑", () => callbacks.onMoveDraftPlayer(index, -1), !context.canEdit || index === 0, "table-icon-button"));
  moveActions.appendChild(createButton("↓", () => callbacks.onMoveDraftPlayer(index, 1), !context.canEdit || index === context.tableDraft.length - 1, "table-icon-button"));
  seat.appendChild(moveActions);
  return seat;
}

function createNameInput({ draftPlayer, index, context, callbacks }) {
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = draftPlayer.name;
  nameInput.placeholder = "待入座";
  nameInput.setAttribute("aria-label", `座位 ${index + 1} 玩家名`);
  nameInput.disabled = !context.canEdit;
  nameInput.addEventListener("input", () => {
    callbacks.onDraftNameInput(index, nameInput.value);
  });
  return nameInput;
}

function createChipsCell({ draftPlayer, index, context, callbacks, formatters }) {
  const chipsCell = document.createElement("div");
  chipsCell.className = "table-chip-cell";
  const chipsInput = document.createElement("input");
  chipsInput.type = "number";
  chipsInput.inputMode = "numeric";
  chipsInput.min = "0";
  chipsInput.step = "10";
  chipsInput.value = String(draftPlayer.chips);
  chipsInput.setAttribute("aria-label", `${formatters.getPlayerName(draftPlayer)} 筹码`);
  chipsInput.disabled = !context.canEdit;
  chipsInput.addEventListener("change", () => {
    callbacks.onSetDraftChips(index, chipsInput.value);
  });
  chipsCell.appendChild(chipsInput);

  const chipActions = document.createElement("div");
  chipActions.className = "table-chip-actions";
  chipActions.appendChild(createButton("-100", () => callbacks.onAdjustDraftChips(index, -100), !context.canEdit || draftPlayer.chips <= 0, "table-chip-button"));
  chipActions.appendChild(createButton("+100", () => callbacks.onAdjustDraftChips(index, 100), !context.canEdit, "table-chip-button"));
  chipActions.appendChild(createButton("+500", () => callbacks.onAdjustDraftChips(index, 500), !context.canEdit, "table-chip-button"));
  chipActions.appendChild(createButton("+1000", () => callbacks.onAdjustDraftChips(index, 1000), !context.canEdit, "table-chip-button"));
  chipsCell.appendChild(chipActions);
  return chipsCell;
}

function createStatusCell({ draftPlayer, index, context, callbacks, formatters }) {
  const statusCell = document.createElement("div");
  statusCell.className = "table-status-cell";
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", `${formatters.getPlayerName(draftPlayer)} 状态`);
  statusSelect.disabled = !context.canEdit;
  Object.entries(SEAT_STATUS_LABELS).forEach(([status, label]) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = label;
    option.selected = draftPlayer.seatStatus === status;
    statusSelect.appendChild(option);
  });
  statusSelect.addEventListener("change", () => {
    callbacks.onSetDraftStatus(index, statusSelect.value);
  });
  statusCell.appendChild(statusSelect);

  const quickActions = document.createElement("div");
  quickActions.className = "table-status-actions";
  if (draftPlayer.seatStatus === "seated") {
    quickActions.appendChild(createButton("坐出", () => callbacks.onSetDraftStatus(index, "sittingOut"), !context.canEdit, "table-chip-button"));
    quickActions.appendChild(createButton("离桌", () => callbacks.onSetDraftStatus(index, "left"), !context.canEdit, "table-chip-button table-danger-button"));
  } else {
    quickActions.appendChild(createButton("回桌", () => callbacks.onReturnSeat(index), !context.canEdit, "table-chip-button"));
  }
  quickActions.appendChild(createButton("删除", () => callbacks.onDeleteDraftPlayer(index), !context.canEdit || context.tableDraft.length <= 2, "table-chip-button table-danger-button"));
  statusCell.appendChild(quickActions);
  return statusCell;
}

function createSeatIdentityCell({ draftPlayer, context, callbacks, formatters }) {
  const cell = document.createElement("div");
  cell.className = "table-identity-cell";
  const savedPlayer = formatters.getSavedPlayer(draftPlayer.id);
  const player = savedPlayer || draftPlayer;
  const ownerId = normalizePlayerOwnerId(player.ownerClientId);
  const adminIds = normalizeAdminPlayerIds(context.adminPlayerIds);
  const status = document.createElement("span");
  status.className = "table-identity-status";
  status.textContent = formatters.isCurrentDevicePlayer(player)
    ? "当前设备"
    : ownerId
      ? `已绑定 ${formatters.getClientShortId(ownerId)}`
      : "未绑定";
  if (adminIds.includes(draftPlayer.id)) {
    status.textContent += " · 协管";
  }
  cell.appendChild(status);

  const requests = formatters.getJoinRequestsForPlayer(draftPlayer.id);
  if (requests.length) {
    const requestSummary = document.createElement("span");
    requestSummary.className = "table-identity-status";
    requestSummary.textContent = `${requests.length} 个待批准请求`;
    cell.appendChild(requestSummary);
  }

  const actions = document.createElement("div");
  actions.className = "table-identity-actions";
  actions.appendChild(createButton(formatters.isCurrentDevicePlayer(player) ? "已绑定" : ownerId ? "已有人入座" : context.canManageRoom ? "绑定到我" : "请求坐下", () => {
    if (formatters.isCurrentDevicePlayer(player)) return;
    callbacks.onTogglePlayerClaim(draftPlayer.id);
  }, context.isActionLocked || !savedPlayer || formatters.isCurrentDevicePlayer(player), "table-chip-button"));

  if (context.canManageRoom) {
    const isAdminPlayer = adminIds.includes(draftPlayer.id);
    actions.appendChild(createButton(isAdminPlayer ? "撤销协管" : "设为协管", () => {
      callbacks.onTogglePlayerAdmin(draftPlayer.id, !isAdminPlayer);
    }, context.isActionLocked || !savedPlayer, "table-chip-button"));
  }
  cell.appendChild(actions);
  return cell;
}
