// src/room/access-codes.js
// Legacy local recovery-code persistence and validation helpers.

import {
  normalizeAccessCode,
  verifyAccessCode
} from "./identity.js";

const ROOM_ADMIN_CODE_KEY_PREFIX = "pokerChipsAdminCode:";
const PLAYER_CODE_KEY_PREFIX = "pokerChipsPlayerCode:";

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

export function getAdminCodeStorageKey(roomId = "") {
  return `${ROOM_ADMIN_CODE_KEY_PREFIX}${roomId || "local"}`;
}

export function getPlayerCodeStorageKey(playerId, roomId = "") {
  return `${PLAYER_CODE_KEY_PREFIX}${roomId || "local"}:${playerId}`;
}

export function rememberAdminCode(code, roomId = "") {
  const normalizedCode = normalizeAccessCode(code);
  if (!normalizedCode || !roomId) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getAdminCodeStorageKey(roomId), normalizedCode);
  } catch (_) {
    // Access recovery codes are convenience-only; storage failures should not block play.
  }
}

export function getRememberedAdminCode(roomId = "") {
  const storage = getStorage();
  if (!storage) return "";
  try {
    return normalizeAccessCode(storage.getItem(getAdminCodeStorageKey(roomId)));
  } catch (_) {
    return "";
  }
}

export function forgetAdminCode(roomId = "") {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(getAdminCodeStorageKey(roomId));
  } catch (_) {
    // Optional local cache.
  }
}

export function rememberPlayerCode(playerId, code, roomId = "") {
  const normalizedCode = normalizeAccessCode(code);
  if (!playerId || !normalizedCode || !roomId) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getPlayerCodeStorageKey(playerId, roomId), normalizedCode);
  } catch (_) {
    // Optional local cache.
  }
}

export function getRememberedPlayerCode(playerId, roomId = "") {
  if (!playerId) return "";
  const storage = getStorage();
  if (!storage) return "";
  try {
    return normalizeAccessCode(storage.getItem(getPlayerCodeStorageKey(playerId, roomId)));
  } catch (_) {
    return "";
  }
}

export function getPlayerCodeSalt(playerId, roomId = "") {
  return `${roomId || "local"}:${playerId}`;
}

export function getAdminCodeSalt(roomId = "") {
  return `${roomId || "local"}:admin`;
}

export function isPlayerCodeValid(player, code, roomId = "") {
  const normalizedCode = normalizeAccessCode(code);
  if (!player?.playerKeyHash || !normalizedCode) return false;
  return verifyAccessCode(normalizedCode, player.playerKeyHash, getPlayerCodeSalt(player.id, roomId));
}

export function isAdminCodeValid(code, roomData = {}) {
  const normalizedCode = normalizeAccessCode(code);
  if (!roomData?.adminKeyHash || !normalizedCode) return false;
  return verifyAccessCode(normalizedCode, roomData.adminKeyHash, getAdminCodeSalt(roomData.roomId));
}
