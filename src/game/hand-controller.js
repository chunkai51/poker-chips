// src/game/hand-controller.js
// DOM-free hand lifecycle transitions: round setup, blinds, positions, and next-hand reset.

import {
  getEligiblePlayerIndices,
  getHandLayout,
  getNextEligibleIndexAfter,
  getNextEligibleIndexFrom,
  getSeatStatusLabel,
  isEligibleForNextHand,
  normalizeSeatStatus
} from "../core/game-rules.js";
import { createDealPrompt } from "../core/deal-prompts.js";
import {
  commitChipsToPlayer,
  findNextActionableIndex,
  getMaxStreetBet
} from "../core/hand-flow-controller.js";

function clonePlayers(players = []) {
  return Array.isArray(players) ? players.map(player => ({ ...player })) : [];
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function setDealer(players, dealerIndex) {
  players.forEach((player, index) => {
    player.dealer = index === dealerIndex;
  });
}

export function normalizeDealerForHand(players = []) {
  const nextPlayers = clonePlayers(players);
  const eligibleIndices = getEligiblePlayerIndices(nextPlayers);
  if (eligibleIndices.length === 0) {
    nextPlayers.forEach(player => {
      player.dealer = false;
    });
    return { players: nextPlayers, dealerIndex: -1 };
  }

  const currentDealerIndex = nextPlayers.findIndex(player => player.dealer);
  const dealerIndex = currentDealerIndex >= 0
    ? getNextEligibleIndexFrom(currentDealerIndex, eligibleIndices)
    : eligibleIndices[0];
  setDealer(nextPlayers, dealerIndex);
  return { players: nextPlayers, dealerIndex };
}

export function assignHandPositions(players = [], dealerIndex = -1) {
  const nextPlayers = clonePlayers(players);
  nextPlayers.forEach(player => {
    player.position = getSeatStatusLabel(player.seatStatus);
  });

  const layout = getHandLayout(dealerIndex, nextPlayers);
  if (layout.order.length === 0) return { players: nextPlayers, layout };

  if (layout.order.length === 1) {
    nextPlayers[layout.dealerIndex].position = "等待对手";
    return { players: nextPlayers, layout };
  }

  layout.order.forEach((index, offset) => {
    if (layout.order.length === 2) {
      nextPlayers[index].position = offset === 0 ? "Dealer / 小盲" : "大盲";
    } else if (offset === 0) {
      nextPlayers[index].position = "Dealer";
    } else if (offset === 1) {
      nextPlayers[index].position = "小盲";
    } else if (offset === 2) {
      nextPlayers[index].position = "大盲";
    } else {
      nextPlayers[index].position = "普通玩家";
    }
  });
  return { players: nextPlayers, layout };
}

export function getFirstActionIndexForRound(players = [], round = 0) {
  const normalized = normalizeDealerForHand(players);
  const layout = getHandLayout(normalized.dealerIndex, normalized.players);
  return round === 0 ? layout.preflopFirstIndex : layout.postflopFirstIndex;
}

function commitAt(players, index, amount) {
  if (index < 0 || !players[index]) return 0;
  const result = commitChipsToPlayer(players[index], amount);
  players[index] = result.player;
  return result.committed;
}

export function prepareRoundStartState({
  players = [],
  currentRound = 0,
  pot = 0,
  bigBlind = 20,
  smallBlind = 10,
  handId = 0
} = {}) {
  let nextPlayers = clonePlayers(players);
  const round = Math.max(0, Number.isInteger(currentRound) ? currentRound : 0);
  const nextBigBlind = toPositiveInteger(bigBlind, 20);
  let nextPot = round === 0 ? 0 : pot;

  const state = {
    currentBet: 0,
    lastRaiseSize: nextBigBlind,
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    pendingPots: round === 0 ? [] : undefined,
    awaitingShowdown: round === 0 ? false : undefined,
    gameOver: false,
    handStatus: "playing",
    currentPlayerIndex: -1,
    pot: nextPot,
    outcome: "readyForAction",
    dealerIndex: -1,
    layout: null,
    blindPosts: null
  };

  if (round === 0) {
    nextPlayers.forEach(player => {
      player.bet = 0;
      player.totalBet = 0;
      player.seatStatus = normalizeSeatStatus(player.seatStatus, player.chips, false);
      if (player.chips <= 0 && player.seatStatus === "seated") {
        player.seatStatus = "busted";
      }
      player.folded = !isEligibleForNextHand(player);
      player.acted = false;
      player.allIn = false;
    });
  } else {
    nextPlayers.forEach(player => {
      player.bet = 0;
      player.acted = false;
    });
  }

  const eligibleIndices = getEligiblePlayerIndices(nextPlayers);
  if (round === 0 && eligibleIndices.length < 2) {
    const normalized = normalizeDealerForHand(nextPlayers);
    const positioned = assignHandPositions(normalized.players, normalized.dealerIndex);
    return {
      ...state,
      players: positioned.players,
      dealerIndex: normalized.dealerIndex,
      layout: positioned.layout,
      gameOver: true,
      handStatus: "settled",
      outcome: "insufficientPlayers"
    };
  }

  const normalized = normalizeDealerForHand(nextPlayers);
  const positioned = assignHandPositions(normalized.players, normalized.dealerIndex);
  nextPlayers = positioned.players;
  state.dealerIndex = normalized.dealerIndex;
  state.layout = positioned.layout;

  if (round === 0) {
    const smallBlindPosted = commitAt(nextPlayers, state.layout.smallBlindIndex, smallBlind);
    const bigBlindPosted = commitAt(nextPlayers, state.layout.bigBlindIndex, nextBigBlind);
    nextPot += smallBlindPosted + bigBlindPosted;
    return {
      ...state,
      players: nextPlayers,
      currentBet: getMaxStreetBet(nextPlayers),
      pot: nextPot,
      pendingDealPrompt: createDealPrompt(0, { handId }),
      handStatus: "waitingDeal",
      outcome: "waitingDeal",
      blindPosts: {
        smallBlindIndex: state.layout.smallBlindIndex,
        bigBlindIndex: state.layout.bigBlindIndex,
        smallBlindPosted,
        bigBlindPosted
      }
    };
  }

  return {
    ...state,
    players: nextPlayers,
    currentPlayerIndex: findNextActionableIndex(nextPlayers, state.layout.postflopFirstIndex, true),
    outcome: "readyForAction"
  };
}

export function prepareNextHandResetState({
  players = [],
  expectedHandId = 0,
  bigBlind = 20
} = {}) {
  const nextPlayers = clonePlayers(players);
  const eligibleIndices = getEligiblePlayerIndices(nextPlayers);
  if (eligibleIndices.length < 2) {
    return { ok: false, players: nextPlayers };
  }

  let dealerIndex = nextPlayers.findIndex(player => player.dealer);
  if (dealerIndex === -1) dealerIndex = eligibleIndices[eligibleIndices.length - 1];
  setDealer(nextPlayers, getNextEligibleIndexAfter(dealerIndex, eligibleIndices));

  nextPlayers.forEach(player => {
    player.bet = 0;
    player.totalBet = 0;
    player.folded = false;
    player.acted = false;
    player.allIn = false;
  });

  return {
    ok: true,
    players: nextPlayers,
    currentRound: 0,
    currentBet: 0,
    lastRaiseSize: toPositiveInteger(bigBlind, 20),
    pot: 0,
    currentPlayerIndex: -1,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    awaitingShowdown: false,
    gameOver: false,
    handId: expectedHandId + 1,
    handStatus: "playing"
  };
}
