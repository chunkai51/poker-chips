// src/core/game-rules.js
// Pure poker table helpers shared by UI, sync, and future permission gates.

export const SEAT_STATUS_LABELS = {
  seated: "已入座",
  sittingOut: "坐出",
  busted: "待补码",
  left: "离桌"
};

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizeSeatStatus(value, chips = 0, allIn = false) {
  const status = String(value || "");
  if (Object.prototype.hasOwnProperty.call(SEAT_STATUS_LABELS, status)) {
    if (chips <= 0 && !allIn && (status === "seated" || status === "sittingOut" || status === "busted")) return "busted";
    if (status === "busted" && chips > 0) return "seated";
    return status;
  }
  if (chips <= 0 && !allIn) return "busted";
  return "seated";
}

export function getSeatStatusLabel(status) {
  return SEAT_STATUS_LABELS[status] || SEAT_STATUS_LABELS.seated;
}

export function isEligibleForNextHand(player) {
  return Boolean(player && player.seatStatus === "seated" && player.chips > 0);
}

export function getEligiblePlayerIndices(list = []) {
  return list
    .map((player, index) => (isEligibleForNextHand(player) ? index : -1))
    .filter(index => index >= 0);
}

export function getNextEligibleIndexAfter(index, eligibleIndices = []) {
  if (eligibleIndices.length === 0) return -1;
  const normalizedIndex = Number.isInteger(index) ? index : -1;
  const direct = eligibleIndices.find(candidate => candidate > normalizedIndex);
  return direct ?? eligibleIndices[0];
}

export function getNextEligibleIndexFrom(index, eligibleIndices = []) {
  if (eligibleIndices.length === 0) return -1;
  if (eligibleIndices.includes(index)) return index;
  return getNextEligibleIndexAfter(index, eligibleIndices);
}

export function getEligibleOrderFrom(startIndex, eligibleIndices = []) {
  if (eligibleIndices.length === 0) return [];

  const firstIndex = getNextEligibleIndexFrom(startIndex, eligibleIndices);
  const ordered = [firstIndex];
  while (ordered.length < eligibleIndices.length) {
    ordered.push(getNextEligibleIndexAfter(ordered[ordered.length - 1], eligibleIndices));
  }
  return ordered;
}

export function getHandLayout(dealerIndex, list = []) {
  const eligibleIndices = getEligiblePlayerIndices(list);
  const order = getEligibleOrderFrom(dealerIndex, eligibleIndices);
  if (order.length === 0) {
    return {
      order,
      dealerIndex: -1,
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      preflopFirstIndex: -1,
      postflopFirstIndex: -1
    };
  }

  if (order.length === 1) {
    return {
      order,
      dealerIndex: order[0],
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      preflopFirstIndex: -1,
      postflopFirstIndex: -1
    };
  }

  if (order.length === 2) {
    return {
      order,
      dealerIndex: order[0],
      smallBlindIndex: order[0],
      bigBlindIndex: order[1],
      preflopFirstIndex: order[0],
      postflopFirstIndex: order[1]
    };
  }

  return {
    order,
    dealerIndex: order[0],
    smallBlindIndex: order[1],
    bigBlindIndex: order[2],
    preflopFirstIndex: order[3 % order.length],
    postflopFirstIndex: order[1]
  };
}

export function canAct(player) {
  return Boolean(player && player.seatStatus === "seated" && !player.folded && !player.allIn && player.chips > 0);
}

export function getCallAmount(player, currentBet = 0) {
  if (!player || player.folded || player.allIn) return 0;
  return Math.max(0, toNonNegativeNumber(currentBet, 0) - toNonNegativeNumber(player.bet, 0));
}

export function getChipStep(smallBlind = 0, bigBlind = 0) {
  return Math.max(1, Math.floor(smallBlind || bigBlind / 2) || 1);
}

export function roundUpToChipStep(value, chipStep = 1) {
  const step = Math.max(1, toPositiveInteger(chipStep, 1));
  return Math.ceil(toNonNegativeNumber(value, 0) / step) * step;
}

export function getMaximumRaiseTarget(player) {
  if (!player) return 0;
  return toNonNegativeNumber(player.bet, 0) + toNonNegativeNumber(player.chips, 0);
}

export function getMinimumRaiseTarget(player, {
  currentBet = 0,
  lastRaiseSize = 0,
  bigBlind = 1,
  chipStep = 1
} = {}) {
  if (!player) return Math.max(bigBlind, 1);

  const minimumRaiseSize = Math.max(toPositiveInteger(lastRaiseSize, 0), toPositiveInteger(bigBlind, 1), 1);
  const ruleTarget = currentBet > 0
    ? toNonNegativeNumber(currentBet, 0) + minimumRaiseSize
    : toNonNegativeNumber(player.bet, 0) + Math.max(toPositiveInteger(bigBlind, 1), 1);
  return roundUpToChipStep(ruleTarget, chipStep);
}

export function getDefaultRaiseTarget(player, state = {}) {
  const maximumTarget = getMaximumRaiseTarget(player);
  if (maximumTarget <= 0) return 0;
  return Math.min(getMinimumRaiseTarget(player, state), maximumTarget);
}

export function getPotSizedRaiseTarget(player, fraction, {
  currentBet = 0,
  pot = 0,
  chipStep = 1
} = {}) {
  if (!player) return 0;
  const callAmount = getCallAmount(player, currentBet);
  const extraBet = (toNonNegativeNumber(pot, 0) + callAmount) * toNonNegativeNumber(fraction, 0);
  const target = toNonNegativeNumber(player.bet, 0) + callAmount + extraBet;
  return Math.min(roundUpToChipStep(target, chipStep), getMaximumRaiseTarget(player));
}

export function getRaiseUnavailableMessage(player, state = {}) {
  const currentBet = toNonNegativeNumber(state.currentBet, 0);
  if (!player) return "当前不能加注";
  if (getMaximumRaiseTarget(player) <= currentBet) {
    return "剩余筹码不足以加注，可以跟注 All In";
  }
  if (currentBet > 0 && player.acted && toNonNegativeNumber(player.bet, 0) < currentBet) {
    return "短码 All In 未重新开放加注，只能跟注或弃牌";
  }
  return "";
}

export function canPlayerRaise(player, state = {}) {
  return Boolean(player && canAct(player) && !getRaiseUnavailableMessage(player, state));
}

export function getRaiseValidation(player, rawTarget, state = {}) {
  const targetBet = toPositiveInteger(rawTarget, 0);
  const maximumTarget = getMaximumRaiseTarget(player);
  const minimumTarget = getMinimumRaiseTarget(player, state);
  const callAmount = getCallAmount(player, state.currentBet);
  const commitAmount = Math.max(0, targetBet - toNonNegativeNumber(player?.bet, 0));
  const isAllIn = Boolean(player && commitAmount === toNonNegativeNumber(player.chips, 0) && player.chips > 0);

  if (!player || targetBet <= 0) {
    return { valid: false, message: "请输入加注目标", targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  const unavailableMessage = getRaiseUnavailableMessage(player, state);
  if (unavailableMessage) {
    return { valid: false, message: unavailableMessage, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (targetBet > maximumTarget) {
    return { valid: false, message: `最多加到 ${maximumTarget}`, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (commitAmount <= 0) {
    return { valid: false, message: "加注目标必须高于当前投入", targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (state.currentBet > 0 && targetBet <= state.currentBet) {
    return { valid: false, message: `要加注必须高于当前最高下注 ${state.currentBet}`, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (commitAmount <= callAmount) {
    return { valid: false, message: callAmount > 0 ? `本次投入需超过跟注额 ${callAmount}` : "请选择有效下注额", targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (targetBet < minimumTarget && !isAllIn) {
    return { valid: false, message: `最小加注需要加到 ${minimumTarget}`, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }

  return {
    valid: true,
    message: targetBet < minimumTarget && isAllIn ? "All In 未达到完整最小加注，不会更新最小加注幅度" : "",
    targetBet,
    commitAmount,
    minimumTarget,
    maximumTarget,
    isAllIn
  };
}
