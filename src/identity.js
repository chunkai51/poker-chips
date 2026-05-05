// src/identity.js
// Client and room identity helpers for the multiplayer collaboration roadmap.

export const CLIENT_ID_KEY = "pokerChipsClientId";
export const ROOM_MODES = {
  local: "local",
  room: "room"
};

export function getClientId(storage = globalThis.localStorage, cryptoApi = globalThis.crypto) {
  try {
    const existing = storage?.getItem(CLIENT_ID_KEY);
    if (existing) return existing;

    const nextId = cryptoApi?.randomUUID
      ? cryptoApi.randomUUID()
      : `client_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    storage?.setItem(CLIENT_ID_KEY, nextId);
    return nextId;
  } catch (_) {
    return `client_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }
}

export function getRoomMode(roomId = "") {
  return roomId ? ROOM_MODES.room : ROOM_MODES.local;
}

export function normalizeRoomMode(value, roomId = "") {
  const mode = String(value || "");
  if (mode === ROOM_MODES.local || mode === ROOM_MODES.room) return mode;
  return getRoomMode(roomId);
}

export function normalizeClientId(value) {
  return String(value || "").trim();
}

export function createRoomMember(clientId, overrides = {}) {
  const normalizedClientId = normalizeClientId(overrides.clientId || clientId);
  const now = Date.now();
  return {
    displayName: "",
    role: "participant",
    joinedAt: now,
    lastSeenAt: now,
    ...overrides,
    clientId: normalizedClientId
  };
}

export function normalizeMembers(value = {}) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(Object.entries(value)
    .map(([key, member]) => {
      const clientId = normalizeClientId(member?.clientId || key);
      if (!clientId) return null;
      return [clientId, createRoomMember(clientId, member)];
    })
    .filter(Boolean));
}

export function createMembersMap(clientId, existingMembers = {}) {
  const members = normalizeMembers(existingMembers);
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId) return members;
  return {
    ...members,
    [normalizedClientId]: createRoomMember(normalizedClientId, members[normalizedClientId])
  };
}

export function touchMember(existingMembers, clientId) {
  const members = createMembersMap(clientId, existingMembers);
  const normalizedClientId = normalizeClientId(clientId);
  if (!normalizedClientId || !members[normalizedClientId]) return members;

  members[normalizedClientId] = {
    ...members[normalizedClientId],
    lastSeenAt: Date.now()
  };
  return members;
}

export function getRoomHostId(data = {}, fallbackClientId = "") {
  return normalizeClientId(data.hostClientId || data.operator || fallbackClientId);
}

export function normalizePlayerOwnerId(value) {
  return normalizeClientId(value);
}

export function canClientControlPlayer({ mode, clientId, player } = {}) {
  const ownerClientId = normalizePlayerOwnerId(player?.ownerClientId);
  return normalizeRoomMode(mode) === ROOM_MODES.local || !ownerClientId || ownerClientId === normalizeClientId(clientId);
}

export function isRoomHost({ mode, clientId, hostClientId } = {}) {
  return normalizeRoomMode(mode) === ROOM_MODES.local || normalizeClientId(clientId) === normalizeClientId(hostClientId);
}
