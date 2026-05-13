// src/room-lobby-controller.js
// Lobby-state helpers for local/room mode, room creation/joining, and setup sync payloads.

export function createLocalModeRoom({
  room = {},
  clientId = "",
  createMembersMap
} = {}) {
  return {
    ...room,
    roomId: "",
    mode: "local",
    operator: clientId,
    hostClientId: clientId,
    inviteToken: "",
    adminKeyHash: "",
    adminPlayerIds: [],
    joinRequests: {},
    members: createMembersMap(clientId)
  };
}

export function createHostRoom({
  room = {},
  roomId = "",
  clientId = "",
  inviteToken = "",
  createMembersMap,
  touchMemberWithProfile
} = {}) {
  const hostMembers = createMembersMap(clientId, {
    [clientId]: {
      role: "host",
      adminVerified: true
    }
  });

  return {
    ...room,
    roomId: roomId || room.roomId,
    mode: "room",
    operator: clientId,
    hostClientId: clientId,
    inviteToken,
    adminKeyHash: "",
    adminPlayerIds: [],
    joinRequests: {},
    members: touchMemberWithProfile(hostMembers, clientId, { role: "host", adminVerified: true })
  };
}

export function createJoinedRoom({
  room = {},
  clientId = "",
  roomId = "",
  inviteToken = "",
  createMembersMap,
  touchMemberWithProfile
} = {}) {
  const switchingRoom = room.roomId !== roomId;
  const nextRoom = {
    ...room,
    roomId,
    mode: "room"
  };

  if (switchingRoom) {
    nextRoom.operator = "";
    nextRoom.hostClientId = "";
    nextRoom.inviteToken = inviteToken;
    nextRoom.adminKeyHash = "";
    nextRoom.adminPlayerIds = [];
    nextRoom.joinRequests = {};
    nextRoom.members = createMembersMap(clientId);
  } else if (inviteToken && !nextRoom.inviteToken) {
    nextRoom.inviteToken = inviteToken;
  }

  nextRoom.members = touchMemberWithProfile(nextRoom.members, clientId);
  return { room: nextRoom, switchingRoom };
}

export function createLobbyGameState({
  bigBlind = 20,
  handId = 0,
  stateVersion = 0,
  logs = [],
  clientId = ""
} = {}) {
  return {
    currentRound: 0,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: bigBlind,
    currentPlayerIndex: -1,
    logs,
    inProgress: false,
    gameOver: false,
    awaitingShowdown: false,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    handId,
    handStatus: "setup",
    stateVersion,
    updatedBy: clientId
  };
}

export function buildLobbyRoomForWrite({
  currentRoom,
  createOnly = false,
  room = {},
  players = [],
  clientId = "",
  nextGameState,
  canClientManageRoom,
  getRoomHostId,
  inferHandStatus,
  mergePlayerIdentityFields,
  normalizeAdminPlayerIds,
  normalizeJoinRequests,
  touchMemberWithProfile
} = {}) {
  if (createOnly && currentRoom) return undefined;

  const currentGameState = currentRoom?.gameState;
  const currentStatus = currentGameState
    ? String(currentGameState.handStatus || inferHandStatus(currentGameState))
    : "setup";
  const currentInProgress = Boolean(currentGameState?.inProgress);
  if (currentInProgress && currentStatus !== "setup") return undefined;

  const existingRoom = currentRoom || {};
  if (currentRoom && !canClientManageRoom(clientId, existingRoom)) return undefined;

  const playersForWrite = mergePlayerIdentityFields(players, existingRoom.players || players);
  return {
    ...existingRoom,
    mode: "room",
    operator: existingRoom.operator || room.operator || clientId,
    hostClientId: getRoomHostId(existingRoom, room.hostClientId || clientId),
    inviteToken: existingRoom.inviteToken || room.inviteToken || "",
    adminKeyHash: existingRoom.adminKeyHash || room.adminKeyHash || "",
    adminPlayerIds: normalizeAdminPlayerIds(existingRoom.adminPlayerIds || room.adminPlayerIds),
    joinRequests: normalizeJoinRequests(existingRoom.joinRequests || room.joinRequests),
    members: touchMemberWithProfile(existingRoom.members || room.members, clientId),
    gameState: nextGameState,
    players: playersForWrite
  };
}
