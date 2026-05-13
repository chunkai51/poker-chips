// src/game/settlement-controller.js
// DOM-free settlement state transitions: showdown setup, winner selections, previews, and payouts.

import {
  buildSettlementPlan,
  buildSidePots,
  createSettlementPreview,
  getSettlementReportLines
} from "../core/settlement-engine.js";

function clonePlayers(players = []) {
  return Array.isArray(players) ? players.map(player => ({ ...player })) : [];
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cloneWinnerSelections(selectedWinnersByPot = {}) {
  return Object.fromEntries(Object.entries(selectedWinnersByPot).map(([potIndex, selected]) => {
    if (selected instanceof Set) return [potIndex, new Set([...selected].map(String))];
    if (Array.isArray(selected)) return [potIndex, new Set(selected.map(String))];
    return [potIndex, new Set()];
  }));
}

export function createWinnerSelectionsFromPots(sidePots = []) {
  const selections = {};
  sidePots.forEach((sidePot, index) => {
    if (sidePot.contenders?.length === 1) {
      selections[index] = new Set(sidePot.contenders.map(String));
    }
  });
  return selections;
}

export function createWinnerSelectionsFromPreview(preview) {
  const winnersByPot = preview?.winnersByPot || {};
  return Object.fromEntries(Object.entries(winnersByPot).map(([potIndex, winnerIds]) => {
    return [potIndex, new Set(Array.isArray(winnerIds) ? winnerIds.map(String) : [])];
  }));
}

function markZeroChipPlayersBusted(players = []) {
  const bustedPlayerIds = [];
  players.forEach(player => {
    if (player.chips <= 0 && player.seatStatus === "seated") {
      player.chips = 0;
      player.seatStatus = "busted";
      bustedPlayerIds.push(String(player.id || ""));
    }
  });
  return bustedPlayerIds.filter(Boolean);
}

function createSettledBaseState(players, bigBlind) {
  return {
    players,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: toPositiveInteger(bigBlind, 20),
    currentPlayerIndex: -1,
    awaitingShowdown: false,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    gameOver: true,
    handStatus: "settled"
  };
}

export function createShowdownState({
  players = [],
  pot = 0
} = {}) {
  const pendingPots = buildSidePots(players, pot);
  return {
    awaitingShowdown: true,
    gameOver: true,
    handStatus: "showdown",
    currentPlayerIndex: -1,
    pendingPots,
    selectedWinnersByPot: createWinnerSelectionsFromPots(pendingPots),
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {}
  };
}

export function toggleWinnerSelection({
  selectedWinnersByPot = {},
  potIndex = 0,
  playerId = ""
} = {}) {
  const selections = cloneWinnerSelections(selectedWinnersByPot);
  const key = String(potIndex);
  const selected = selections[key] || new Set();
  const id = String(playerId);
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  selections[key] = selected;
  return selections;
}

export function createSettlementPlanState({
  pendingPots = [],
  players = [],
  selectedWinnersByPot = {}
} = {}) {
  return buildSettlementPlan(pendingPots, players, selectedWinnersByPot);
}

export function createSettlementPreviewState({
  pendingPots = [],
  players = [],
  selectedWinnersByPot = {},
  handId = 0
} = {}) {
  const { settlementPlan, error } = createSettlementPlanState({
    pendingPots,
    players,
    selectedWinnersByPot
  });
  if (error) return { ok: false, error };

  const settlementPreview = createSettlementPreview(settlementPlan, { handId });
  return {
    ok: true,
    settlementPreview,
    selectedWinnersByPot: createWinnerSelectionsFromPreview(settlementPreview),
    handStatus: "settlementPreview",
    awaitingShowdown: true,
    gameOver: true,
    currentPlayerIndex: -1
  };
}

export function cancelSettlementPreviewState(preview) {
  return {
    selectedWinnersByPot: createWinnerSelectionsFromPreview(preview),
    settlementPreview: null,
    awaitingShowdown: true,
    gameOver: true,
    handStatus: "showdown",
    currentPlayerIndex: -1
  };
}

export function getSettlementReport(preview, options = {}) {
  return getSettlementReportLines(preview, options);
}

export function finalizeSettlementPreviewState({
  players = [],
  preview = null,
  bigBlind = 20
} = {}) {
  const nextPlayers = clonePlayers(players);
  (preview?.pots || []).forEach(previewPot => {
    (previewPot.payouts || []).forEach(payout => {
      const winner = nextPlayers.find(player => String(player.id) === String(payout.playerId));
      if (winner) {
        winner.chips += payout.amount;
      }
    });
  });

  const bustedPlayerIds = markZeroChipPlayersBusted(nextPlayers);
  return {
    ...createSettledBaseState(nextPlayers, bigBlind),
    bustedPlayerIds
  };
}

export function awardRemainingPotState({
  players = [],
  winnerId = "",
  pot = 0,
  bigBlind = 20
} = {}) {
  const nextPlayers = clonePlayers(players);
  const winner = nextPlayers.find(player => String(player.id) === String(winnerId));
  const wonAmount = Number.isFinite(Number(pot)) && Number(pot) >= 0 ? Number(pot) : 0;
  if (winner) {
    winner.chips += wonAmount;
  }
  const bustedPlayerIds = markZeroChipPlayersBusted(nextPlayers);
  return {
    ...createSettledBaseState(nextPlayers, bigBlind),
    wonAmount,
    winnerId: winner ? String(winner.id) : "",
    bustedPlayerIds
  };
}
