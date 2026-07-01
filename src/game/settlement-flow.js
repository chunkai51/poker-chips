// src/game/settlement-flow.js
// Showdown, winner selection, settlement preview approvals, and payout workflow.

import {
  getApprovalProgress,
  normalizeApprovalMap
} from "../core/approvals.js";
import {
  normalizeIncomingPlayer,
  normalizeIncomingPlayers,
  normalizeSettlementPreview
} from "../room/room-state.js";
import {
  touchMember
} from "../room/identity.js";
import {
  awardRemainingPotState,
  cancelSettlementPreviewState,
  createSettlementPlanState,
  createSettlementPreviewState,
  createShowdownState,
  finalizeSettlementPreviewState,
  getSettlementReport,
  toggleWinnerSelection
} from "./settlement-controller.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function createSettlementFlow({
  getState,
  mutations = {},
  labels = {},
  permissions = {},
  approvals = {},
  remote = {},
  ui = {},
  actions = {}
} = {}) {
  function getSettlementState() {
    return {
      players: [],
      pot: 0,
      bigBlind: 20,
      handId: 0,
      handStatus: "setup",
      stateVersion: 0,
      pendingPots: [],
      selectedWinnersByPot: {},
      settlementPreview: null,
      awaitingShowdown: false,
      clientId: "",
      room: {},
      ...(getState ? getState() : {})
    };
  }

  function applyState(nextState) {
    if (!nextState) return;
    mutations.applyState?.(nextState);
  }

  function getPlayerIdentityLabelById(playerId, list = getSettlementState().players) {
    const index = list.findIndex(player => String(player.id) === String(playerId));
    return index >= 0 ? labels.getPlayerIdentityLabel?.(list[index], index, list) : `玩家 ${playerId}`;
  }

  function getPlayerIdentityLabelsByIds(playerIds = [], list = getSettlementState().players) {
    return playerIds.map(playerId => getPlayerIdentityLabelById(playerId, list));
  }

  function getSettlementReportLines(preview) {
    return getSettlementReport(preview, {
      getPlayerLabel: playerId => labels.getPlayerIdentityLabel?.(actions.getPlayerById?.(playerId))
    });
  }

  function awardRemainingPot(winner) {
    const state = getSettlementState();
    const settlementState = awardRemainingPotState({
      players: state.players,
      winnerId: winner?.id || "",
      pot: state.pot,
      bigBlind: state.bigBlind
    });
    const winnerLabel = settlementState.winnerId
      ? getPlayerIdentityLabelById(settlementState.winnerId, settlementState.players)
      : "无人";
    applyState(settlementState);
    const bustedNames = getPlayerIdentityLabelsByIds(settlementState.bustedPlayerIds);

    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.(`${winnerLabel} 赢得奖池 ${settlementState.wonAmount}`);
    if (bustedNames.length > 0) {
      ui.updateGameLog?.(`${bustedNames.join("、")} 筹码归零，已设为待补码，下一手将跳过。`);
    }
    ui.hideDealPromptPanel?.();
    ui.hideSettlementPreviewPanel?.();
    ui.showNextHandButton?.();
    remote.updateFirebaseState?.();
  }

  function beginShowdown() {
    const state = getSettlementState();
    if (state.awaitingShowdown) return;

    applyState(createShowdownState({ players: state.players, pot: state.pot }));

    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.("下注结束，请开牌，并在牌桌中央为每个奖池选择赢家后确认结算。");
    ui.hideDealPromptPanel?.();
    ui.hideSettlementPreviewPanel?.();
    ui.clearHandActions?.();
    ui.renderShowdownPanel?.();
    remote.updateFirebaseState?.();
  }

  function toggleWinner(potIndex, playerId) {
    const state = getSettlementState();
    if (permissions.isInteractionLocked?.() || state.handStatus !== "showdown") return;

    mutations.applyState?.({
      selectedWinnersByPot: toggleWinnerSelection({
        selectedWinnersByPot: state.selectedWinnersByPot,
        potIndex,
        playerId
      })
    });
    ui.renderShowdownPanel?.();
  }

  function buildSettlementPlan() {
    const state = getSettlementState();
    const { settlementPlan, error } = createSettlementPlanState({
      pendingPots: state.pendingPots,
      players: state.players,
      selectedWinnersByPot: state.selectedWinnersByPot
    });
    if (error) {
      ui.showAppAlert?.(error);
      return null;
    }
    return settlementPlan;
  }

  async function confirmShowdown() {
    const state = getSettlementState();
    const expectedHandId = state.handId;
    const expectedStateVersion = state.stateVersion;
    if (permissions.isInteractionLocked?.() || state.handStatus !== "showdown") {
      ui.showAppAlert?.("当前手牌已不在摊牌结算阶段");
      return;
    }

    const previewState = createSettlementPreviewState({
      pendingPots: state.pendingPots,
      players: state.players,
      selectedWinnersByPot: state.selectedWinnersByPot,
      handId: state.handId
    });
    if (!previewState.ok) {
      ui.showAppAlert?.(previewState.error);
      return;
    }

    mutations.setMutationInProgress?.(true);
    const canSettle = await remote.isRemoteHandStill?.(expectedHandId, ["showdown"]);
    if (!canSettle) {
      mutations.setMutationInProgress?.(false);
      ui.showAppAlert?.("其他设备已经更新结算状态，请等待同步最新状态");
      return;
    }

    mutations.setBatchingStateUpdate?.(true);
    applyState(previewState);

    ui.hideShowdownPanel?.();
    ui.renderSettlementPreviewPanel?.();
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.("已生成结算预览，请确认或取消。");
    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["showdown"],
      expectedStateVersion
    });
    mutations.setMutationInProgress?.(false);
    if (!saved) {
      ui.showAppAlert?.("结算预览没有同步成功，已恢复到最新远端状态");
    }
  }

  async function cancelSettlementPreview() {
    const state = getSettlementState();
    const preview = state.settlementPreview;
    const expectedHandId = state.handId;
    const expectedStateVersion = state.stateVersion;

    if (permissions.isSharedPromptActionLocked?.() || state.handStatus !== "settlementPreview" || !preview) {
      ui.showAppAlert?.("当前没有可取消的结算预览");
      return;
    }

    mutations.setMutationInProgress?.(true);
    mutations.setBatchingStateUpdate?.(true);
    applyState(cancelSettlementPreviewState(preview));

    ui.hideSettlementPreviewPanel?.();
    ui.renderShowdownPanel?.();
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.("结算预览已取消，请重新选择赢家。");
    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["settlementPreview"],
      expectedStateVersion
    });
    mutations.setMutationInProgress?.(false);
    if (!saved) {
      ui.showAppAlert?.("取消结算预览没有同步成功，已恢复到最新远端状态");
    }
  }

  async function confirmSettlementPreview() {
    if (permissions.isRoomMode?.()) {
      await approveSettlementPreview();
      return;
    }
    await finalizeSettlementPreview();
  }

  async function approveSettlementPreview() {
    const state = getSettlementState();
    const preview = state.settlementPreview;
    if (permissions.isSharedPromptActionLocked?.() || state.handStatus !== "settlementPreview" || !preview) {
      ui.showAppAlert?.("当前没有可确认的结算预览");
      return;
    }

    const requiredApprovers = approvals.getSettlementApproverIds?.();
    const progress = getApprovalProgress(preview.approvals, requiredApprovers);
    if (!requiredApprovers.includes(state.clientId)) {
      ui.showAppAlert?.("你不是本手需要确认的玩家。");
      return;
    }
    if (progress.complete) {
      await finalizeSettlementPreview();
      return;
    }
    if (progress.approved[state.clientId]) {
      ui.showAppAlert?.("你已经确认过，正在等待其他玩家。");
      return;
    }

    mutations.setMutationInProgress?.(true);
    let completeAfterCommit = false;
    try {
      const result = await remote.transactRoom(state.room.roomId, (currentRoom) => {
        if (!currentRoom || !currentRoom.gameState || !Array.isArray(currentRoom.players)) return undefined;
        const currentGameState = currentRoom.gameState;
        const currentStatus = String(currentGameState.handStatus || actions.inferHandStatus?.(currentGameState));
        if (currentStatus !== "settlementPreview" || !currentGameState.settlementPreview) return undefined;

        const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
        const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview, { handId: getSettlementState().handId });
        if (!remotePreview) return undefined;
        const remoteRequiredApprovers = approvals.getSettlementApproverIds?.(remotePlayers, currentRoom);
        if (!remoteRequiredApprovers.includes(getSettlementState().clientId)) return undefined;

        remotePreview.approvals = {
          ...normalizeApprovalMap(remotePreview.approvals),
          [getSettlementState().clientId]: true
        };
        const remoteProgress = getApprovalProgress(remotePreview.approvals, remoteRequiredApprovers);
        completeAfterCommit = remoteProgress.complete;
        const nextStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0) + 1;
        const logs = Array.isArray(currentGameState.logs) ? currentGameState.logs.map(String) : [];
        logs.push(`${approvals.getApprovalPlayerLabelForClient?.(getSettlementState().clientId, remotePlayers, currentRoom)} 已确认结算（${remoteProgress.approvedCount}/${remoteProgress.requiredCount}）`);

        return {
          ...currentRoom,
          members: touchMember(currentRoom.members || getSettlementState().room.members, getSettlementState().clientId),
          gameState: {
            ...currentGameState,
            settlementPreview: remotePreview,
            logs,
            stateVersion: nextStateVersion,
            updatedBy: getSettlementState().clientId
          }
        };
      }, { applyLocally: false });

      if (!result.committed) {
        const refreshed = await remote.refreshFromRemote?.();
        if (!refreshed) mutations.setSyncReady?.(false);
        ui.showAppAlert?.("结算确认没有成功，请等待同步后重试。");
        return;
      }

      mutations.setSyncReady?.(true);
      ui.setSyncStatus?.("已同步", "ok");
      await remote.refreshFromRemote?.();
      if (completeAfterCommit) {
        mutations.setMutationInProgress?.(false);
        await finalizeSettlementPreview();
      }
    } catch (_) {
      ui.showAppAlert?.("结算确认同步失败，请稍后再试。");
    } finally {
      mutations.setMutationInProgress?.(false);
    }
  }

  async function finalizeSettlementPreview() {
    const state = getSettlementState();
    const preview = state.settlementPreview;
    const expectedHandId = state.handId;
    const expectedStateVersion = state.stateVersion;

    if (permissions.isSharedPromptActionLocked?.() || state.handStatus !== "settlementPreview" || !preview) {
      ui.showAppAlert?.("当前没有可确认的结算预览");
      return;
    }
    if (permissions.isRoomMode?.()) {
      const requiredApprovers = approvals.getSettlementApproverIds?.();
      const progress = getApprovalProgress(preview.approvals, requiredApprovers);
      if (!progress.complete) {
        ui.showAppAlert?.(approvals.getApprovalStatusText?.(preview.approvals, requiredApprovers));
        return;
      }
    }

    mutations.setMutationInProgress?.(true);
    mutations.setBatchingStateUpdate?.(true);
    const reportLines = getSettlementReportLines(preview);
    const settlementState = finalizeSettlementPreviewState({
      players: state.players,
      preview,
      bigBlind: state.bigBlind
    });
    applyState(settlementState);
    const bustedNames = getPlayerIdentityLabelsByIds(settlementState.bustedPlayerIds);

    ui.hideShowdownPanel?.();
    ui.hideSettlementPreviewPanel?.();
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.(`游戏结束，筹码分配：\n${reportLines.join("\n")}`);
    if (bustedNames.length > 0) {
      ui.updateGameLog?.(`${bustedNames.join("、")} 筹码归零，已设为待补码，下一手将跳过。`);
    }
    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["settlementPreview"],
      expectedStateVersion,
      remoteGuard: (currentRoom, currentGameState) => {
        if (!permissions.isRoomMode?.()) return true;
        const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
        const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview, { handId: getSettlementState().handId });
        const remoteRequiredApprovers = approvals.getSettlementApproverIds?.(remotePlayers, currentRoom);
        return getApprovalProgress(remotePreview?.approvals, remoteRequiredApprovers).complete;
      }
    });
    mutations.setMutationInProgress?.(false);
    if (saved) {
      ui.showNextHandButton?.();
    } else {
      ui.showAppAlert?.("结算没有同步成功，已恢复到最新远端状态");
    }
  }

  return {
    awardRemainingPot,
    beginShowdown,
    toggleWinner,
    buildSettlementPlan,
    getSettlementReportLines,
    getPlayerIdentityLabelById,
    getPlayerIdentityLabelsByIds,
    applyState,
    confirmShowdown,
    cancelSettlementPreview,
    confirmSettlementPreview,
    approveSettlementPreview,
    finalizeSettlementPreview
  };
}
