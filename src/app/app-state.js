import { createMembersMap, getClientId, ROOM_MODES } from "../room/identity.js";

export const MAX_PLAYERS = 10;
export const ROUND_LABELS = ["翻牌前", "翻牌后", "转牌", "河牌"];

function createInitialRoom(clientId) {
  return {
    roomId: "",
    mode: ROOM_MODES.local,
    operator: clientId,
    hostClientId: clientId,
    inviteToken: "",
    adminKeyHash: "",
    adminPlayerIds: [],
    joinRequests: {},
    members: createMembersMap(clientId),
    players: [],
    gameState: {
      currentRound: 0,
      pot: 0,
      currentBet: 0,
      lastRaiseSize: 20,
      currentPlayerIndex: -1,
      logs: [],
      inProgress: false,
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
      updatedBy: clientId
    }
  };
}

export function createAppState() {
  const clientId = getClientId();
  const state = {
    players: [],
    currentPlayerIndex: -1,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: 20,
    currentRound: 0,
    rounds: ROUND_LABELS,
    bigBlind: 20,
    smallBlind: 10,
    gameOver: false,
    gameStarted: false,
    awaitingShowdown: false,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    stateVersion: 0,
    handId: 0,
    handStatus: "setup",
    mutationInProgress: false,
    syncReady: false,
    syncWriteInProgress: false,
    batchingStateUpdate: false,
    tableViewRotationOffset: 0,
    clientId,
    authReady: false,
    authUnavailable: false,
    room: createInitialRoom(clientId)
  };

  function patch(next = {}) {
    if (!next || typeof next !== "object") return state;
    Object.assign(state, next);
    if (Object.hasOwn(next, "players")) {
      state.room.players = state.players;
    }
    return state;
  }

  function setPlayers(players) {
    return patch({ players });
  }

  function setRoom(room) {
    state.room = room;
    return room;
  }

  return {
    state,
    getState: () => state,
    patch,
    setPlayers,
    setRoom
  };
}
