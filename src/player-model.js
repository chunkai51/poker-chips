// src/player-model.js
// Player object creation, setup normalization, and display-label helpers.

import { normalizeSeatStatus } from "./game-rules.js";
import { normalizePlayerOwnerId } from "./identity.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createPlayerId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return `player_${cryptoApi.randomUUID().slice(0, 8)}`;
  return `player_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

export function createSetupPlayer({ seatIndex = 0, initialChips = 1000, overrides = {} } = {}) {
  return {
    id: createPlayerId(),
    name: "",
    seatIndex,
    seatStatus: "seated",
    chips: toPositiveInteger(initialChips, 1000),
    folded: false,
    dealer: false,
    ownerClientId: "",
    playerKeyHash: "",
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: "",
    ...overrides
  };
}

export function normalizeSetupPlayer(player, index, { initialChips = 1000 } = {}) {
  return {
    id: String(player?.id || createPlayerId()),
    name: String(player?.name || "").trim(),
    seatIndex: index,
    seatStatus: normalizeSeatStatus(player?.seatStatus || "seated", toNonNegativeNumber(player?.chips, 0), false),
    chips: toPositiveInteger(player?.chips, toPositiveInteger(initialChips, 1000)),
    folded: false,
    dealer: Boolean(player?.dealer),
    ownerClientId: normalizePlayerOwnerId(player?.ownerClientId),
    playerKeyHash: String(player?.playerKeyHash || ""),
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: ""
  };
}

export function normalizeSetupPlayers(players = [], { initialChips = 1000 } = {}) {
  return (Array.isArray(players) ? players : [])
    .map((player, index) => normalizeSetupPlayer(player, index, { initialChips }));
}

export function getPlayerName(player) {
  return player && player.name ? player.name : "空座位";
}

export function getRawPlayerName(player) {
  return String(player?.name || "").trim();
}

export function isAutoSeatName(name = "") {
  return /^玩家\d+$/.test(String(name || "").trim());
}

export function shouldUseRequestNameForSeat(player, index = -1) {
  const rawName = getRawPlayerName(player);
  return !rawName || rawName === `玩家${index + 1}` || isAutoSeatName(rawName);
}

export function hasDuplicatePlayerName(player, list = []) {
  const name = getPlayerName(player).trim().toLocaleLowerCase();
  if (name === "空座位") return false;
  return list.filter(item => getPlayerName(item).trim().toLocaleLowerCase() === name).length > 1;
}

export function getPlayerIdentityLabel(player, index = -1, list = []) {
  const name = getPlayerName(player);
  const seatNumber = index >= 0 ? index + 1 : "?";
  return hasDuplicatePlayerName(player, list) ? `${name} · 座位 ${seatNumber}` : name;
}

export function getPlayerCompactIdentityLabel(player, index = -1, list = []) {
  const name = getPlayerName(player);
  const seatNumber = index >= 0 ? index + 1 : "?";
  return hasDuplicatePlayerName(player, list) ? `${name} · S${seatNumber}` : name;
}
