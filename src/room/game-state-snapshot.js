// src/room/game-state-snapshot.js
// Pure helpers for preparing game-state and room payloads before remote sync.

import { serializeSelectedWinnersByPot } from "./room-state.js";

function mergeCurrentAndNextMembers(currentMembers, nextMembers, normalizeMembers) {
  return {
    ...normalizeMembers(currentMembers),
    ...normalizeMembers(nextMembers)
  };
}

export function createGameStateSnapshot({
  currentRound = 0,
  pot = 0,
  currentBet = 0,
  lastRaiseSize = 0,
  currentPlayerIndex = -1,
  logs = [],
  inProgress = false,
  gameOver = false,
  awaitingShowdown = false,
  pendingPots = [],
  selectedWinnersByPot = {},
  pendingDealPrompt = null,
  settlementPreview = null,
  nextHandApprovals = {},
  handId = 0,
  handStatus = "setup",
  stateVersion = 0,
  updatedBy = ""
} = {}) {
  return {
    currentRound,
    pot,
    currentBet,
    lastRaiseSize,
    currentPlayerIndex,
    logs,
    inProgress,
    gameOver,
    awaitingShowdown,
    pendingPots,
    selectedWinnersByPot: serializeSelectedWinnersByPot(selectedWinnersByPot),
    pendingDealPrompt,
    settlementPreview,
    nextHandApprovals,
    handId,
    handStatus,
    stateVersion,
    updatedBy
  };
}

export function prepareRoomDataForGameSync({
  room = {},
  players = [],
  clientId = "",
  nextGameState,
  normalizeRoomMode,
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeJoinRequests,
  touchMemberWithProfile
} = {}) {
  const nextRoom = {
    ...room,
    mode: normalizeRoomMode(room.mode, room.roomId),
    hostClientId: getRoomHostId(room, clientId),
    members: touchMemberWithProfile(room.members, clientId)
  };

  return {
    room: nextRoom,
    roomData: {
      mode: nextRoom.mode,
      operator: nextRoom.operator,
      hostClientId: nextRoom.hostClientId,
      inviteToken: nextRoom.inviteToken || "",
      adminKeyHash: nextRoom.adminKeyHash || "",
      adminPlayerIds: normalizeAdminPlayerIds(nextRoom.adminPlayerIds),
      joinRequests: normalizeJoinRequests(nextRoom.joinRequests),
      members: nextRoom.members,
      gameState: nextGameState,
      players
    }
  };
}

export function buildMergedRoomSyncPayload({
  currentRoom = null,
  nextRoomData,
  roomId = "",
  mergePlayerIdentityFields,
  normalizeRoomMode,
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeJoinRequests,
  normalizeMembers
} = {}) {
  if (!currentRoom) return nextRoomData;

  const playersForWrite = mergePlayerIdentityFields(nextRoomData.players, currentRoom.players, { preserveNames: true });
  return {
    ...currentRoom,
    ...nextRoomData,
    mode: normalizeRoomMode(currentRoom.mode || nextRoomData.mode, roomId),
    operator: currentRoom.operator || nextRoomData.operator,
    hostClientId: getRoomHostId(currentRoom, nextRoomData.hostClientId),
    inviteToken: currentRoom.inviteToken || nextRoomData.inviteToken,
    adminKeyHash: currentRoom.adminKeyHash || nextRoomData.adminKeyHash,
    adminPlayerIds: normalizeAdminPlayerIds(currentRoom.adminPlayerIds || nextRoomData.adminPlayerIds)
      .filter(playerId => playersForWrite.some(player => player.id === playerId)),
    joinRequests: normalizeJoinRequests(currentRoom.joinRequests || nextRoomData.joinRequests),
    members: mergeCurrentAndNextMembers(currentRoom.members, nextRoomData.members, normalizeMembers),
    players: playersForWrite
  };
}

export function buildGuardedRoomSyncPayload({
  currentRoom,
  nextRoomData,
  roomId = "",
  expectedHandId = null,
  expectedStateVersion = null,
  allowedStatuses = null,
  remoteGuard = null,
  toNonNegativeNumber,
  inferHandStatus,
  mergePlayerIdentityFields,
  normalizeRoomMode,
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeJoinRequests,
  normalizeMembers
} = {}) {
  if (!currentRoom || !currentRoom.gameState) return undefined;

  const currentGameState = currentRoom.gameState;
  const currentHandId = toNonNegativeNumber(currentGameState.handId, 0);
  const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
  const currentStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0);
  if (expectedHandId !== null && currentHandId !== expectedHandId) return undefined;
  if (expectedStateVersion !== null && currentStateVersion !== expectedStateVersion) return undefined;
  if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(currentStatus)) return undefined;
  if (typeof remoteGuard === "function" && !remoteGuard(currentRoom, currentGameState)) return undefined;

  return buildMergedRoomSyncPayload({
    currentRoom,
    nextRoomData,
    roomId,
    mergePlayerIdentityFields,
    normalizeRoomMode,
    getRoomHostId,
    normalizeAdminPlayerIds,
    normalizeJoinRequests,
    normalizeMembers
  });
}
