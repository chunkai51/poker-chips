// src/core/settlement-engine.js
// Pure settlement helpers for side-pot construction, winner plans, payouts, and reports.

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeIdList(value) {
  if (value instanceof Set) return Array.from(value).map(String);
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function haveSameContenders(leftPot, rightPot) {
  if (leftPot.contenders.length !== rightPot.contenders.length) return false;

  const rightIds = new Set(rightPot.contenders);
  return leftPot.contenders.every(id => rightIds.has(id));
}

export function mergeEquivalentSidePots(sidePots) {
  return sidePots.reduce((mergedPots, sidePot) => {
    const previousPot = mergedPots[mergedPots.length - 1];
    if (previousPot && haveSameContenders(previousPot, sidePot)) {
      previousPot.amount += sidePot.amount;
      previousPot.participants = [...new Set([
        ...previousPot.participants,
        ...sidePot.participants
      ])];
    } else {
      mergedPots.push({
        amount: sidePot.amount,
        participants: [...sidePot.participants],
        contenders: [...sidePot.contenders]
      });
    }
    return mergedPots;
  }, []);
}

export function buildSidePots(players = [], pot = 0) {
  const normalizedPlayers = Array.isArray(players) ? players : [];
  const activeCommittedPlayers = normalizedPlayers
    .filter(player => !player.folded && toNonNegativeNumber(player.totalBet, 0) > 0)
    .sort((a, b) => toNonNegativeNumber(a.totalBet, 0) - toNonNegativeNumber(b.totalBet, 0));

  const levels = [...new Set(activeCommittedPlayers.map(player => toNonNegativeNumber(player.totalBet, 0)))];
  const sidePots = [];
  let previousLevel = 0;

  levels.forEach(level => {
    const participants = normalizedPlayers.filter(player => toNonNegativeNumber(player.totalBet, 0) > previousLevel);
    const amount = participants.reduce((sum, player) => {
      return sum + Math.max(0, Math.min(toNonNegativeNumber(player.totalBet, 0), level) - previousLevel);
    }, 0);
    const contenders = activeCommittedPlayers
      .filter(player => toNonNegativeNumber(player.totalBet, 0) >= level)
      .map(player => String(player.id));

    if (amount > 0 && contenders.length > 0) {
      sidePots.push({
        amount,
        participants: participants.map(player => String(player.id)),
        contenders
      });
    }
    previousLevel = level;
  });

  const normalizedPot = toNonNegativeNumber(pot, 0);
  if (sidePots.length === 0 && normalizedPot > 0) {
    const activeIds = normalizedPlayers
      .filter(player => !player.folded)
      .map(player => String(player.id));
    sidePots.push({
      amount: normalizedPot,
      participants: activeIds,
      contenders: activeIds
    });
  }

  const calculatedTotal = sidePots.reduce((sum, sidePot) => sum + sidePot.amount, 0);
  if (sidePots.length > 0 && calculatedTotal !== normalizedPot) {
    sidePots[sidePots.length - 1].amount += normalizedPot - calculatedTotal;
  }

  return mergeEquivalentSidePots(sidePots);
}

export function calculatePayouts(sidePot, winnerIds = []) {
  const winners = normalizeIdList(winnerIds);
  if (winners.length === 0) return [];

  const amount = toNonNegativeNumber(sidePot?.amount, 0);
  const baseShare = Math.floor(amount / winners.length);
  let remainder = amount % winners.length;

  return winners.map(playerId => {
    const extraChip = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return {
      playerId,
      amount: baseShare + extraChip
    };
  });
}

export function buildSettlementPlan(sidePots = [], players = [], selectedWinnersByPot = {}) {
  const settlementPlan = [];
  const playerById = new Map((Array.isArray(players) ? players : []).map(player => [String(player.id), player]));

  for (let index = 0; index < sidePots.length; index += 1) {
    const sidePot = sidePots[index];
    const contenders = normalizeIdList(sidePot.contenders).filter(id => {
      const player = playerById.get(id);
      return player && !player.folded;
    });
    const selected = normalizeIdList(selectedWinnersByPot[index]).filter(id => contenders.includes(id));
    const winnerIds = contenders.length === 1 ? contenders : selected;

    if (winnerIds.length === 0) {
      return {
        settlementPlan: null,
        error: `请为奖池 ${index + 1} 至少选择一位赢家`
      };
    }

    settlementPlan.push({
      potIndex: index,
      sidePot,
      winnerIds,
      payouts: calculatePayouts(sidePot, winnerIds)
    });
  }

  return { settlementPlan, error: "" };
}

export function createSettlementPreview(settlementPlan = [], { handId = 0, now = Date.now() } = {}) {
  return {
    id: `settlement_${handId}_${now}`,
    total: settlementPlan.reduce((sum, item) => sum + toNonNegativeNumber(item.sidePot?.amount, 0), 0),
    winnersByPot: Object.fromEntries(settlementPlan.map(item => [item.potIndex, item.winnerIds])),
    approvals: {},
    pots: settlementPlan.map(item => ({
      index: item.potIndex,
      amount: toNonNegativeNumber(item.sidePot?.amount, 0),
      winnerIds: [...item.winnerIds],
      payouts: item.payouts.map(payout => ({ ...payout }))
    }))
  };
}

export function getSettlementReportLines(preview, { getPlayerLabel = playerId => playerId } = {}) {
  const lines = [];
  (preview?.pots || []).forEach(previewPot => {
    lines.push(`奖池 ${previewPot.index + 1}（${previewPot.amount}）:`);
    (previewPot.payouts || []).forEach(payout => {
      lines.push(`${getPlayerLabel(payout.playerId)} 获得 ${payout.amount} 筹码`);
    });
  });
  return lines;
}
