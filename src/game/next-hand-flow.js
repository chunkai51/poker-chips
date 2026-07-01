// src/game/next-hand-flow.js
// Post-settlement next-hand approval and reset workflow.

import {
  getApprovalProgress,
  normalizeApprovalMap
} from "../core/approvals.js";
import {
  normalizeIncomingPlayer,
  normalizeIncomingPlayers
} from "../room/room-state.js";
import {
  touchMember
} from "../room/identity.js";
import {
  prepareNextHandResetState
} from "./hand-controller.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function createNextHandFlow({
  getState,
  mutations = {},
  permissions = {},
  approvals = {},
  rules = {},
  remote = {},
  ui = {},
  actions = {}
} = {}) {
  function getNextHandState() {
    return {
      players: [],
      room: {},
      clientId: "",
      handId: 0,
      handStatus: "setup",
      stateVersion: 0,
      gameOver: false,
      nextHandApprovals: {},
      bigBlind: 20,
      mutationInProgress: false,
      ...(getState ? getState() : {})
    };
  }

  function applyState(patch = {}) {
    mutations.applyState?.(patch);
  }

  async function approveNextHandStart(expectedHandId = getNextHandState().handId) {
    const state = getNextHandState();
    if (permissions.isLocalMode?.()) {
      await resetHand(expectedHandId);
      return;
    }
    if (permissions.isInteractionLocked?.()) return;
    if (!state.gameOver || state.handStatus !== "settled") {
      ui.showAppAlert?.("当前手牌还没有完成结算，不能确认下一局");
      return;
    }

    const requiredApprovers = approvals.getNextHandApproverIds?.();
    const progress = getApprovalProgress(state.nextHandApprovals, requiredApprovers);
    if (!requiredApprovers.includes(state.clientId)) {
      ui.showAppAlert?.("你不是下一局需要确认的玩家。");
      return;
    }
    if (progress.complete) {
      await resetHand(expectedHandId);
      return;
    }
    if (progress.approved[state.clientId]) {
      ui.showAppAlert?.("你已经确认过，正在等待其他玩家。");
      return;
    }

    mutations.setMutationInProgress?.(true);
    let completeAfterCommit = false;
    try {
      const result = await remote.transactRoom?.(state.room.roomId, (currentRoom) => {
        if (!currentRoom || !currentRoom.gameState || !Array.isArray(currentRoom.players)) return undefined;
        const currentGameState = currentRoom.gameState;
        const currentStatus = String(currentGameState.handStatus || actions.inferHandStatus?.(currentGameState));
        if (currentStatus !== "settled") return undefined;

        const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
        const remoteRequiredApprovers = approvals.getNextHandApproverIds?.(remotePlayers, currentRoom);
        const actorClientId = getNextHandState().clientId;
        if (remoteRequiredApprovers.length < 1 || !remoteRequiredApprovers.includes(actorClientId)) return undefined;

        const nextApprovals = {
          ...normalizeApprovalMap(currentGameState.nextHandApprovals),
          [actorClientId]: true
        };
        const remoteProgress = getApprovalProgress(nextApprovals, remoteRequiredApprovers);
        completeAfterCommit = remoteProgress.complete;
        const nextStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0) + 1;
        const logs = Array.isArray(currentGameState.logs) ? currentGameState.logs.map(String) : [];
        logs.push(`${approvals.getApprovalPlayerLabelForClient?.(actorClientId, remotePlayers, currentRoom)} 已确认下一局（${remoteProgress.approvedCount}/${remoteProgress.requiredCount}）`);

        return {
          ...currentRoom,
          members: touchMember(currentRoom.members || getNextHandState().room.members, actorClientId),
          gameState: {
            ...currentGameState,
            nextHandApprovals: nextApprovals,
            logs,
            stateVersion: nextStateVersion,
            updatedBy: actorClientId
          }
        };
      }, { applyLocally: false });

      if (!result.committed) {
        const refreshed = await remote.refreshFromRemote?.();
        if (!refreshed) mutations.setSyncReady?.(false);
        ui.showAppAlert?.("下一局确认没有成功，请等待同步后重试。");
        return;
      }

      mutations.setSyncReady?.(true);
      ui.setSyncStatus?.("已同步", "ok");
      await remote.refreshFromRemote?.();
      if (completeAfterCommit) {
        mutations.setMutationInProgress?.(false);
        await resetHand(expectedHandId);
      }
    } catch (_) {
      ui.showAppAlert?.("下一局确认同步失败，请稍后再试。");
    } finally {
      mutations.setMutationInProgress?.(false);
    }
  }

  async function resetHand(expectedHandId = getNextHandState().handId) {
    const state = getNextHandState();
    const expectedStateVersion = state.stateVersion;
    if (state.mutationInProgress) return;
    if (!state.gameOver || state.handStatus !== "settled") {
      ui.showAppAlert?.("当前手牌还没有完成结算，不能开始下一局");
      return;
    }
    if (rules.getEligiblePlayerIndices?.().length < 2) {
      ui.showAppAlert?.("至少需要 2 名已入座且有筹码的玩家才能开始下一局，请先打开牌桌管理补码或回桌。");
      ui.renderNextHandButton?.();
      return;
    }
    if (permissions.isRoomMode?.()) {
      const requiredApprovers = approvals.getNextHandApproverIds?.();
      const progress = getApprovalProgress(state.nextHandApprovals, requiredApprovers);
      if (!progress.complete) {
        ui.showAppAlert?.(approvals.getApprovalStatusText?.(state.nextHandApprovals, requiredApprovers));
        return;
      }
    }

    mutations.setMutationInProgress?.(true);
    const canReset = await remote.isRemoteHandStill?.(expectedHandId, ["settled"]);
    if (!canReset) {
      mutations.setMutationInProgress?.(false);
      ui.clearHandActions?.();
      ui.showAppAlert?.("其他设备已经开始了下一局，请等待同步最新状态");
      return;
    }

    mutations.setBatchingStateUpdate?.(true);
    const resetState = prepareNextHandResetState({
      players: getNextHandState().players,
      expectedHandId,
      bigBlind: getNextHandState().bigBlind
    });
    if (!resetState.ok) {
      mutations.setBatchingStateUpdate?.(false);
      mutations.setMutationInProgress?.(false);
      ui.showAppAlert?.("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
      ui.renderNextHandButton?.();
      return;
    }

    applyState(resetState);
    ui.clearGameLog?.();
    ui.clearHandActions?.();
    ui.hideShowdownPanel?.();
    ui.hideDealPromptPanel?.();
    ui.hideSettlementPreviewPanel?.();
    mutations.setRoomGameInProgress?.(true);
    actions.startRound?.();
    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["settled"],
      expectedStateVersion,
      remoteGuard: (currentRoom, currentGameState) => {
        if (!permissions.isRoomMode?.()) return true;
        const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
        const remoteRequiredApprovers = approvals.getNextHandApproverIds?.(remotePlayers, currentRoom);
        const remoteApprovals = normalizeApprovalMap(currentGameState.nextHandApprovals);
        return getApprovalProgress(remoteApprovals, remoteRequiredApprovers).complete;
      }
    });
    mutations.setMutationInProgress?.(false);
    if (!saved) {
      ui.showAppAlert?.("下一局没有同步成功，已恢复到最新远端状态");
    }
  }

  return {
    approveNextHandStart,
    resetHand
  };
}
