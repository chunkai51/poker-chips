// src/game/start-game-flow.js
// Owns the setup-page flow that starts the first hand.

import { normalizeRoomId } from "../room/room-entry.js";
import {
  ROOM_MODES,
  createMembersMap,
  normalizePlayerOwnerId
} from "../room/identity.js";

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createStartGameFlow({
  elements,
  maxPlayers,
  getState,
  mutations,
  modes,
  permissions,
  remote,
  setup,
  ui,
  actions
} = {}) {
  async function prepareRoomForStart(roomId) {
    const state = getState?.() || {};
    if (modes.isRoomMode?.()) {
      if (!roomId) {
        return remote.createRoomIfAvailable?.({ announce: false });
      }

      const exists = await remote.remoteRoomExists?.(roomId);
      if (exists === null) return false;
      if (!exists) {
        mutations.applyRoomPatch?.({ roomId });
        if (elements.roomIdInput) elements.roomIdInput.value = roomId;
        return remote.createRoomIfAvailable?.({ announce: false });
      }

      remote.joinRoom?.(roomId);
      const refreshed = await remote.refreshFromRemote?.();
      if (!refreshed) {
        ui.showAppAlert?.("无法读取该房间，请检查网络后刷新重试。");
        return false;
      }
      if (!permissions.canCurrentClientManageRoom?.()) {
        ui.showAppAlert?.("只有房主或协管可以开始牌局。");
        return false;
      }
      const remoteGameState = await remote.getRemoteGameState?.();
      const remoteStatus = remoteGameState
        ? String(remoteGameState.handStatus || actions.inferHandStatus?.(remoteGameState))
        : "setup";
      if (remoteGameState && remoteStatus !== "setup") {
        ui.showAppAlert?.("该房间已有牌局状态，请等待同步完成，不要从本地设置页重新开始");
        return false;
      }
      return true;
    }

    remote.stopListener?.();
    mutations.applyRoomPatch?.({
      roomId: "",
      mode: ROOM_MODES.local,
      operator: state.clientId,
      hostClientId: state.clientId,
      members: createMembersMap(state.clientId)
    });
    if (elements.roomIdInput) elements.roomIdInput.value = "";
    mutations.setSyncReady?.(true);
    ui.setSyncStatus?.("本地模式");
    return true;
  }

  function buildStartingPlayers(sourcePlayers, createPlayerId) {
    return sourcePlayers.map((player, index) => ({
      id: String(player.id || createPlayerId?.() || `player-${index + 1}`),
      name: String(player.name || "").trim() || `玩家${index + 1}`,
      seatIndex: index,
      seatStatus: "seated",
      chips: toPositiveInteger(player.chips, 1000),
      folded: false,
      dealer: index === 0,
      ownerClientId: normalizePlayerOwnerId(player.ownerClientId),
      playerKeyHash: String(player.playerKeyHash || ""),
      bet: 0,
      totalBet: 0,
      allIn: false,
      acted: false,
      position: ""
    }));
  }

  async function startGame() {
    const state = getState?.() || {};
    if (state.mutationInProgress) return;
    if (!permissions.canCurrentClientManageRoom?.()) {
      ui.showAppAlert?.("只有房主或协管可以开始牌局。");
      return;
    }

    mutations.setMutationInProgress?.(true);
    try {
      const roomId = normalizeRoomId(elements.roomIdInput?.value || "");
      const roomReady = await prepareRoomForStart(roomId);
      if (!roomReady) return;

      setup.normalizePlayers?.();
      const nextState = getState?.() || {};
      const sourcePlayers = Array.isArray(nextState.players) ? nextState.players : [];
      if (sourcePlayers.length < 2) {
        ui.showAppAlert?.("至少需要两个玩家开始游戏");
        return;
      }
      if (sourcePlayers.length > maxPlayers) {
        ui.showAppAlert?.(`最多支持 ${maxPlayers} 名玩家`);
        return;
      }

      const nextBigBlind = toPositiveInteger(elements.bigBlindInput?.value, 20);
      const nextSmallBlind = Math.floor(nextBigBlind / 2);
      mutations.applyStartState?.({
        players: buildStartingPlayers(sourcePlayers, setup.createPlayerId),
        bigBlind: nextBigBlind,
        smallBlind: nextSmallBlind,
        handId: toPositiveInteger(nextState.handId, 0) + 1
      });

      ui.clearGameLog?.();
      ui.showGameTable?.();
      ui.clearHandActions?.();
      ui.hideShowdownPanel?.();
      ui.hideDealPromptPanel?.();
      ui.hideSettlementPreviewPanel?.();
      actions.startRound?.();
    } finally {
      mutations.setMutationInProgress?.(false);
    }
  }

  function bindStartButton() {
    elements.startGameBtn?.addEventListener("click", startGame);
  }

  return {
    bindStartButton,
    startGame
  };
}
