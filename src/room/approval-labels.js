// src/room/approval-labels.js
// Shared approval participant and status-label helpers for synchronized room prompts.

import { getApprovalProgress } from "../core/approvals.js";
import { isEligibleForNextHand } from "../core/game-rules.js";

export function createApprovalLabels({
  getState,
  identity = {},
  labels = {}
} = {}) {
  function readState(list, roomData) {
    const state = getState?.() || {};
    return {
      clientId: state.clientId || "",
      players: Array.isArray(list) ? list : Array.isArray(state.players) ? state.players : [],
      room: roomData || state.room || {}
    };
  }

  function getApprovalPlayerLabelForClient(approverId, list, roomData) {
    const state = readState(list, roomData);
    const controlledPlayers = state.players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => identity.getPlayerControllerId?.(player, state.room) === approverId);

    if (controlledPlayers.length > 0) {
      return controlledPlayers
        .map(({ player, index }) => labels.getPlayerCompactIdentityLabel?.(player, index, state.players) || `玩家${index + 1}`)
        .filter(Boolean)
        .join("、");
    }
    if (approverId === identity.getHostClientId?.(state.room)) return "房主/协管";
    if (approverId === state.clientId) return "我";
    return `设备 ${labels.getClientShortId?.(approverId) || approverId || "-"}`;
  }

  function getUniqueApproverIdsForPlayers(list, roomData) {
    const state = readState(list, roomData);
    return [
      ...new Set(
        state.players
          .map(player => identity.getPlayerControllerId?.(player, state.room))
          .filter(Boolean)
      )
    ];
  }

  function getSettlementApprovalPlayers(list) {
    const state = readState(list);
    return state.players.filter(player => {
      return player.seatStatus === "seated" || player.totalBet > 0 || player.folded || player.allIn;
    });
  }

  function getSettlementApproverIds(list, roomData) {
    return getUniqueApproverIdsForPlayers(getSettlementApprovalPlayers(list), roomData);
  }

  function getNextHandApproverIds(list, roomData) {
    const state = readState(list, roomData);
    return getUniqueApproverIdsForPlayers(state.players.filter(isEligibleForNextHand), state.room);
  }

  function getApprovalStatusText(approvals, requiredIds, list) {
    const state = readState(list);
    const approverIds = Array.isArray(requiredIds) ? requiredIds : [];
    const progress = getApprovalProgress(approvals, approverIds);
    if (approverIds.length === 0) return "无需确认";
    const pending = approverIds
      .filter(approverId => !progress.approved[approverId])
      .map(approverId => getApprovalPlayerLabelForClient(approverId, state.players));
    return pending.length > 0
      ? `已确认 ${progress.approvedCount}/${progress.requiredCount} · 等待 ${pending.join("、")}`
      : `已确认 ${progress.approvedCount}/${progress.requiredCount}`;
  }

  function getApprovalWaitingText(approvals, requiredIds, actionLabel, list) {
    const state = readState(list);
    const approverIds = Array.isArray(requiredIds) ? requiredIds : [];
    const progress = getApprovalProgress(approvals, approverIds);
    const pending = approverIds
      .filter(approverId => !progress.approved[approverId])
      .map(approverId => getApprovalPlayerLabelForClient(approverId, state.players));
    return pending.length > 0
      ? `等待 ${pending.join("、")} ${actionLabel}`
      : `等待同步${actionLabel}`;
  }

  return {
    getApprovalPlayerLabelForClient,
    getUniqueApproverIdsForPlayers,
    getSettlementApprovalPlayers,
    getSettlementApproverIds,
    getNextHandApproverIds,
    getApprovalStatusText,
    getApprovalWaitingText
  };
}
