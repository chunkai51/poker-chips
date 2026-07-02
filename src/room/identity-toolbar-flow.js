// src/room/identity-toolbar-flow.js
// Top identity status and in-game table-view toolbar rendering.

import { normalizeRotationOffset } from "../table/table-layout.js";
import {
  loadTableViewRotation as loadStoredTableViewRotation,
  saveTableViewRotation as saveStoredTableViewRotation
} from "../table/table-view-preferences.js";
import { createButton } from "../ui/ui-dom.js";

export function createIdentityToolbarFlow({
  elements = {},
  getState,
  mutations = {},
  modes = {},
  permissions = {},
  identity = {},
  labels = {},
  actions = {},
  ui = {}
} = {}) {
  function getToolbarState() {
    return {
      players: [],
      room: {},
      clientId: "",
      gameStarted: false,
      authReady: false,
      authUnavailable: false,
      syncReady: false,
      syncWriteInProgress: false,
      tableViewRotationOffset: 0,
      ...(getState?.() || {})
    };
  }

  function getPendingRequestCount() {
    return identity.getPendingJoinRequestCount?.() || 0;
  }

  function addPendingRequestBadge(button, label, { floating = false } = {}) {
    const requestCount = getPendingRequestCount();
    if (requestCount <= 0 || !permissions.canCurrentClientManageRoom?.()) return button;

    const badge = document.createElement("span");
    badge.className = "identity-request-badge";
    if (floating) {
      badge.classList.add("is-floating");
      button.classList.add("has-request-badge");
    }
    badge.textContent = requestCount > 9 ? "9+" : String(requestCount);
    button.appendChild(badge);
    button.setAttribute("aria-label", `${label}，${requestCount} 个待处理请求`);
    return button;
  }

  function getTableViewRotationRoomId() {
    return getToolbarState().room.roomId || "local";
  }

  function loadTableViewRotation() {
    const offset = loadStoredTableViewRotation(getTableViewRotationRoomId());
    mutations.setTableViewRotationOffset?.(offset);
    return offset;
  }

  function saveTableViewRotation(offset = getToolbarState().tableViewRotationOffset) {
    saveStoredTableViewRotation(offset, getTableViewRotationRoomId());
  }

  function rotateTableView(delta) {
    const nextOffset = getToolbarState().tableViewRotationOffset + delta;
    mutations.setTableViewRotationOffset?.(nextOffset);
    saveTableViewRotation(nextOffset);
    ui.updatePlayerBoxes?.();
    renderTableViewToolbar();
  }

  function resetTableViewRotation() {
    mutations.setTableViewRotationOffset?.(0);
    saveTableViewRotation(0);
    ui.updatePlayerBoxes?.();
    renderTableViewToolbar();
  }

  function getIdentitySummaryText() {
    const state = getToolbarState();
    const currentPlayer = identity.getCurrentDevicePlayer?.();
    const currentIndex = currentPlayer ? state.players.indexOf(currentPlayer) : -1;
    if (currentPlayer) {
      return `当前设备：${labels.getPlayerIdentityLabel?.(currentPlayer, currentIndex) || "已绑定玩家"} · ${modes.isRoomMode?.() ? `ID ${labels.getClientShortId?.() || "-"}` : "本地控制"}`;
    }
    return modes.isRoomMode?.()
      ? `当前设备未绑定玩家 · ID ${labels.getClientShortId?.() || "-"}`
      : "本地模式：这台设备可以管理整桌";
  }

  function getIdentityAuthText() {
    const state = getToolbarState();
    if (modes.isLocalMode?.()) return "";
    if (state.authUnavailable) {
      return state.syncReady ? "" : state.room.roomId ? "身份连接异常" : "";
    }
    return state.authReady ? "匿名身份" : "身份连接中";
  }

  function renderIdentityControls() {
    const state = getToolbarState();
    const isLocalMode = modes.isLocalMode?.();
    const isRoomMode = modes.isRoomMode?.();
    if (elements.localModeBtn) {
      elements.localModeBtn.classList.toggle("active", isLocalMode);
      elements.localModeBtn.disabled = state.gameStarted && !isLocalMode;
    }
    if (elements.roomModeBtn) {
      elements.roomModeBtn.classList.toggle("active", isRoomMode);
      elements.roomModeBtn.disabled = state.gameStarted && !isRoomMode;
    }
    if (elements.roomEntry) elements.roomEntry.hidden = !isRoomMode;
    const roomAuthPending = isRoomMode && !state.authReady;
    if (elements.createRoomBtn) elements.createRoomBtn.disabled = state.gameStarted || state.syncWriteInProgress || roomAuthPending;
    if (elements.joinRoomBtn) elements.joinRoomBtn.disabled = state.gameStarted || state.syncWriteInProgress || roomAuthPending;
    if (elements.copyInviteBtn) elements.copyInviteBtn.disabled = !isRoomMode || !state.room.roomId;
    if (elements.playerAliasInput && document.activeElement !== elements.playerAliasInput) {
      elements.playerAliasInput.value = identity.getCurrentDisplayName?.() || "";
    }
    if (!elements.deviceIdentityEl) return;

    elements.deviceIdentityEl.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = isRoomMode ? "多人房间" : "单设备本地";
    const detail = document.createElement("span");
    const roomText = isRoomMode
      ? state.room.roomId
        ? `房间 ${state.room.roomId} · ${Object.keys(state.room.members || {}).length || 1} 台设备${getPendingRequestCount() ? ` · ${getPendingRequestCount()} 个请求` : ""}`
        : "先创建或加入房间"
      : "不写入远程房间";
    const authText = getIdentityAuthText();
    detail.textContent = [getIdentitySummaryText(), roomText, authText].filter(Boolean).join(" · ");
    elements.deviceIdentityEl.append(title, detail);
    if (isRoomMode && state.room.roomId) {
      const manageButton = createButton("席位与身份", actions.openTableManager, false, "identity-manage-button");
      addPendingRequestBadge(manageButton, "席位与身份");
      elements.deviceIdentityEl.appendChild(manageButton);
    }
  }

  function renderTableViewToolbar() {
    const state = getToolbarState();
    if (!elements.tableViewToolbar) return;
    elements.tableViewToolbar.replaceChildren();
    if (!state.gameStarted) {
      elements.tableViewToolbar.hidden = true;
      return;
    }

    elements.tableViewToolbar.hidden = false;
    const summary = document.createElement("div");
    summary.className = "table-view-summary";
    const currentPlayer = identity.getCurrentDevicePlayer?.();
    const currentIndex = currentPlayer ? state.players.indexOf(currentPlayer) : -1;
    const title = document.createElement("strong");
    title.textContent = currentPlayer
      ? `我的视角：${labels.getPlayerIdentityLabel?.(currentPlayer, currentIndex) || "已绑定玩家"}`
      : modes.isRoomMode?.()
        ? "旁观视角"
        : "本地整桌视角";
    const detail = document.createElement("span");
    detail.textContent = modes.isRoomMode?.()
      ? "视角旋转只保存在这台设备"
      : "本地模式不绑定玩家身份";
    summary.append(title, detail);
    elements.tableViewToolbar.appendChild(summary);

    if (!modes.isRoomMode?.()) return;

    const controls = document.createElement("div");
    controls.className = "table-view-controls";
    const hasClaimedPlayer = Boolean(currentPlayer);
    const resetDisabled = !hasClaimedPlayer ||
      normalizeRotationOffset(state.tableViewRotationOffset, state.players.length) === 0;
    controls.appendChild(createButton("↺", () => rotateTableView(-1), state.players.length < 2, "table-view-button"));
    controls.appendChild(createButton("以我为底", resetTableViewRotation, resetDisabled, "table-view-button"));
    controls.appendChild(createButton("↻", () => rotateTableView(1), state.players.length < 2, "table-view-button"));
    const identityButton = createButton("身份", actions.openTableManager, false, "table-view-button");
    addPendingRequestBadge(identityButton, "身份", { floating: true });
    controls.appendChild(identityButton);
    elements.tableViewToolbar.appendChild(controls);
  }

  return {
    loadTableViewRotation,
    renderIdentityControls,
    renderTableViewToolbar
  };
}
