// src/deal-prompts.js
// Pure helpers for synchronized dealer prompts between betting rounds.

const DEAL_PROMPTS = {
  0: {
    title: "请发手牌",
    cardText: "给每位玩家发两张底牌",
    detail: "盲注已自动下入，确认后进入翻牌前行动。"
  },
  1: {
    title: "请发翻牌",
    cardText: "发三张公共牌",
    detail: "确认后进入翻牌后下注。"
  },
  2: {
    title: "请发转牌",
    cardText: "发一张转牌",
    detail: "确认后进入转牌下注。"
  },
  3: {
    title: "请发河牌",
    cardText: "发一张河牌",
    detail: "确认后进入河牌下注。"
  }
};

export function getDealPromptMeta(nextRound) {
  return DEAL_PROMPTS[nextRound] || {
    title: "请发下一张公共牌",
    cardText: "发公共牌",
    detail: "确认后继续牌局。"
  };
}

export function createDealPrompt(nextRound, { handId = 0, now = Date.now() } = {}) {
  const prompt = getDealPromptMeta(nextRound);
  return {
    id: `deal_${handId}_${nextRound}_${now}`,
    nextRound,
    ...prompt
  };
}

export function normalizeIncomingDealPrompt(prompt, { handId = 0, roundCount = 4 } = {}) {
  if (!prompt || typeof prompt !== "object") return null;

  const nextRound = Number(prompt.nextRound);
  if (!Number.isInteger(nextRound) || nextRound < 0 || nextRound >= roundCount) {
    return null;
  }

  const fallback = getDealPromptMeta(nextRound);
  return {
    id: String(prompt.id || `deal_${handId}_${nextRound}`),
    nextRound,
    title: String(prompt.title || fallback.title),
    cardText: String(prompt.cardText || fallback.cardText),
    detail: String(prompt.detail || fallback.detail)
  };
}
