// src/room/game-sync-flow.js
// Guarded remote writes for in-hand game state.

import {
  buildGuardedRoomSyncPayload,
  buildMergedRoomSyncPayload,
  createGameStateSnapshot,
  prepareRoomDataForGameSync
} from "./game-state-snapshot.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function createGameSyncFlow({
  getState,
  mutations = {},
  remote = {},
  ui = {},
  helpers = {}
} = {}) {
  function getSyncState() {
    return {
      room: {},
      players: [],
      currentRound: 0,
      pot: 0,
      currentBet: 0,
      lastRaiseSize: 20,
      currentPlayerIndex: -1,
      gameOver: false,
      awaitingShowdown: false,
      pendingPots: [],
      selectedWinnersByPot: {},
      pendingDealPrompt: null,
      settlementPreview: null,
      nextHandApprovals: {},
      handId: 0,
      handStatus: "setup",
      stateVersion: 0,
      clientId: "",
      batchingStateUpdate: false,
      ...(getState ? getState() : {})
    };
  }

  async function isRemoteHandStill(expectedHandId, allowedStatuses) {
    const state = getSyncState();
    const remoteGameState = await remote.getRemoteGameState?.();
    if (!remoteGameState) return !state.room.roomId;

    const remoteHandId = toNonNegativeNumber(remoteGameState.handId, 0);
    const remoteStatus = String(remoteGameState.handStatus || helpers.inferHandStatus?.(remoteGameState));
    return remoteHandId === expectedHandId && allowedStatuses.includes(remoteStatus);
  }

  async function updateFirebaseState(options = {}) {
    const state = getSyncState();
    if (!state.room.roomId) return true;
    if (state.batchingStateUpdate) return true;

    const {
      expectedHandId = null,
      allowedStatuses = null,
      expectedStateVersion = null,
      remoteGuard = null
    } = options;
    const guardedWrite = expectedHandId !== null ||
      expectedStateVersion !== null ||
      Array.isArray(allowedStatuses);
    const nextStateVersion = state.stateVersion + 1;

    const nextGameState = createGameStateSnapshot({
      currentRound: state.currentRound,
      pot: state.pot,
      currentBet: state.currentBet,
      lastRaiseSize: state.lastRaiseSize,
      currentPlayerIndex: state.currentPlayerIndex,
      logs: state.room.gameState.logs,
      inProgress: state.room.gameState.inProgress,
      gameOver: state.gameOver,
      awaitingShowdown: state.awaitingShowdown,
      pendingPots: state.pendingPots,
      selectedWinnersByPot: state.selectedWinnersByPot,
      pendingDealPrompt: state.pendingDealPrompt,
      settlementPreview: state.settlementPreview,
      nextHandApprovals: state.nextHandApprovals,
      handId: state.handId,
      handStatus: state.handStatus,
      stateVersion: nextStateVersion,
      updatedBy: state.clientId
    });
    const preparedSync = prepareRoomDataForGameSync({
      room: state.room,
      players: state.players,
      clientId: state.clientId,
      nextGameState,
      normalizeRoomMode: helpers.normalizeRoomMode,
      getRoomHostId: helpers.getRoomHostId,
      normalizeAdminPlayerIds: helpers.normalizeAdminPlayerIds,
      normalizeJoinRequests: helpers.normalizeJoinRequests,
      touchMemberWithProfile: helpers.touchMemberWithProfile
    });
    mutations.setRoom?.(preparedSync.room);
    const nextRoomData = preparedSync.roomData;

    mutations.setSyncWriteInProgress?.(true);
    ui.setSyncStatus?.("同步中...");
    ui.refreshInteractiveControls?.();

    try {
      if (guardedWrite) {
        const result = await remote.transactRoom(state.room.roomId, (currentRoom) => {
          return buildGuardedRoomSyncPayload({
            currentRoom,
            nextRoomData,
            roomId: state.room.roomId,
            expectedHandId,
            expectedStateVersion,
            allowedStatuses,
            remoteGuard,
            toNonNegativeNumber,
            inferHandStatus: helpers.inferHandStatus,
            mergePlayerIdentityFields: helpers.mergePlayerIdentityFields,
            normalizeRoomMode: helpers.normalizeRoomMode,
            getRoomHostId: helpers.getRoomHostId,
            normalizeAdminPlayerIds: helpers.normalizeAdminPlayerIds,
            normalizeJoinRequests: helpers.normalizeJoinRequests,
            normalizeMembers: helpers.normalizeMembers
          });
        }, { applyLocally: false });

        if (!result.committed) {
          const refreshed = await remote.refreshFromRemote?.();
          if (!refreshed) mutations.setSyncReady?.(false);
          ui.setSyncStatus?.("同步被其他设备抢先更新", "error");
          return false;
        }
      } else {
        const result = await remote.transactRoom(state.room.roomId, (currentRoom) => {
          return buildMergedRoomSyncPayload({
            currentRoom,
            nextRoomData,
            roomId: state.room.roomId,
            mergePlayerIdentityFields: helpers.mergePlayerIdentityFields,
            normalizeRoomMode: helpers.normalizeRoomMode,
            getRoomHostId: helpers.getRoomHostId,
            normalizeAdminPlayerIds: helpers.normalizeAdminPlayerIds,
            normalizeJoinRequests: helpers.normalizeJoinRequests,
            normalizeMembers: helpers.normalizeMembers
          });
        }, { applyLocally: false });

        if (!result.committed) {
          const refreshed = await remote.refreshFromRemote?.();
          if (!refreshed) mutations.setSyncReady?.(false);
          ui.setSyncStatus?.("同步被其他设备抢先更新", "error");
          return false;
        }
      }

      mutations.setStateVersion?.(nextStateVersion);
      const latestRoom = getSyncState().room;
      latestRoom.gameState = nextGameState;
      mutations.setRoom?.(latestRoom);
      mutations.setSyncReady?.(true);
      ui.setSyncStatus?.("已同步", "ok");
      return true;
    } catch (error) {
      const permissionDenied = String(error?.message || error).includes("permission");
      ui.setSyncStatus?.(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
      const refreshed = await remote.refreshFromRemote?.();
      if (!refreshed) mutations.setSyncReady?.(false);
      return false;
    } finally {
      mutations.setSyncWriteInProgress?.(false);
      ui.refreshInteractiveControls?.();
    }
  }

  return {
    isRemoteHandStill,
    updateFirebaseState
  };
}
