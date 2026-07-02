// src/room/room-data-flow.js
// Applies incoming room snapshots to local browser state and refreshes the app shell.

import { normalizeApprovalMap } from "../core/approvals.js";
import {
  normalizeIncomingDealPrompt as normalizeDealPrompt
} from "../core/deal-prompts.js";
import {
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeRoomMode
} from "./identity.js";
import {
  normalizeInviteToken,
  normalizeJoinRequests
} from "./room-entry.js";
import {
  normalizeIncomingPlayer,
  normalizeIncomingPots,
  normalizeSelectedWinnersByPot,
  normalizeSettlementPreview
} from "./room-state.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createRoomDataFlow({
  getState,
  mutations = {},
  helpers = {},
  ui = {},
  setup = {},
  actions = {}
} = {}) {
  function applyRoomData(data) {
    const state = getState?.() || {};
    const gameState = data?.gameState || {};
    const previousRoom = state.room || {};
    const previousGameState = previousRoom.gameState || {};
    const nextPlayers = Array.isArray(data?.players)
      ? data.players.map(normalizeIncomingPlayer)
      : state.players || [];
    const nextOperator = String(data?.operator || previousRoom.operator || state.clientId || "");
    const nextHandStatus = String(gameState.handStatus || actions.inferHandStatus?.(gameState));
    const nextRoom = {
      ...previousRoom,
      mode: normalizeRoomMode(data?.mode, previousRoom.roomId),
      operator: nextOperator,
      hostClientId: getRoomHostId(data, nextOperator || state.clientId),
      inviteToken: normalizeInviteToken(data?.inviteToken || previousRoom.inviteToken || ""),
      adminKeyHash: String(data?.adminKeyHash || previousRoom.adminKeyHash || ""),
      adminPlayerIds: normalizeAdminPlayerIds(data?.adminPlayerIds),
      joinRequests: normalizeJoinRequests(data?.joinRequests),
      members: helpers.touchMemberWithProfile?.(data?.members, state.clientId) || previousRoom.members || {},
      players: nextPlayers,
      gameState: {
        ...previousGameState,
        logs: Array.isArray(gameState.logs) ? gameState.logs.map(String) : [],
        inProgress: Boolean(gameState.inProgress)
      }
    };

    mutations.applyRoomDataState?.({
      currentRound: toNonNegativeNumber(gameState.currentRound, 0),
      pot: toNonNegativeNumber(gameState.pot, 0),
      currentBet: toNonNegativeNumber(gameState.currentBet, 0),
      lastRaiseSize: toPositiveInteger(gameState.lastRaiseSize, state.bigBlind),
      currentPlayerIndex: Number.isInteger(gameState.currentPlayerIndex)
        ? gameState.currentPlayerIndex
        : -1,
      gameOver: Boolean(gameState.gameOver),
      awaitingShowdown: Boolean(gameState.awaitingShowdown),
      pendingPots: normalizeIncomingPots(gameState.pendingPots),
      selectedWinnersByPot: normalizeSelectedWinnersByPot(gameState.selectedWinnersByPot),
      pendingDealPrompt: normalizeDealPrompt(gameState.pendingDealPrompt, {
        handId: state.handId,
        roundCount: Array.isArray(state.rounds) ? state.rounds.length : 4
      }),
      settlementPreview: normalizeSettlementPreview(gameState.settlementPreview, { handId: state.handId }),
      nextHandApprovals: normalizeApprovalMap(gameState.nextHandApprovals),
      handId: toNonNegativeNumber(gameState.handId, state.handId),
      handStatus: nextHandStatus,
      stateVersion: toNonNegativeNumber(gameState.stateVersion, state.stateVersion),
      players: nextPlayers,
      room: nextRoom
    });

    ui.syncIdentityFromPlayers?.(nextPlayers);
    ui.renderIdentityControls?.();
    ui.renderGameLog?.(nextRoom.gameState.logs);
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.renderTableViewToolbar?.();
    ui.renderDealPromptPanel?.();
    ui.renderSettlementPreviewPanel?.();

    if (nextHandStatus === "waitingDeal") {
      ui.hideShowdownPanel?.();
      ui.clearHandActions?.();
    } else if (nextHandStatus === "settlementPreview") {
      ui.hideShowdownPanel?.();
      ui.clearHandActions?.();
    } else if (Boolean(gameState.awaitingShowdown)) {
      ui.renderShowdownPanel?.();
    } else {
      ui.hideShowdownPanel?.();
    }

    if (Boolean(gameState.gameOver) && !Boolean(gameState.awaitingShowdown)) {
      ui.renderNextHandButton?.();
    } else if (!Boolean(gameState.gameOver) && nextHandStatus === "playing") {
      ui.renderCurrentActionPanel?.();
    } else {
      ui.clearHandActions?.();
    }

    if (gameState.inProgress === true) {
      ui.showGameTable?.();
      mutations.setGameStarted?.(true);
    } else if (!state.gameStarted) {
      ui.showSetup?.();
      setup.renderPlayers?.();
    }
  }

  return {
    applyRoomData
  };
}
