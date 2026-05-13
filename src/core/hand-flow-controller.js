// src/core/hand-flow-controller.js
// Pure helpers for betting actions and hand-flow decisions.

import {
  canAct,
  getRaiseValidation
} from "./game-rules.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clonePlayers(players = []) {
  return Array.isArray(players) ? players.map(player => ({ ...player })) : [];
}

export function commitChipsToPlayer(player, requestedAmount) {
  const nextPlayer = { ...player };
  const amount = Math.min(toNonNegativeNumber(requestedAmount, 0), toNonNegativeNumber(nextPlayer.chips, 0));
  if (amount <= 0) return { player: nextPlayer, committed: 0 };

  nextPlayer.chips -= amount;
  nextPlayer.bet = toNonNegativeNumber(nextPlayer.bet, 0) + amount;
  nextPlayer.totalBet = toNonNegativeNumber(nextPlayer.totalBet, 0) + amount;
  if (nextPlayer.chips === 0) {
    nextPlayer.allIn = true;
  }
  return { player: nextPlayer, committed: amount };
}

function commitPlayerAtIndex(players, index, requestedAmount) {
  const result = commitChipsToPlayer(players[index], requestedAmount);
  players[index] = result.player;
  return result.committed;
}

export function applyBettingAction({
  players = [],
  index = -1,
  action = "",
  amount = 0,
  currentBet = 0,
  lastRaiseSize = 0,
  pot = 0,
  raiseState = {}
} = {}) {
  const nextPlayers = clonePlayers(players);
  const player = nextPlayers[index];
  if (!player) return { ok: false, message: "无效玩家" };

  let nextCurrentBet = toNonNegativeNumber(currentBet, 0);
  let nextLastRaiseSize = toNonNegativeNumber(lastRaiseSize, 0);
  let nextPot = toNonNegativeNumber(pot, 0);
  let logAction = action;

  switch (action) {
    case "check":
      if (toNonNegativeNumber(player.bet, 0) < nextCurrentBet) {
        return { ok: false, message: "已有下注，不能选择 Check！" };
      }
      player.acted = true;
      logAction = "Check";
      break;

    case "call": {
      const callAmount = Math.max(0, nextCurrentBet - toNonNegativeNumber(player.bet, 0));
      if (callAmount === 0) {
        return { ok: false, message: "当前无需跟注，可以选择 Check" };
      }
      const committed = commitPlayerAtIndex(nextPlayers, index, callAmount);
      nextPot += committed;
      nextPlayers[index].acted = true;
      logAction = committed < callAmount ? `All In 跟注 ${committed}` : `Call ${committed}`;
      break;
    }

    case "raise": {
      const targetBet = toPositiveInteger(amount, 0);
      const validation = getRaiseValidation(player, targetBet, {
        ...raiseState,
        currentBet: nextCurrentBet,
        lastRaiseSize: nextLastRaiseSize,
        pot: nextPot
      });
      if (!validation.valid) {
        return { ok: false, message: validation.message };
      }

      const previousBet = nextCurrentBet;
      const committed = validation.commitAmount;
      nextPot += commitPlayerAtIndex(nextPlayers, index, committed);
      nextPlayers[index].acted = true;

      if (toNonNegativeNumber(nextPlayers[index].bet, 0) > previousBet) {
        const raiseSize = nextPlayers[index].bet - previousBet;
        const isFullRaise = nextPlayers[index].bet >= validation.minimumTarget;
        nextCurrentBet = nextPlayers[index].bet;
        if (isFullRaise) {
          nextLastRaiseSize = raiseSize;
          nextPlayers.forEach((otherPlayer, otherIndex) => {
            if (otherIndex !== index && !otherPlayer.folded && !otherPlayer.allIn) {
              otherPlayer.acted = false;
            }
          });
        }
        logAction = nextPlayers[index].allIn
          ? `All In 加到 ${nextPlayers[index].bet}${isFullRaise ? "" : "（未达到完整最小加注）"}`
          : `Raise 到 ${nextPlayers[index].bet}`;
      } else {
        logAction = `All In 跟注 ${committed}`;
      }
      break;
    }

    case "fold":
      player.folded = true;
      player.acted = true;
      logAction = "Fold";
      break;

    default:
      return { ok: false, message: "无效操作！" };
  }

  return {
    ok: true,
    players: nextPlayers,
    currentBet: nextCurrentBet,
    lastRaiseSize: nextLastRaiseSize,
    pot: nextPot,
    logAction
  };
}

export function getActivePlayers(players = []) {
  return players.filter(player => !player.folded);
}

export function getAutomaticHandEndState(players = [], currentBet = 0) {
  const active = getActivePlayers(players);
  if (active.length <= 1) {
    return {
      type: "awardRemainingPot",
      winnerId: active[0]?.id || ""
    };
  }

  if (active.every(player => player.allIn)) {
    return { type: "showdown" };
  }

  const activeNotAllIn = active.filter(player => !player.allIn);
  const hasAllInPlayer = active.length !== activeNotAllIn.length;
  const obligationsSettled = activeNotAllIn.every(player => player.bet === currentBet);
  if (hasAllInPlayer && activeNotAllIn.length <= 1 && obligationsSettled) {
    return { type: "showdown" };
  }

  return { type: "continue" };
}

export function isBettingRoundComplete(players = [], currentBet = 0) {
  const active = getActivePlayers(players);
  return active.length > 1 && active.every(player => {
    return player.allIn || (player.acted && player.bet === currentBet);
  });
}

export function findNextActionableIndex(players = [], startIndex = -1, includeStart = false) {
  if (players.length === 0) return -1;
  const firstOffset = includeStart ? 0 : 1;

  for (let offset = firstOffset; offset < players.length + firstOffset; offset += 1) {
    const index = (startIndex + offset + players.length) % players.length;
    if (canAct(players[index])) return index;
  }

  return -1;
}

export function getMaxStreetBet(players = []) {
  return players.reduce((max, player) => Math.max(max, toNonNegativeNumber(player.bet, 0)), 0);
}
