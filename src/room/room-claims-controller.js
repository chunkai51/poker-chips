// src/room-claims-controller.js
// Seat claim, release, join-request, and approval data helpers.

import {
  normalizeAccessCode,
  normalizeAdminPlayerIds,
  normalizeMembers,
  normalizePlayerOwnerId
} from "./identity.js";
import { getRequestDisplayName, normalizeJoinRequests } from "./room-entry.js";
import { normalizeIncomingPlayer } from "./room-state.js";
import { shouldUseRequestNameForSeat } from "./player-model.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function isClaimedByOtherDevice(player, clientId = "") {
  const ownerClientId = normalizePlayerOwnerId(player?.ownerClientId);
  return Boolean(ownerClientId && ownerClientId !== normalizePlayerOwnerId(clientId));
}

export function getSetupClaimLabel({
  player,
  roomMode = false,
  currentRequest = null,
  isCurrentDevicePlayer = false,
  claimedByOtherDevice = false,
  canManageRoom = false
} = {}) {
  if (!roomMode) return "本地";
  if (isCurrentDevicePlayer) return "我的座位";
  if (currentRequest?.playerId === player?.id) return "待批准";
  if (claimedByOtherDevice) return "已有人入座";
  return canManageRoom ? "绑定到我" : "请求坐下";
}

export function applyLocalPlayerClaimState({
  players = [],
  members = {},
  clientId = "",
  playerId = "",
  shouldClaim = false,
  handStatus = "",
  now = Date.now()
} = {}) {
  const normalizedClientId = normalizePlayerOwnerId(clientId);
  const nextPlayers = players.map(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) === normalizedClientId) {
      return { ...player, ownerClientId: "" };
    }
    return { ...player };
  });

  const targetIndex = nextPlayers.findIndex(player => player.id === playerId);
  if (shouldClaim && targetIndex < 0) {
    return { ok: false, players, members, resetNextHandApprovals: false };
  }
  if (shouldClaim) {
    nextPlayers[targetIndex] = {
      ...nextPlayers[targetIndex],
      ownerClientId: normalizedClientId
    };
  }

  const normalizedMembers = normalizeMembers(members);
  const currentMember = normalizedMembers[normalizedClientId] || {};
  const nextMembers = {
    ...normalizedMembers,
    [normalizedClientId]: {
      ...currentMember,
      clientId: normalizedClientId,
      claimedPlayerId: shouldClaim ? playerId : "",
      lastSeenAt: now
    }
  };

  return {
    ok: true,
    players: nextPlayers,
    members: nextMembers,
    resetNextHandApprovals: handStatus === "settled"
  };
}

export function getClaimAuthForPlayer({
  player,
  code = "",
  rememberedCode = "",
  forceAdmin = false,
  canManageRoom = false,
  isPlayerCodeValid = () => false
} = {}) {
  const normalizedCode = normalizeAccessCode(code) || normalizeAccessCode(rememberedCode);
  const canForce = forceAdmin && canManageRoom;
  const canUseCode = Boolean(player?.playerKeyHash && isPlayerCodeValid(player, normalizedCode));
  const firstClaim = !player?.playerKeyHash && canManageRoom;
  return {
    code: normalizedCode,
    canForce,
    canUseCode,
    firstClaim,
    allowed: canForce || canUseCode || firstClaim
  };
}

export function buildClaimPlayerRoomUpdate({
  currentRoom,
  room = {},
  playerId = "",
  clientId = "",
  auth = {},
  forceAdmin = false,
  generatedHash = "",
  currentDisplayName = "",
  canClientManageRoom = () => false,
  isPlayerCodeValid = () => false,
  inferHandStatus = () => "setup",
  getRoomHostId = () => "",
  normalizeRoomMode = (_, roomId) => roomId ? "room" : "local",
  touchMember,
  now = Date.now()
} = {}) {
  if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
  const nextGameState = currentRoom.gameState || {};
  const currentStatus = String(nextGameState.handStatus || inferHandStatus(nextGameState));
  const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
  const target = remotePlayers.find(item => item.id === playerId);
  if (!target) return undefined;

  const adminForce = forceAdmin && canClientManageRoom(clientId, currentRoom);
  const remoteCanUseCode = Boolean(target.playerKeyHash && isPlayerCodeValid(target, auth.code, currentRoom));
  const remoteFirstClaim = !target.playerKeyHash && auth.firstClaim;
  if (!adminForce && !remoteCanUseCode && !remoteFirstClaim) return undefined;

  remotePlayers.forEach(item => {
    if (normalizePlayerOwnerId(item.ownerClientId) === normalizePlayerOwnerId(clientId)) {
      item.ownerClientId = "";
    }
  });
  target.ownerClientId = clientId;
  if (currentDisplayName && shouldUseRequestNameForSeat(target, remotePlayers.indexOf(target))) {
    target.name = currentDisplayName;
  }
  if (remoteFirstClaim && generatedHash) {
    target.playerKeyHash = generatedHash;
  }

  const members = touchMember(currentRoom.members || room.members, clientId);
  Object.entries(members).forEach(([memberId, member]) => {
    if (memberId !== clientId && String(member.claimedPlayerId || "") === playerId) {
      members[memberId] = {
        ...member,
        claimedPlayerId: ""
      };
    }
  });
  members[clientId] = {
    ...members[clientId],
    displayName: currentDisplayName || members[clientId]?.displayName || "",
    claimedPlayerId: playerId,
    lastSeenAt: now
  };

  const nextRoom = {
    ...currentRoom,
    mode: normalizeRoomMode(currentRoom.mode, room.roomId),
    hostClientId: getRoomHostId(currentRoom, room.hostClientId || clientId),
    members,
    players: remotePlayers
  };
  if (currentStatus === "settled") {
    nextRoom.gameState = {
      ...nextGameState,
      nextHandApprovals: {},
      stateVersion: toNonNegativeNumber(nextGameState.stateVersion, 0) + 1,
      updatedBy: clientId
    };
  }
  return nextRoom;
}

export function buildReleasePlayerRoomUpdate({
  currentRoom,
  room = {},
  clientId = "",
  touchMember
} = {}) {
  if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
  const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
  remotePlayers.forEach(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) === normalizePlayerOwnerId(clientId)) {
      player.ownerClientId = "";
    }
  });
  const members = touchMember(currentRoom.members || room.members, clientId);
  members[clientId] = {
    ...members[clientId],
    claimedPlayerId: ""
  };
  return {
    ...currentRoom,
    members,
    players: remotePlayers
  };
}

export function createSeatOwnershipRequest({
  clientId = "",
  playerId = "",
  displayName = "",
  claimedByOtherDevice = false,
  inviteToken = "",
  now = Date.now()
} = {}) {
  return {
    clientId,
    playerId,
    displayName: String(displayName || "").trim().slice(0, 24),
    type: claimedByOtherDevice ? "reclaim" : "join",
    inviteToken: String(inviteToken || ""),
    requestedAt: now
  };
}

export function buildApproveSeatRequestRoomUpdate({
  currentRoom,
  room = {},
  clientId = "",
  requestClientId = "",
  expectedPlayerId = "",
  canClientManageRoom = () => false,
  inferHandStatus = () => "setup",
  touchMember,
  now = Date.now()
} = {}) {
  if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
  if (!canClientManageRoom(clientId, currentRoom)) return undefined;
  const requests = normalizeJoinRequests(currentRoom.joinRequests);
  const remoteRequest = requests[requestClientId];
  if (!remoteRequest || remoteRequest.playerId !== expectedPlayerId) return undefined;

  const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
  const remoteTarget = remotePlayers.find(player => player.id === remoteRequest.playerId);
  if (!remoteTarget) return undefined;
  const remoteTargetIndex = remotePlayers.indexOf(remoteTarget);
  const requestDisplayName = getRequestDisplayName(remoteRequest);
  remotePlayers.forEach(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) === normalizePlayerOwnerId(requestClientId)) {
      player.ownerClientId = "";
    }
  });
  remoteTarget.ownerClientId = requestClientId;
  remoteTarget.playerKeyHash = "";
  if (requestDisplayName && shouldUseRequestNameForSeat(remoteTarget, remoteTargetIndex)) {
    remoteTarget.name = requestDisplayName;
  }
  delete requests[requestClientId];

  const members = touchMember(currentRoom.members || room.members, clientId);
  Object.entries(members).forEach(([memberId, member]) => {
    if (String(member.claimedPlayerId || "") === remoteRequest.playerId) {
      members[memberId] = {
        ...member,
        claimedPlayerId: ""
      };
    }
  });
  members[requestClientId] = {
    ...(members[requestClientId] || {}),
    clientId: requestClientId,
    displayName: requestDisplayName,
    claimedPlayerId: remoteRequest.playerId,
    lastSeenAt: now
  };

  const nextGameState = currentRoom.gameState || {};
  const currentStatus = String(nextGameState.handStatus || inferHandStatus(nextGameState));
  const nextRoom = {
    ...currentRoom,
    joinRequests: requests,
    members,
    players: remotePlayers
  };
  if (currentStatus === "settled") {
    nextRoom.gameState = {
      ...nextGameState,
      nextHandApprovals: {},
      stateVersion: toNonNegativeNumber(nextGameState.stateVersion, 0) + 1,
      updatedBy: clientId
    };
  }
  return nextRoom;
}

export function buildDeclineSeatRequestRoomUpdate({
  currentRoom,
  room = {},
  clientId = "",
  requestClientId = "",
  canClientManageRoom = () => false,
  touchMember
} = {}) {
  const normalizedRequestClientId = normalizePlayerOwnerId(requestClientId);
  if (!currentRoom || !normalizedRequestClientId) return undefined;
  if (!canClientManageRoom(clientId, currentRoom)) return undefined;
  const requests = normalizeJoinRequests(currentRoom.joinRequests);
  if (!requests[normalizedRequestClientId]) return undefined;
  delete requests[normalizedRequestClientId];
  return {
    ...currentRoom,
    joinRequests: requests,
    members: touchMember(currentRoom.members || room.members, clientId)
  };
}

export function buildTogglePlayerAdminRoomUpdate({
  currentRoom,
  room = {},
  clientId = "",
  playerId = "",
  shouldGrant = false,
  canClientManageRoom = () => false,
  touchMember
} = {}) {
  if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
  if (!canClientManageRoom(clientId, currentRoom)) return undefined;
  if (!currentRoom.players.some(player => String(player?.id) === playerId)) return undefined;
  const currentIds = normalizeAdminPlayerIds(currentRoom.adminPlayerIds);
  const nextIds = shouldGrant
    ? [...new Set([...currentIds, playerId])]
    : currentIds.filter(id => id !== playerId);
  return {
    ...currentRoom,
    adminPlayerIds: nextIds,
    members: touchMember(currentRoom.members || room.members, clientId)
  };
}
