// src/table-view-preferences.js
// Local-only table-view preferences. These values are intentionally not synced.

const TABLE_VIEW_ROTATION_KEY_PREFIX = "pokerChipsTableViewRotation:";

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

export function getTableViewRotationStorageKey(roomId = "") {
  return `${TABLE_VIEW_ROTATION_KEY_PREFIX}${roomId || "local"}`;
}

export function loadTableViewRotation(roomId = "") {
  const storage = getStorage();
  if (!storage) return 0;
  try {
    return parseInt(storage.getItem(getTableViewRotationStorageKey(roomId)) || "0", 10) || 0;
  } catch (_) {
    return 0;
  }
}

export function saveTableViewRotation(offset, roomId = "") {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getTableViewRotationStorageKey(roomId), String(offset));
  } catch (_) {
    // Local view rotation is optional; storage failures should not affect the hand.
  }
}
