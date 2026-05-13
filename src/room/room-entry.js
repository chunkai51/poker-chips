// src/room/room-entry.js
// Helpers for room ids, invite links, display-name persistence, and join requests.

import { normalizePlayerOwnerId } from "./identity.js";

const ROOM_DISPLAY_NAME_KEY = "pokerChipsDisplayName";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function getStorage() {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (_) {
    return null;
  }
}

function getCrypto() {
  return globalThis.crypto || null;
}

function createRandomString(alphabet, length) {
  const bytes = new Uint8Array(length);
  const cryptoApi = getCrypto();
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

export function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$\[\]/]/g, "_")
    .slice(0, 64);
}

export function getRequestDisplayName(request) {
  return String(request?.displayName || "").trim().slice(0, 24);
}

export function getClientShortId(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "local";
}

export function normalizeInviteToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);
}

export function createInviteToken(length = 22) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return createRandomString(alphabet, length);
}

export function generateRoomId() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  return createRandomString(alphabet, 8);
}

export function getDisplayNameStorageKey(roomId = "") {
  return `${ROOM_DISPLAY_NAME_KEY}:${roomId || "global"}`;
}

export function getPreferredDisplayName(roomId = "") {
  const storage = getStorage();
  if (!storage) return "";
  try {
    return String(storage.getItem(getDisplayNameStorageKey(roomId)) ||
      storage.getItem(ROOM_DISPLAY_NAME_KEY) ||
      "").trim().slice(0, 24);
  } catch (_) {
    return "";
  }
}

export function rememberPreferredDisplayName(name, roomId = "") {
  const safeName = String(name || "").trim().slice(0, 24);
  if (!safeName) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ROOM_DISPLAY_NAME_KEY, safeName);
    if (roomId) storage.setItem(getDisplayNameStorageKey(roomId), safeName);
  } catch (_) {
    // Display names are convenience-only.
  }
}

export function getInviteUrl(baseHref, roomId = "", inviteToken = "") {
  if (!roomId || !baseHref) return "";
  const url = new URL(baseHref);
  url.searchParams.set("room", roomId);
  if (inviteToken) url.searchParams.set("invite", inviteToken);
  return url.toString();
}

export function getRoomLinkParams(search = "") {
  const params = new URLSearchParams(search);
  return {
    roomId: normalizeRoomId(params.get("room") || params.get("roomId") || ""),
    inviteToken: normalizeInviteToken(params.get("invite") || "")
  };
}

export function normalizeJoinRequests(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, request]) => {
      const requestClientId = normalizePlayerOwnerId(request?.clientId || key);
      if (!requestClientId) return null;
      const playerId = String(request?.playerId || "");
      const displayName = getRequestDisplayName(request);
      return [requestClientId, {
        clientId: requestClientId,
        playerId,
        displayName,
        type: request?.type === "reclaim" ? "reclaim" : "join",
        inviteToken: normalizeInviteToken(request?.inviteToken || ""),
        requestedAt: toNonNegativeNumber(request?.requestedAt, Date.now())
      }];
    })
    .filter(Boolean));
}
