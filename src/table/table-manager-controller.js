// src/table/table-manager-controller.js
// Draft-state helpers for the table/seat management workflow.

import {
  getEligiblePlayerIndices,
  getHandLayout,
  getNextEligibleIndexAfter,
  getSeatStatusLabel,
  isEligibleForNextHand,
  normalizeSeatStatus
} from "../core/game-rules.js";
import { normalizePlayerOwnerId } from "../room/identity.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function createTableDraft(players) {
  return players.map((player, index) => ({
    id: String(player.id || `player${index}`),
    name: String(player.name || "").trim(),
    seatIndex: index,
    seatStatus: normalizeSeatStatus(player.seatStatus, player.chips, false),
    chips: toNonNegativeNumber(player.chips, 0),
    ownerClientId: normalizePlayerOwnerId(player.ownerClientId),
    playerKeyHash: String(player.playerKeyHash || ""),
    dealer: Boolean(player.dealer)
  }));
}

export function getNextPlayerIdFromDraft(tableDraft, createPlayerId) {
  const usedIds = new Set(tableDraft.map(player => player.id));
  let id = createPlayerId();
  while (usedIds.has(id)) {
    id = createPlayerId();
  }
  return id;
}

export function appendDraftPlayer(tableDraft, {
  createPlayerId,
  initialChips = 1000,
  maxPlayers = 10
}) {
  if (tableDraft.length >= maxPlayers) return false;
  const id = getNextPlayerIdFromDraft(tableDraft, createPlayerId);
  tableDraft.push({
    id,
    name: "",
    seatIndex: tableDraft.length,
    seatStatus: "seated",
    chips: initialChips,
    ownerClientId: "",
    playerKeyHash: "",
    dealer: false
  });
  return true;
}

export function normalizeDraftPlayer(draftPlayer, index) {
  let chips = toNonNegativeNumber(draftPlayer?.chips, 0);
  let seatStatus = normalizeSeatStatus(draftPlayer?.seatStatus, chips, false);
  if (chips <= 0) {
    chips = 0;
    if (seatStatus === "seated" || seatStatus === "sittingOut") {
      seatStatus = "busted";
    }
  } else if (seatStatus === "busted") {
    seatStatus = "seated";
  }

  return {
    id: String(draftPlayer?.id || `player${index}`),
    name: String(draftPlayer?.name || "").trim(),
    seatIndex: index,
    seatStatus,
    chips,
    folded: !isEligibleForNextHand({ seatStatus, chips }),
    dealer: Boolean(draftPlayer?.dealer),
    ownerClientId: normalizePlayerOwnerId(draftPlayer?.ownerClientId),
    playerKeyHash: String(draftPlayer?.playerKeyHash || ""),
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: getSeatStatusLabel(seatStatus)
  };
}

export function normalizeTableDraftPlayers(tableDraft) {
  const normalized = tableDraft.map(normalizeDraftPlayer);
  const dealerCount = normalized.filter(player => player.dealer).length;
  if (dealerCount > 1) {
    let firstDealerSeen = false;
    normalized.forEach(player => {
      if (player.dealer && !firstDealerSeen) {
        firstDealerSeen = true;
      } else {
        player.dealer = false;
      }
    });
  }
  return normalized;
}

export function getPreviewDealerIndex(list) {
  const eligibleIndices = getEligiblePlayerIndices(list);
  if (eligibleIndices.length === 0) return -1;

  const currentDealerIndex = list.findIndex(player => player.dealer);
  if (currentDealerIndex === -1) return eligibleIndices[0];
  return getNextEligibleIndexAfter(currentDealerIndex, eligibleIndices);
}

export function getTableDraftSummary(tableDraft, { getPlayerIdentityLabel }) {
  const normalized = tableDraft.map(normalizeDraftPlayer);
  const eligibleIndices = getEligiblePlayerIndices(normalized);
  const sittingOutCount = normalized.filter(player => player.seatStatus === "sittingOut").length;
  const bustedCount = normalized.filter(player => player.seatStatus === "busted").length;
  const leftCount = normalized.filter(player => player.seatStatus === "left").length;

  if (eligibleIndices.length < 2) {
    return `参与 ${eligibleIndices.length} 人 · 至少需要 2 名有筹码玩家`;
  }

  const dealerIndex = getPreviewDealerIndex(normalized);
  const layout = getHandLayout(dealerIndex, normalized);
  const detail = [
    `参与 ${eligibleIndices.length}`,
    `BTN ${getPlayerIdentityLabel(normalized[layout.dealerIndex], layout.dealerIndex, normalized)}`,
    `小盲 ${getPlayerIdentityLabel(normalized[layout.smallBlindIndex], layout.smallBlindIndex, normalized)}`,
    `大盲 ${getPlayerIdentityLabel(normalized[layout.bigBlindIndex], layout.bigBlindIndex, normalized)}`
  ];

  const pending = [];
  if (bustedCount > 0) pending.push(`${bustedCount} 人待补码`);
  if (sittingOutCount > 0) pending.push(`${sittingOutCount} 人坐出`);
  if (leftCount > 0) pending.push(`${leftCount} 人离桌`);
  if (pending.length > 0) detail.push(pending.join("，"));
  return detail.join(" · ");
}

export function moveDraftPlayer(tableDraft, index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= tableDraft.length) return false;
  const [player] = tableDraft.splice(index, 1);
  tableDraft.splice(nextIndex, 0, player);
  return true;
}

export function deleteDraftPlayer(tableDraft, index) {
  if (index < 0 || index >= tableDraft.length) return null;
  const [removed] = tableDraft.splice(index, 1);
  return removed || null;
}

export function adjustDraftChips(tableDraft, index, delta) {
  const draftPlayer = tableDraft[index];
  if (!draftPlayer) return false;
  draftPlayer.chips = Math.max(0, toNonNegativeNumber(draftPlayer.chips, 0) + delta);
  if (draftPlayer.chips <= 0 && draftPlayer.seatStatus === "seated") {
    draftPlayer.seatStatus = "busted";
  } else if (draftPlayer.chips > 0 && draftPlayer.seatStatus === "busted") {
    draftPlayer.seatStatus = "seated";
  }
  return true;
}

export function setDraftChips(tableDraft, index, value) {
  const draftPlayer = tableDraft[index];
  if (!draftPlayer) return false;
  draftPlayer.chips = toNonNegativeNumber(value, 0);
  return adjustDraftChips(tableDraft, index, 0);
}

export function setDraftStatus(tableDraft, index, status, { fallbackChips = 1000 } = {}) {
  const draftPlayer = tableDraft[index];
  if (!draftPlayer) return false;
  if (status === "seated" && draftPlayer.chips <= 0) {
    draftPlayer.chips = fallbackChips;
  } else if (status === "busted") {
    draftPlayer.chips = 0;
  }
  draftPlayer.seatStatus = normalizeSeatStatus(status, draftPlayer.chips, false);
  return true;
}

export function returnDraftPlayerToTable(tableDraft, index, { fallbackChips = 1000 } = {}) {
  const draftPlayer = tableDraft[index];
  if (!draftPlayer) return false;
  if (draftPlayer.chips <= 0) {
    draftPlayer.chips = fallbackChips;
  }
  return setDraftStatus(tableDraft, index, "seated", { fallbackChips });
}
