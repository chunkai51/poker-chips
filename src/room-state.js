// src/room-state.js
// Normalizers and serializers for room/game-state payloads.

import { normalizeApprovalMap } from "./approvals.js";
import { normalizeSeatStatus } from "./game-rules.js";
import { normalizePlayerOwnerId } from "./identity.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeIncomingPlayer(player, index) {
  const chips = toNonNegativeNumber(player?.chips, 0);
  const allIn = Boolean(player?.allIn);
  return {
    id: String(player?.id || `player${index}`),
    name: String(player?.name || "").trim(),
    seatIndex: toNonNegativeNumber(player?.seatIndex, index),
    seatStatus: normalizeSeatStatus(player?.seatStatus, chips, allIn),
    chips,
    folded: Boolean(player?.folded),
    dealer: Boolean(player?.dealer),
    ownerClientId: normalizePlayerOwnerId(player?.ownerClientId),
    playerKeyHash: String(player?.playerKeyHash || ""),
    bet: toNonNegativeNumber(player?.bet, 0),
    totalBet: toNonNegativeNumber(player?.totalBet, 0),
    allIn,
    acted: Boolean(player?.acted),
    position: String(player?.position || "")
  };
}

export function normalizeIncomingPlayers(list) {
  return Array.isArray(list) ? list.map(normalizeIncomingPlayer) : [];
}

export function normalizeIncomingPots(pots) {
  if (!Array.isArray(pots)) return [];

  return pots.map(sidePot => ({
    amount: toNonNegativeNumber(sidePot?.amount, 0),
    participants: Array.isArray(sidePot?.participants)
      ? sidePot.participants.map(String)
      : [],
    contenders: Array.isArray(sidePot?.contenders)
      ? sidePot.contenders.map(String)
      : []
  })).filter(sidePot => sidePot.amount > 0 && sidePot.contenders.length > 0);
}

export function serializeSelectedWinnersByPot(selectedWinnersByPot = {}) {
  return Object.fromEntries(Object.entries(selectedWinnersByPot).map(([potIndex, value]) => {
    const ids = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [];
    return [potIndex, [...new Set(ids.map(String))]];
  }));
}

export function normalizeSelectedWinnersByPot(value) {
  if (!value || typeof value !== "object") return {};

  return Object.fromEntries(Object.entries(value).map(([potIndex, ids]) => [
    potIndex,
    new Set(ids instanceof Set
      ? Array.from(ids).map(String)
      : Array.isArray(ids)
        ? ids.map(String)
        : [])
  ]));
}

export function normalizeSettlementPreview(preview, { handId = 0 } = {}) {
  if (!preview || typeof preview !== "object") return null;

  const pots = Array.isArray(preview.pots)
    ? preview.pots.map((previewPot, index) => ({
      index: Number.isInteger(previewPot?.index) ? previewPot.index : index,
      amount: toNonNegativeNumber(previewPot?.amount, 0),
      winnerIds: Array.isArray(previewPot?.winnerIds)
        ? previewPot.winnerIds.map(String)
        : [],
      payouts: Array.isArray(previewPot?.payouts)
        ? previewPot.payouts.map(payout => ({
          playerId: String(payout?.playerId || ""),
          amount: toNonNegativeNumber(payout?.amount, 0)
        })).filter(payout => payout.playerId && payout.amount > 0)
        : []
    })).filter(previewPot => previewPot.amount > 0 && previewPot.payouts.length > 0)
    : [];

  if (pots.length === 0) return null;

  return {
    id: String(preview.id || `settlement_${handId}`),
    total: toNonNegativeNumber(preview.total, pots.reduce((sum, previewPot) => sum + previewPot.amount, 0)),
    winnersByPot: normalizeSelectedWinnersByPot(preview.winnersByPot),
    approvals: normalizeApprovalMap(preview.approvals),
    pots
  };
}
