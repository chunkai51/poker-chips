// src/room-permissions.js
// Pure room permission and player-control helpers.

import {
  ROOM_MODES,
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeMembers,
  normalizePlayerOwnerId,
  normalizeRoomMode
} from "./identity.js";
import { normalizeIncomingPlayers } from "./room-state.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function getHostClientId(roomData = {}, {
  currentRoomId = "",
  localClientId = ""
} = {}) {
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || currentRoomId);
  const fallbackClientId = mode === ROOM_MODES.local ? localClientId : roomData?.operator || "";
  return getRoomHostId(roomData, fallbackClientId) || fallbackClientId;
}

export function isClientAdminInRoom(actorClientId, roomData = {}, {
  currentClientId = "",
  currentRoomId = "",
  players = [],
  isRememberedAdminCodeValid = () => false
} = {}) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const members = normalizeMembers(roomData?.members);
  const member = members[normalizedActorId];
  const adminPlayerIds = normalizeAdminPlayerIds(roomData?.adminPlayerIds);
  const claimedPlayerId = String(member?.claimedPlayerId || "");
  const roomPlayers = normalizeIncomingPlayers(roomData?.players || players);
  const ownsAdminPlayer = adminPlayerIds.includes(claimedPlayerId) &&
    roomPlayers.some(player => player.id === claimedPlayerId && normalizePlayerOwnerId(player.ownerClientId) === normalizedActorId);
  const rememberedCodeValid = normalizedActorId === normalizePlayerOwnerId(currentClientId) &&
    isRememberedAdminCodeValid(roomData, currentRoomId);
  return Boolean(member?.adminVerified) ||
    rememberedCodeValid ||
    ownsAdminPlayer ||
    getHostClientId(roomData, { currentRoomId, localClientId: currentClientId }) === normalizedActorId;
}

export function getRoomManagerProxyId(roomData = {}, {
  currentRoomId = "",
  localClientId = "",
  players = []
} = {}) {
  const adminPlayerIds = normalizeAdminPlayerIds(roomData?.adminPlayerIds);
  const roomPlayers = normalizeIncomingPlayers(roomData?.players || players);
  const adminPlayerOwner = roomPlayers
    .filter(player => adminPlayerIds.includes(player.id))
    .map(player => normalizePlayerOwnerId(player.ownerClientId))
    .find(Boolean);
  if (adminPlayerOwner) return adminPlayerOwner;

  const adminMemberId = Object.values(normalizeMembers(roomData?.members))
    .filter(member => member.adminVerified)
    .sort((left, right) => toNonNegativeNumber(right.lastSeenAt, 0) - toNonNegativeNumber(left.lastSeenAt, 0))
    .map(member => member.clientId)[0];
  return adminMemberId || getHostClientId(roomData, { currentRoomId, localClientId });
}

export function canClientManageRoomData(actorClientId, roomData = {}, options = {}) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || options.currentRoomId || "");
  if (mode === ROOM_MODES.local) return true;
  return isClientAdminInRoom(normalizedActorId, roomData, options);
}

export function canClientControlPlayerInRoom(actorClientId, player, roomData = {}, options = {}) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || options.currentRoomId || "");
  if (mode === ROOM_MODES.local) return true;
  const ownerClientId = normalizePlayerOwnerId(player?.ownerClientId);
  if (ownerClientId) return ownerClientId === normalizedActorId;
  return canClientManageRoomData(normalizedActorId, roomData, options);
}

export function getCurrentDevicePlayerIndex(list = [], clientId = "") {
  return list.findIndex(player => normalizePlayerOwnerId(player.ownerClientId) === normalizePlayerOwnerId(clientId));
}

export function getCurrentDevicePlayer(list = [], clientId = "") {
  const index = getCurrentDevicePlayerIndex(list, clientId);
  return index >= 0 ? list[index] : null;
}

export function isCurrentDevicePlayer(player, clientId = "") {
  return normalizePlayerOwnerId(player?.ownerClientId) === normalizePlayerOwnerId(clientId);
}

export function getPlayerControllerId(player, roomData = {}, options = {}) {
  return normalizePlayerOwnerId(player?.ownerClientId) || getRoomManagerProxyId(roomData, options);
}
