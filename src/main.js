// src/main.js
import { db, get, onValue, ref, runTransaction, update } from "./firebase.js";
import { initGuidePanels } from "./guide.js";
import { initChipRiffle } from "./riffle.js";

// ----------------------
// 全局变量及 DOM 获取
// ----------------------
let players = [];
let currentPlayerIndex = -1;
let pot = 0;               // 累积奖池
let currentBet = 0;        // 本轮最大下注
let lastRaiseSize = 20;    // 本轮最近一次完整下注/加注幅度
let currentRound = 0;      // 0-翻牌前、1-翻牌后、2-转牌、3-河牌
const rounds = ["翻牌前", "翻牌后", "转牌", "河牌"];

const setupContainer = document.getElementById("setup");
const gameContainer = document.getElementById("game");
const playerNameInputsContainer = document.getElementById("player-names");
const startGameBtn = document.getElementById("start-game");
const addPlayerBtn = document.getElementById("add-player");
const initialChipsInput = document.getElementById("initial-chips");
const bigBlindInput = document.getElementById("big-blind");
const roomIdInput = document.getElementById("room-id");
const manualSyncBtn = document.getElementById("manual-sync");
const gameLog = document.getElementById("game-log");
const handActions = document.getElementById("hand-actions");
const logSummary = document.getElementById("log-summary");
const showdownPanel = document.getElementById("showdown-panel");
const dealPromptPanel = document.getElementById("deal-prompt-panel");
const settlementPreviewPanel = document.getElementById("settlement-preview-panel");
const tableManagerBackdrop = document.getElementById("table-manager-backdrop");
const tableManagerPanel = document.getElementById("table-manager-panel");
const syncStatusEl = document.getElementById("sync-status");
const riffleTrigger = document.querySelector(".brand-mark-button");

initGuidePanels();
initChipRiffle({ trigger: riffleTrigger });

let bigBlind = 20;
let smallBlind = 10;

let gameOver = false;
let gameStarted = false;
let awaitingShowdown = false;
let pendingPots = [];
let selectedWinnersByPot = {};
let pendingDealPrompt = null;
let settlementPreview = null;
let tableDraft = null;
let tableManagerOpen = false;
let tableDraftBaseHandId = null;
let tableDraftBaseStateVersion = null;
let unsubscribeRoom = null;
let listenedRoomId = "";
let stateVersion = 0;
let handId = 0;
let handStatus = "setup";
let mutationInProgress = false;
let syncReady = false;
let syncWriteInProgress = false;
let batchingStateUpdate = false;

const CLIENT_ID_KEY = "pokerChipsClientId";
const MAX_PLAYERS = 10;
const clientId = getClientId();
const SEAT_STATUS_LABELS = {
  seated: "已入座",
  sittingOut: "坐出",
  busted: "待补码",
  left: "离桌"
};

// ----------------------
// 房间系统数据结构
// ----------------------
let room = {
  roomId: "",
  operator: clientId,
  players: [],
  gameState: {
    currentRound: 0,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: 20,
    currentPlayerIndex: -1,
    logs: [],
    inProgress: false,
    gameOver: false,
    awaitingShowdown: false,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    handId: 0,
    handStatus: "setup",
    stateVersion: 0,
    updatedBy: clientId
  }
};

// ----------------------
// 通用工具函数
// ----------------------
function getClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;

    const nextId = crypto.randomUUID
      ? crypto.randomUUID()
      : `client_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    localStorage.setItem(CLIENT_ID_KEY, nextId);
    return nextId;
  } catch (_) {
    return `client_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }
}

function normalizeRoomId(value) {
  return String(value || "")
    .trim()
    .replace(/[.#$\[\]/]/g, "_")
    .slice(0, 64);
}

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getPlayerName(player) {
  return player && player.name ? player.name : "未命名玩家";
}

function getPlayerById(id) {
  return players.find(player => player.id === id);
}

function getActivePlayers() {
  return players.filter(player => !player.folded);
}

function normalizeSeatStatus(value, chips = 0, allIn = false) {
  const status = String(value || "");
  if (Object.prototype.hasOwnProperty.call(SEAT_STATUS_LABELS, status)) {
    if (chips <= 0 && !allIn && (status === "seated" || status === "sittingOut" || status === "busted")) return "busted";
    if (status === "busted" && chips > 0) return "seated";
    return status;
  }
  if (chips <= 0 && !allIn) return "busted";
  return "seated";
}

function getSeatStatusLabel(status) {
  return SEAT_STATUS_LABELS[status] || SEAT_STATUS_LABELS.seated;
}

function isEligibleForNextHand(player) {
  return Boolean(player && player.seatStatus === "seated" && player.chips > 0);
}

function getEligiblePlayerIndices(list = players) {
  return list
    .map((player, index) => (isEligibleForNextHand(player) ? index : -1))
    .filter(index => index >= 0);
}

function getNextEligibleIndexAfter(index, eligibleIndices = getEligiblePlayerIndices()) {
  if (eligibleIndices.length === 0) return -1;
  const normalizedIndex = Number.isInteger(index) ? index : -1;
  const direct = eligibleIndices.find(candidate => candidate > normalizedIndex);
  return direct ?? eligibleIndices[0];
}

function getNextEligibleIndexFrom(index, eligibleIndices = getEligiblePlayerIndices()) {
  if (eligibleIndices.length === 0) return -1;
  if (eligibleIndices.includes(index)) return index;
  return getNextEligibleIndexAfter(index, eligibleIndices);
}

function canAct(player) {
  return Boolean(player && player.seatStatus === "seated" && !player.folded && !player.allIn && player.chips > 0);
}

function getCallAmount(player) {
  if (!player || player.folded || player.allIn) return 0;
  return Math.max(0, currentBet - player.bet);
}

function getCallButtonLabel(player) {
  const callAmount = getCallAmount(player);
  if (callAmount <= 0) return "Call";
  if (player.chips < callAmount) return `All In ${player.chips}`;
  return `Call ${callAmount}`;
}

function getRaiseUnavailableMessage(player) {
  if (!player) return "当前不能加注";
  if (getMaximumRaiseTarget(player) <= currentBet) {
    return "剩余筹码不足以加注，可以跟注 All In";
  }
  if (currentBet > 0 && player.acted && player.bet < currentBet) {
    return "短码 All In 未重新开放加注，只能跟注或弃牌";
  }
  return "";
}

function canPlayerRaise(player) {
  return Boolean(player && canAct(player) && !getRaiseUnavailableMessage(player));
}

function getChipStep() {
  return Math.max(1, Math.floor(smallBlind || bigBlind / 2) || 1);
}

function roundUpToChipStep(value) {
  const step = getChipStep();
  return Math.ceil(toNonNegativeNumber(value, 0) / step) * step;
}

function getMaximumRaiseTarget(player) {
  if (!player) return 0;
  return player.bet + player.chips;
}

function getMinimumRaiseTarget(player) {
  if (!player) return Math.max(bigBlind, 1);
  const minimumRaiseSize = Math.max(lastRaiseSize, bigBlind, 1);
  const ruleTarget = currentBet > 0
    ? currentBet + minimumRaiseSize
    : player.bet + Math.max(bigBlind, 1);
  return roundUpToChipStep(ruleTarget);
}

function getDefaultRaiseTarget(player) {
  const maximumTarget = getMaximumRaiseTarget(player);
  if (maximumTarget <= 0) return 0;
  return Math.min(getMinimumRaiseTarget(player), maximumTarget);
}

function getPotSizedRaiseTarget(player, fraction) {
  if (!player) return 0;
  const callAmount = getCallAmount(player);
  const extraBet = (pot + callAmount) * fraction;
  const target = player.bet + callAmount + extraBet;
  return Math.min(roundUpToChipStep(target), getMaximumRaiseTarget(player));
}

function getRaiseValidation(player, rawTarget) {
  const targetBet = toPositiveInteger(rawTarget, 0);
  const maximumTarget = getMaximumRaiseTarget(player);
  const minimumTarget = getMinimumRaiseTarget(player);
  const callAmount = getCallAmount(player);
  const commitAmount = Math.max(0, targetBet - (player?.bet || 0));
  const isAllIn = Boolean(player && commitAmount === player.chips && player.chips > 0);

  if (!player || targetBet <= 0) {
    return { valid: false, message: "请输入加注目标", targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  const unavailableMessage = getRaiseUnavailableMessage(player);
  if (unavailableMessage) {
    return { valid: false, message: unavailableMessage, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (targetBet > maximumTarget) {
    return { valid: false, message: `最多加到 ${maximumTarget}`, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (commitAmount <= 0) {
    return { valid: false, message: "加注目标必须高于当前投入", targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
  }
  if (currentBet > 0 && targetBet <= currentBet) {
    return { valid: false, message: `要加注必须高于当前最高下注 ${currentBet}`, targetBet, commitAmount, minimumTarget, maximumTarget, isAllIn };
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

function createParagraph(text) {
  const p = document.createElement("p");
  p.textContent = text;
  return p;
}

function createButton(label, onClick, disabled = false, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

function clearGameLog() {
  gameLog.replaceChildren();
  room.gameState.logs = [];
  updateLogSummary();
}

function updateLogSummary() {
  if (!logSummary) return;
  const count = room.gameState.logs.length;
  logSummary.textContent = count > 0 ? `操作记录（${count}）` : "操作记录";
}

function setSyncStatus(message, status = "") {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = message;
  syncStatusEl.classList.remove("ok", "error");
  if (status) syncStatusEl.classList.add(status);
}

function isInteractionLocked() {
  return mutationInProgress || syncWriteInProgress || !syncReady;
}

function isSharedPromptActionLocked() {
  return mutationInProgress || syncWriteInProgress || !syncReady;
}

function refreshInteractiveControls() {
  updatePlayerBoxes();
  renderDealPromptPanel();
  renderSettlementPreviewPanel();
  if (tableManagerOpen) renderTableManager();

  if (handStatus === "waitingDeal") {
    hideShowdownPanel();
    clearHandActions();
  } else if (handStatus === "settlementPreview") {
    hideShowdownPanel();
    clearHandActions();
  } else if (awaitingShowdown) {
    renderShowdownPanel();
  } else if (gameOver) {
    renderNextHandButton();
  } else if (handStatus === "playing") {
    renderCurrentActionPanel();
  } else {
    clearHandActions();
  }
}

function getRoomRef() {
  return room.roomId ? ref(db, "rooms/" + room.roomId) : null;
}

async function getRemoteGameState() {
  const roomRef = getRoomRef();
  if (!roomRef) return null;

  try {
    const snapshot = await get(roomRef);
    const data = snapshot.val();
    return data?.gameState || null;
  } catch (_) {
    return null;
  }
}

async function refreshFromRemote() {
  const roomRef = getRoomRef();
  if (!roomRef) return false;

  try {
    const snapshot = await get(roomRef);
    const data = snapshot.val();
    if (!data || !data.gameState) return false;
    syncReady = true;
    applyRoomData(data);
    return true;
  } catch (_) {
    syncReady = false;
    return false;
  }
}

async function isRemoteHandStill(expectedHandId, allowedStatuses) {
  const remoteGameState = await getRemoteGameState();
  if (!remoteGameState) return !room.roomId;

  const remoteHandId = toNonNegativeNumber(remoteGameState.handId, 0);
  const remoteStatus = String(remoteGameState.handStatus || inferHandStatus(remoteGameState));
  return remoteHandId === expectedHandId && allowedStatuses.includes(remoteStatus);
}

function setMutationInProgress(inProgress) {
  mutationInProgress = inProgress;
  refreshInteractiveControls();
}

// ----------------------
// Firebase 同步
// ----------------------
async function updateFirebaseState(options = {}) {
  if (!room.roomId) return true;
  if (batchingStateUpdate) return true;

  const {
    expectedHandId = null,
    allowedStatuses = null,
    expectedStateVersion = null
  } = options;
  const guardedWrite = expectedHandId !== null ||
    expectedStateVersion !== null ||
    Array.isArray(allowedStatuses);
  const nextStateVersion = stateVersion + 1;
  const nextGameState = {
    currentRound,
    pot,
    currentBet,
    lastRaiseSize,
    currentPlayerIndex,
    logs: room.gameState.logs,
    inProgress: room.gameState.inProgress,
    gameOver,
    awaitingShowdown,
    pendingPots,
    selectedWinnersByPot: serializeSelectedWinnersByPot(),
    pendingDealPrompt,
    settlementPreview,
    handId,
    handStatus,
    stateVersion: nextStateVersion,
    updatedBy: clientId
  };
  const nextRoomData = {
    operator: room.operator,
    gameState: nextGameState,
    players
  };

  syncWriteInProgress = true;
  setSyncStatus("同步中...");
  refreshInteractiveControls();

  try {
    if (guardedWrite) {
      const result = await runTransaction(getRoomRef(), (currentRoom) => {
        if (!currentRoom || !currentRoom.gameState) return undefined;

        const currentGameState = currentRoom.gameState;
        const currentHandId = toNonNegativeNumber(currentGameState.handId, 0);
        const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
        const currentStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0);
        if (expectedHandId !== null && currentHandId !== expectedHandId) return undefined;
        if (expectedStateVersion !== null && currentStateVersion !== expectedStateVersion) return undefined;
        if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(currentStatus)) return undefined;

        return {
          ...currentRoom,
          ...nextRoomData,
          operator: currentRoom.operator || nextRoomData.operator
        };
      }, { applyLocally: false });

      if (!result.committed) {
        const refreshed = await refreshFromRemote();
        if (!refreshed) syncReady = false;
        setSyncStatus("同步被其他设备抢先更新", "error");
        return false;
      }
    } else {
      await update(ref(db, "rooms/" + room.roomId), nextRoomData);
    }

    stateVersion = nextStateVersion;
    room.gameState = nextGameState;
    syncReady = true;
    setSyncStatus("已同步", "ok");
    return true;
  } catch (error) {
    const permissionDenied = String(error?.message || error).includes("permission");
    setSyncStatus(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
    const refreshed = await refreshFromRemote();
    if (!refreshed) syncReady = false;
    return false;
  } finally {
    syncWriteInProgress = false;
    refreshInteractiveControls();
  }
}

function appendLogMessage(message) {
  gameLog.appendChild(createParagraph(String(message)));
  gameLog.scrollTop = gameLog.scrollHeight;
}

function renderGameLog(logs) {
  gameLog.replaceChildren();
  logs.forEach(appendLogMessage);
  updateLogSummary();
}

function updateGameLog(message) {
  const safeMessage = String(message);
  room.gameState.logs.push(safeMessage);
  appendLogMessage(safeMessage);
  updateLogSummary();
}

function normalizeIncomingPlayer(player, index) {
  const chips = toNonNegativeNumber(player?.chips, 0);
  const allIn = Boolean(player?.allIn);
  return {
    id: String(player?.id || `player${index}`),
    name: String(player?.name || `玩家${index + 1}`),
    seatIndex: toNonNegativeNumber(player?.seatIndex, index),
    seatStatus: normalizeSeatStatus(player?.seatStatus, chips, allIn),
    chips,
    folded: Boolean(player?.folded),
    dealer: Boolean(player?.dealer),
    bet: toNonNegativeNumber(player?.bet, 0),
    totalBet: toNonNegativeNumber(player?.totalBet, 0),
    allIn,
    acted: Boolean(player?.acted),
    position: String(player?.position || "")
  };
}

function normalizeIncomingPots(pots) {
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

function serializeSelectedWinnersByPot() {
  return Object.fromEntries(Object.entries(selectedWinnersByPot).map(([potIndex, value]) => {
    const ids = value instanceof Set ? Array.from(value) : Array.isArray(value) ? value : [];
    return [potIndex, [...new Set(ids.map(String))]];
  }));
}

function normalizeSelectedWinnersByPot(value) {
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

function getDealPromptMeta(nextRound) {
  const prompts = {
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

  return prompts[nextRound] || {
    title: "请发下一张公共牌",
    cardText: "发公共牌",
    detail: "确认后继续牌局。"
  };
}

function createDealPrompt(nextRound) {
  const prompt = getDealPromptMeta(nextRound);
  return {
    id: `deal_${handId}_${nextRound}_${Date.now()}`,
    nextRound,
    ...prompt
  };
}

function normalizeIncomingDealPrompt(prompt) {
  if (!prompt || typeof prompt !== "object") return null;

  const nextRound = Number(prompt.nextRound);
  if (!Number.isInteger(nextRound) || nextRound <= 0 || nextRound >= rounds.length) {
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

function normalizeSettlementPreview(preview) {
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
    pots
  };
}

function applyRoomData(data) {
  const gameState = data.gameState;
  currentRound = toNonNegativeNumber(gameState.currentRound, 0);
  pot = toNonNegativeNumber(gameState.pot, 0);
  currentBet = toNonNegativeNumber(gameState.currentBet, 0);
  lastRaiseSize = toPositiveInteger(gameState.lastRaiseSize, bigBlind);
  currentPlayerIndex = Number.isInteger(gameState.currentPlayerIndex)
    ? gameState.currentPlayerIndex
    : -1;
  gameOver = Boolean(gameState.gameOver);
  awaitingShowdown = Boolean(gameState.awaitingShowdown);
  pendingPots = normalizeIncomingPots(gameState.pendingPots);
  selectedWinnersByPot = normalizeSelectedWinnersByPot(gameState.selectedWinnersByPot);
  pendingDealPrompt = normalizeIncomingDealPrompt(gameState.pendingDealPrompt);
  settlementPreview = normalizeSettlementPreview(gameState.settlementPreview);
  handId = toNonNegativeNumber(gameState.handId, handId);
  handStatus = String(gameState.handStatus || inferHandStatus(gameState));
  stateVersion = toNonNegativeNumber(gameState.stateVersion, stateVersion);
  room.operator = String(data.operator || room.operator || clientId);
  room.gameState.logs = Array.isArray(gameState.logs) ? gameState.logs.map(String) : [];
  room.gameState.inProgress = Boolean(gameState.inProgress);
  players = Array.isArray(data.players)
    ? data.players.map(normalizeIncomingPlayer)
    : players;

  renderGameLog(room.gameState.logs);
  updateGameInfo();
  updatePlayerBoxes();
  renderDealPromptPanel();
  renderSettlementPreviewPanel();

  if (handStatus === "waitingDeal") {
    hideShowdownPanel();
    clearHandActions();
  } else if (handStatus === "settlementPreview") {
    hideShowdownPanel();
    clearHandActions();
  } else if (awaitingShowdown) {
    renderShowdownPanel();
  } else {
    hideShowdownPanel();
  }

  if (gameOver && !awaitingShowdown) {
    renderNextHandButton();
  } else if (!gameOver && handStatus === "playing") {
    renderCurrentActionPanel();
  } else {
    clearHandActions();
  }

  if (gameState.inProgress === true) {
    setupContainer.style.display = "none";
    gameContainer.style.display = "grid";
    gameStarted = true;
  } else if (!gameStarted) {
    setupContainer.style.display = "block";
    gameContainer.style.display = "none";
  }
}

function listenFirebaseUpdates() {
  if (!room.roomId || listenedRoomId === room.roomId) return;

  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }

  const roomRef = ref(db, "rooms/" + room.roomId);
  listenedRoomId = room.roomId;
  syncReady = false;
  setSyncStatus("同步中...");
  unsubscribeRoom = onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.gameState) {
      syncReady = false;
      refreshInteractiveControls();
      return;
    }
    syncReady = true;
    applyRoomData(data);
    setSyncStatus("已同步", "ok");
  }, (error) => {
    syncReady = false;
    const permissionDenied = String(error?.message || error).includes("permission");
    setSyncStatus(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
    refreshInteractiveControls();
  });
}

function createRoom() {
  if (!room.roomId) {
    room.roomId = generateRoomId();
  }
  room.operator = clientId;
  handId = 0;
  handStatus = "setup";
  listenFirebaseUpdates();
}

function generateRoomId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  const bytes = new Uint8Array(4);
  if (crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    bytes.forEach(byte => {
      id += alphabet[byte % alphabet.length];
    });
    return id;
  }

  for (let index = 0; index < 4; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function joinRoom(roomId) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) return;

  room.roomId = normalizedRoomId;
  roomIdInput.value = normalizedRoomId;
  listenFirebaseUpdates();
}

function syncRoomFromInput() {
  const id = normalizeRoomId(roomIdInput.value);
  if (!id) return;
  joinRoom(id);
}

roomIdInput.addEventListener("blur", syncRoomFromInput);

if (manualSyncBtn) {
  manualSyncBtn.addEventListener("click", () => {
    const id = normalizeRoomId(roomIdInput.value);
    if (!id) {
      alert("请输入房间ID");
      return;
    }
    joinRoom(id);
  });
}

// ----------------------
// 添加玩家逻辑
// ----------------------
function updateSetupActionState() {
  startGameBtn.disabled = players.length < 2;
  addPlayerBtn.disabled = players.length >= MAX_PLAYERS;
  addPlayerBtn.textContent = players.length >= MAX_PLAYERS ? `最多 ${MAX_PLAYERS} 人` : "添加玩家";
}

addPlayerBtn.addEventListener("click", () => {
  if (players.length >= MAX_PLAYERS) {
    alert(`最多支持 ${MAX_PLAYERS} 名玩家`);
    updateSetupActionState();
    return;
  }

  const playerDiv = document.createElement("div");
  playerDiv.classList.add("player-div");

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = `输入玩家 ${players.length + 1} 昵称`;
  nameInput.classList.add("player-name-input");

  const chipsInput = document.createElement("input");
  chipsInput.type = "text";
  chipsInput.inputMode = "numeric";
  chipsInput.placeholder = "初始筹码";
  chipsInput.value = initialChipsInput.value;
  chipsInput.classList.add("player-chips-input");

  const player = {
    id: "player" + players.length,
    name: "",
    seatIndex: players.length,
    seatStatus: "seated",
    chips: toPositiveInteger(initialChipsInput.value, 1000),
    folded: false,
    dealer: false,
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: ""
  };

  const delBtn = createButton("删除", () => {
    playerDiv.remove();
    players = players.filter(item => item !== player);
    updateSetupActionState();
  }, false, "delete-player-button danger");

  playerDiv.appendChild(nameInput);
  playerDiv.appendChild(chipsInput);
  playerDiv.appendChild(delBtn);
  playerNameInputsContainer.appendChild(playerDiv);

  players.push(player);
  updateSetupActionState();
});
updateSetupActionState();

// ----------------------
// 开始游戏逻辑
// ----------------------
startGameBtn.addEventListener("click", async () => {
  if (mutationInProgress) return;
  setMutationInProgress(true);

  try {
    const roomId = normalizeRoomId(roomIdInput.value);
    if (roomId) {
      joinRoom(roomId);
      const remoteGameState = await getRemoteGameState();
      const remoteStatus = remoteGameState
        ? String(remoteGameState.handStatus || inferHandStatus(remoteGameState))
        : "setup";
      if (remoteGameState && remoteStatus !== "setup") {
        alert("该房间已有牌局状态，请等待同步完成，不要从本地设置页重新开始");
        return;
      }
    } else {
      createRoom();
      roomIdInput.value = room.roomId;
    }

    const nameInputs = document.querySelectorAll(".player-name-input");
    const chipsInputs = document.querySelectorAll(".player-chips-input");
    if (nameInputs.length < 2) {
      alert("至少需要两个玩家开始游戏");
      return;
    }
    if (nameInputs.length > MAX_PLAYERS) {
      alert(`最多支持 ${MAX_PLAYERS} 名玩家`);
      return;
    }

    bigBlind = toPositiveInteger(bigBlindInput.value, 20);
    smallBlind = Math.floor(bigBlind / 2);
    players = Array.from(nameInputs).map((input, index) => ({
      id: "player" + index,
      name: input.value.trim() || `玩家${index + 1}`,
      seatIndex: index,
      seatStatus: "seated",
      chips: toPositiveInteger(chipsInputs[index].value, 1000),
      folded: false,
      dealer: index === 0,
      bet: 0,
      totalBet: 0,
      allIn: false,
      acted: false,
      position: ""
    }));

    selectedWinnersByPot = {};
    pendingDealPrompt = null;
    settlementPreview = null;
    pendingPots = [];
    awaitingShowdown = false;
    handId += 1;
    handStatus = "playing";
    gameStarted = true;
    gameOver = false;
    currentRound = 0;
    currentBet = 0;
    lastRaiseSize = bigBlind;
    pot = 0;
    room.players = players;
    room.gameState.inProgress = true;
    clearGameLog();

    setupContainer.style.display = "none";
    gameContainer.style.display = "grid";
    clearHandActions();
    hideShowdownPanel();
    hideDealPromptPanel();
    hideSettlementPreviewPanel();
    startRound();
  } finally {
    setMutationInProgress(false);
  }
});

// ----------------------
// 开局与轮次逻辑
// ----------------------
function commitChips(player, requestedAmount) {
  const amount = Math.min(toNonNegativeNumber(requestedAmount, 0), player.chips);
  if (amount <= 0) return 0;

  player.chips -= amount;
  player.bet += amount;
  player.totalBet += amount;
  pot += amount;
  if (player.chips === 0) {
    player.allIn = true;
  }
  return amount;
}

function getEligibleOrderFrom(startIndex, eligibleIndices = getEligiblePlayerIndices()) {
  if (eligibleIndices.length === 0) return [];

  const firstIndex = getNextEligibleIndexFrom(startIndex, eligibleIndices);
  const ordered = [firstIndex];
  while (ordered.length < eligibleIndices.length) {
    ordered.push(getNextEligibleIndexAfter(ordered[ordered.length - 1], eligibleIndices));
  }
  return ordered;
}

function getHandLayout(dealerIndex, list = players) {
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

function setDealer(index) {
  players.forEach((player, playerIndex) => {
    player.dealer = playerIndex === index;
  });
}

function normalizeDealerForHand() {
  const eligibleIndices = getEligiblePlayerIndices();
  if (eligibleIndices.length === 0) {
    players.forEach(player => {
      player.dealer = false;
    });
    return -1;
  }

  const currentDealerIndex = players.findIndex(player => player.dealer);
  const dealerIndex = currentDealerIndex >= 0
    ? getNextEligibleIndexFrom(currentDealerIndex, eligibleIndices)
    : eligibleIndices[0];
  setDealer(dealerIndex);
  return dealerIndex;
}

function assignPositions(dealerIndex) {
  players.forEach(player => {
    player.position = getSeatStatusLabel(player.seatStatus);
  });

  const layout = getHandLayout(dealerIndex);
  if (layout.order.length === 0) return;

  if (layout.order.length === 1) {
    players[layout.dealerIndex].position = "等待对手";
    return;
  }

  layout.order.forEach((index, offset) => {
    if (layout.order.length === 2) {
      players[index].position = offset === 0 ? "Dealer / 小盲" : "大盲";
    } else if (offset === 0) {
      players[index].position = "Dealer";
    } else if (offset === 1) {
      players[index].position = "小盲";
    } else if (offset === 2) {
      players[index].position = "大盲";
    } else {
      players[index].position = "普通玩家";
    }
  });
}

function findNextActionableIndex(startIndex, includeStart = false) {
  if (players.length === 0) return -1;
  const firstOffset = includeStart ? 0 : 1;

  for (let offset = firstOffset; offset < players.length + firstOffset; offset += 1) {
    const index = (startIndex + offset + players.length) % players.length;
    if (canAct(players[index])) return index;
  }

  return -1;
}

function getMaxStreetBet() {
  return players.reduce((max, player) => Math.max(max, player.bet), 0);
}

function startRound() {
  currentBet = 0;
  lastRaiseSize = bigBlind;
  selectedWinnersByPot = {};
  pendingDealPrompt = null;
  settlementPreview = null;
  hideShowdownPanel();
  hideDealPromptPanel();
  hideSettlementPreviewPanel();

  if (currentRound === 0) {
    pot = 0;
    pendingPots = [];
    awaitingShowdown = false;
    players.forEach(player => {
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
    players.forEach(player => {
      player.bet = 0;
      player.acted = false;
    });
  }

  const eligibleIndices = getEligiblePlayerIndices();
  if (currentRound === 0 && eligibleIndices.length < 2) {
    currentPlayerIndex = -1;
    gameOver = true;
    handStatus = "settled";
    assignPositions(normalizeDealerForHand());
    updateGameInfo();
    updatePlayerBoxes();
    updateGameLog("至少需要 2 名已入座且有筹码的玩家才能开始下一局。");
    showNextHandButton();
    updateFirebaseState();
    return;
  }

  const dealerIndex = normalizeDealerForHand();
  const layout = getHandLayout(dealerIndex);
  assignPositions(dealerIndex);

  let firstToActIndex;
  if (currentRound === 0) {
    if (layout.order.length === 2) {
      commitChips(players[layout.smallBlindIndex], smallBlind);
      commitChips(players[layout.bigBlindIndex], bigBlind);
      firstToActIndex = layout.preflopFirstIndex;
    } else {
      commitChips(players[layout.smallBlindIndex], smallBlind);
      commitChips(players[layout.bigBlindIndex], bigBlind);
      firstToActIndex = layout.preflopFirstIndex;
    }
    currentBet = getMaxStreetBet();
  } else {
    firstToActIndex = layout.postflopFirstIndex;
  }

  currentPlayerIndex = findNextActionableIndex(firstToActIndex, true);
  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`进入 ${rounds[currentRound]} 轮，奖池：${pot}`);

  if (handleAutomaticHandEnd()) return;

  if (currentPlayerIndex === -1) {
    beginShowdown();
    return;
  }

  updateGameLog(`轮到 ${getPlayerName(players[currentPlayerIndex])} 行动`);
  updateFirebaseState();
}

// ----------------------
// playerAction：处理各操作（check/call/raise/fold）
// ----------------------
async function playerAction(action, index, amount = 0) {
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (mutationInProgress || gameOver || awaitingShowdown || handStatus !== "playing") {
    alert("当前手牌已结束或正在等待结算");
    return;
  }
  if (index !== currentPlayerIndex) {
    alert("当前不是你的回合！");
    return;
  }

  const player = players[index];
  if (!canAct(player)) {
    alert("该玩家当前不能行动");
    return;
  }

  if (action === "fold") {
    const confirmed = window.confirm(`${getPlayerName(player)} 确认弃牌？`);
    if (!confirmed) return;
  }

  setMutationInProgress(true);
  const remoteGameState = await getRemoteGameState();
  if (!remoteGameState && room.roomId) {
    setMutationInProgress(false);
    alert("还没有完成同步，不能操作");
    return;
  }
  if (remoteGameState) {
    const remoteHandId = toNonNegativeNumber(remoteGameState.handId, 0);
    const remoteStatus = String(remoteGameState.handStatus || inferHandStatus(remoteGameState));
    const remoteStateVersion = toNonNegativeNumber(remoteGameState.stateVersion, 0);
    const remoteCurrentPlayerIndex = Number.isInteger(remoteGameState.currentPlayerIndex)
      ? remoteGameState.currentPlayerIndex
      : -1;

    if (
      remoteHandId !== expectedHandId ||
      remoteStatus !== "playing" ||
      remoteStateVersion !== expectedStateVersion ||
      remoteCurrentPlayerIndex !== index
    ) {
      setMutationInProgress(false);
      alert("牌局状态已在其他设备更新，请等待同步后再操作");
      return;
    }
  }

  let logAction = action;
  batchingStateUpdate = true;

  switch (action) {
    case "check":
      if (player.bet < currentBet) {
        alert("已有下注，不能选择 Check！");
        batchingStateUpdate = false;
        setMutationInProgress(false);
        return;
      }
      player.acted = true;
      logAction = "Check";
      break;

    case "call": {
      const callAmount = Math.max(0, currentBet - player.bet);
      if (callAmount === 0) {
        alert("当前无需跟注，可以选择 Check");
        batchingStateUpdate = false;
        setMutationInProgress(false);
        return;
      }
      const committed = commitChips(player, callAmount);
      player.acted = true;
      logAction = committed < callAmount ? `All In 跟注 ${committed}` : `Call ${committed}`;
      break;
    }

    case "raise": {
      const targetBet = toPositiveInteger(amount, 0);
      const validation = getRaiseValidation(player, targetBet);
      if (!validation.valid) {
        alert(validation.message);
        batchingStateUpdate = false;
        setMutationInProgress(false);
        return;
      }

      const previousBet = currentBet;
      const committed = validation.commitAmount;
      commitChips(player, committed);
      player.acted = true;

      if (player.bet > previousBet) {
        const raiseSize = player.bet - previousBet;
        const isFullRaise = player.bet >= validation.minimumTarget;
        currentBet = player.bet;
        if (isFullRaise) {
          lastRaiseSize = raiseSize;
          players.forEach((otherPlayer, otherIndex) => {
            if (otherIndex !== index && !otherPlayer.folded && !otherPlayer.allIn) {
              otherPlayer.acted = false;
            }
          });
        }
        logAction = player.allIn
          ? `All In 加到 ${player.bet}${isFullRaise ? "" : "（未达到完整最小加注）"}`
          : `Raise 到 ${player.bet}`;
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
      alert("无效操作！");
      batchingStateUpdate = false;
      setMutationInProgress(false);
      return;
  }

  updateGameLog(`${getPlayerName(player)} 选择了 ${logAction}，奖池：${pot}`);
  nextPlayer();
  updateGameInfo();
  updatePlayerBoxes();
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["playing"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (!saved) {
    alert("操作没有同步成功，已恢复到最新远端状态");
  }
}

// ----------------------
// nextPlayer 与轮次结束逻辑
// ----------------------
function handleAutomaticHandEnd() {
  const active = getActivePlayers();
  if (active.length <= 1) {
    awardRemainingPot(active[0] || null);
    return true;
  }

  if (active.every(player => player.allIn)) {
    beginShowdown();
    return true;
  }

  const activeNotAllIn = active.filter(player => !player.allIn);
  const hasAllInPlayer = active.length !== activeNotAllIn.length;
  const obligationsSettled = activeNotAllIn.every(player => player.bet === currentBet);
  if (hasAllInPlayer && activeNotAllIn.length <= 1 && obligationsSettled) {
    beginShowdown();
    return true;
  }

  return false;
}

function isBettingRoundComplete() {
  const active = getActivePlayers();
  return active.length > 1 && active.every(player => {
    return player.allIn || (player.acted && player.bet === currentBet);
  });
}

function nextPlayer() {
  if (handleAutomaticHandEnd()) return;

  if (isBettingRoundComplete()) {
    if (currentRound === rounds.length - 1) {
      beginShowdown();
    } else {
      endRound();
    }
    return;
  }

  const nextIndex = findNextActionableIndex(currentPlayerIndex);
  if (nextIndex === -1) {
    if (currentRound === rounds.length - 1) {
      beginShowdown();
    } else {
      endRound();
    }
    return;
  }

  currentPlayerIndex = nextIndex;
  updateGameLog(`轮到 ${getPlayerName(players[currentPlayerIndex])} 行动`);
  updatePlayerBoxes();
  updateFirebaseState();
}

function endRound() {
  const nextRound = currentRound + 1;
  pendingDealPrompt = createDealPrompt(nextRound);
  handStatus = "waitingDeal";
  currentPlayerIndex = -1;
  updateGameLog(`${rounds[currentRound]} 下注结束，${pendingDealPrompt.cardText}后继续。`);
  updateGameInfo();
  updatePlayerBoxes();
  renderDealPromptPanel();
  clearHandActions();
}

async function confirmDealPrompt() {
  const prompt = pendingDealPrompt;
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (isSharedPromptActionLocked() || handStatus !== "waitingDeal" || !prompt) {
    alert("当前没有等待确认的发牌提示");
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;
  currentRound = prompt.nextRound;
  handStatus = "playing";
  pendingDealPrompt = null;
  startRound();
  batchingStateUpdate = false;

  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["waitingDeal"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (!saved) {
    alert("发牌确认没有同步成功，已恢复到最新远端状态");
  }
}

function awardRemainingPot(winner) {
  const wonAmount = pot;
  if (winner) {
    winner.chips += wonAmount;
  }

  pot = 0;
  currentBet = 0;
  lastRaiseSize = bigBlind;
  currentPlayerIndex = -1;
  awaitingShowdown = false;
  pendingPots = [];
  selectedWinnersByPot = {};
  pendingDealPrompt = null;
  settlementPreview = null;
  const bustedNames = markZeroChipPlayersBusted();
  gameOver = true;
  handStatus = "settled";

  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`${winner ? getPlayerName(winner) : "无人"} 赢得奖池 ${wonAmount}`);
  if (bustedNames.length > 0) {
    updateGameLog(`${bustedNames.join("、")} 筹码归零，已设为待补码，下一手将跳过。`);
  }
  hideDealPromptPanel();
  hideSettlementPreviewPanel();
  showNextHandButton();
  updateFirebaseState();
}

// ----------------------
// 摊牌与边池结算
// ----------------------
function buildSidePots() {
  const activeCommittedPlayers = getActivePlayers()
    .filter(player => player.totalBet > 0)
    .sort((a, b) => a.totalBet - b.totalBet);

  const levels = [...new Set(activeCommittedPlayers.map(player => player.totalBet))];
  const sidePots = [];
  let previousLevel = 0;

  levels.forEach(level => {
    const participants = players.filter(player => player.totalBet > previousLevel);
    const amount = participants.reduce((sum, player) => {
      return sum + Math.max(0, Math.min(player.totalBet, level) - previousLevel);
    }, 0);
    const contenders = activeCommittedPlayers
      .filter(player => player.totalBet >= level)
      .map(player => player.id);

    if (amount > 0 && contenders.length > 0) {
      sidePots.push({
        amount,
        participants: participants.map(player => player.id),
        contenders
      });
    }
    previousLevel = level;
  });

  if (sidePots.length === 0 && pot > 0) {
    const activeIds = getActivePlayers().map(player => player.id);
    sidePots.push({
      amount: pot,
      participants: activeIds,
      contenders: activeIds
    });
  }

  const calculatedTotal = sidePots.reduce((sum, sidePot) => sum + sidePot.amount, 0);
  if (sidePots.length > 0 && calculatedTotal !== pot) {
    sidePots[sidePots.length - 1].amount += pot - calculatedTotal;
  }

  return mergeEquivalentSidePots(sidePots);
}

function mergeEquivalentSidePots(sidePots) {
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

function haveSameContenders(leftPot, rightPot) {
  if (leftPot.contenders.length !== rightPot.contenders.length) return false;

  const rightIds = new Set(rightPot.contenders);
  return leftPot.contenders.every(id => rightIds.has(id));
}

function beginShowdown() {
  if (awaitingShowdown) return;

  awaitingShowdown = true;
  gameOver = true;
  handStatus = "showdown";
  currentPlayerIndex = -1;
  pendingPots = buildSidePots();
  selectedWinnersByPot = {};
  pendingDealPrompt = null;
  settlementPreview = null;

  pendingPots.forEach((sidePot, index) => {
    if (sidePot.contenders.length === 1) {
      selectedWinnersByPot[index] = new Set(sidePot.contenders);
    }
  });

  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog("下注结束，请开牌，并在牌桌中央为每个奖池选择赢家后确认结算。");
  hideDealPromptPanel();
  hideSettlementPreviewPanel();
  clearHandActions();
  renderShowdownPanel();
  updateFirebaseState();
}

function hideShowdownPanel() {
  showdownPanel.hidden = true;
  showdownPanel.replaceChildren();
}

function hideDealPromptPanel() {
  if (!dealPromptPanel) return;
  dealPromptPanel.hidden = true;
  dealPromptPanel.replaceChildren();
}

function renderDealPromptPanel() {
  if (!dealPromptPanel) return;
  hideDealPromptPanel();
}

function hideSettlementPreviewPanel() {
  if (!settlementPreviewPanel) return;
  settlementPreviewPanel.hidden = true;
  settlementPreviewPanel.replaceChildren();
}

function renderSettlementPreviewPanel() {
  if (!settlementPreviewPanel) return;
  hideSettlementPreviewPanel();
}

function renderShowdownPanel() {
  hideShowdownPanel();
}

function toggleWinner(potIndex, playerId) {
  if (isInteractionLocked() || handStatus !== "showdown") return;

  const selected = selectedWinnersByPot[potIndex] || new Set();
  if (selected.has(playerId)) {
    selected.delete(playerId);
  } else {
    selected.add(playerId);
  }
  selectedWinnersByPot[potIndex] = selected;
  renderShowdownPanel();
}

function calculatePayouts(sidePot, winnerIds) {
  const baseShare = Math.floor(sidePot.amount / winnerIds.length);
  let remainder = sidePot.amount % winnerIds.length;

  return winnerIds.map(playerId => {
    const extraChip = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    return {
      playerId,
      amount: baseShare + extraChip
    };
  });
}

function buildSettlementPlan() {
  const settlementPlan = [];

  for (let index = 0; index < pendingPots.length; index += 1) {
    const sidePot = pendingPots[index];
    const contenders = sidePot.contenders.filter(id => {
      const player = getPlayerById(id);
      return player && !player.folded;
    });
    const selected = Array.from(selectedWinnersByPot[index] || [])
      .filter(id => contenders.includes(id));
    const winnerIds = contenders.length === 1 ? contenders : selected;

    if (winnerIds.length === 0) {
      alert(`请为奖池 ${index + 1} 至少选择一位赢家`);
      return null;
    }

    settlementPlan.push({
      potIndex: index,
      sidePot,
      winnerIds,
      payouts: calculatePayouts(sidePot, winnerIds)
    });
  }

  return settlementPlan;
}

function createSettlementPreview(settlementPlan) {
  return {
    id: `settlement_${handId}_${Date.now()}`,
    total: settlementPlan.reduce((sum, item) => sum + item.sidePot.amount, 0),
    winnersByPot: Object.fromEntries(settlementPlan.map(item => [item.potIndex, item.winnerIds])),
    pots: settlementPlan.map(item => ({
      index: item.potIndex,
      amount: item.sidePot.amount,
      winnerIds: item.winnerIds,
      payouts: item.payouts
    }))
  };
}

function getSettlementReportLines(preview) {
  const lines = [];
  preview.pots.forEach(previewPot => {
    lines.push(`奖池 ${previewPot.index + 1}（${previewPot.amount}）:`);
    previewPot.payouts.forEach(payout => {
      const winner = getPlayerById(payout.playerId);
      lines.push(`${getPlayerName(winner)} 获得 ${payout.amount} 筹码`);
    });
  });
  return lines;
}

function applySettlementPreviewPayouts(preview) {
  preview.pots.forEach(previewPot => {
    previewPot.payouts.forEach(payout => {
      const winner = getPlayerById(payout.playerId);
      if (winner) {
        winner.chips += payout.amount;
      }
    });
  });
}

function markZeroChipPlayersBusted() {
  const bustedNames = [];
  players.forEach(player => {
    if (player.chips <= 0 && player.seatStatus === "seated") {
      player.chips = 0;
      player.seatStatus = "busted";
      bustedNames.push(getPlayerName(player));
    }
  });
  return bustedNames;
}

async function confirmShowdown() {
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;
  if (isInteractionLocked() || handStatus !== "showdown") {
    alert("当前手牌已不在摊牌结算阶段");
    return;
  }

  const settlementPlan = buildSettlementPlan();
  if (!settlementPlan) return;

  setMutationInProgress(true);
  const canSettle = await isRemoteHandStill(expectedHandId, ["showdown"]);
  if (!canSettle) {
    setMutationInProgress(false);
    alert("其他设备已经更新结算状态，请等待同步最新状态");
    return;
  }

  batchingStateUpdate = true;
  settlementPreview = createSettlementPreview(settlementPlan);
  selectedWinnersByPot = normalizeSelectedWinnersByPot(settlementPreview.winnersByPot);
  handStatus = "settlementPreview";
  awaitingShowdown = true;
  gameOver = true;
  currentPlayerIndex = -1;

  hideShowdownPanel();
  renderSettlementPreviewPanel();
  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog("已生成结算预览，请确认或取消。");
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["showdown"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (!saved) {
    alert("结算预览没有同步成功，已恢复到最新远端状态");
  }
}

async function cancelSettlementPreview() {
  const preview = settlementPreview;
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (isSharedPromptActionLocked() || handStatus !== "settlementPreview" || !preview) {
    alert("当前没有可取消的结算预览");
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;
  selectedWinnersByPot = normalizeSelectedWinnersByPot(preview.winnersByPot);
  settlementPreview = null;
  awaitingShowdown = true;
  gameOver = true;
  handStatus = "showdown";
  currentPlayerIndex = -1;

  hideSettlementPreviewPanel();
  renderShowdownPanel();
  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog("结算预览已取消，请重新选择赢家。");
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["settlementPreview"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (!saved) {
    alert("取消结算预览没有同步成功，已恢复到最新远端状态");
  }
}

async function confirmSettlementPreview() {
  const preview = settlementPreview;
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (isSharedPromptActionLocked() || handStatus !== "settlementPreview" || !preview) {
    alert("当前没有可确认的结算预览");
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;
  const reportLines = getSettlementReportLines(preview);
  applySettlementPreviewPayouts(preview);

  pot = 0;
  currentBet = 0;
  lastRaiseSize = bigBlind;
  currentPlayerIndex = -1;
  awaitingShowdown = false;
  pendingPots = [];
  selectedWinnersByPot = {};
  pendingDealPrompt = null;
  settlementPreview = null;
  const bustedNames = markZeroChipPlayersBusted();
  gameOver = true;
  handStatus = "settled";

  hideShowdownPanel();
  hideSettlementPreviewPanel();
  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`游戏结束，筹码分配：\n${reportLines.join("\n")}`);
  if (bustedNames.length > 0) {
    updateGameLog(`${bustedNames.join("、")} 筹码归零，已设为待补码，下一手将跳过。`);
  }
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["settlementPreview"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (saved) {
    showNextHandButton();
  } else {
    alert("结算没有同步成功，已恢复到最新远端状态");
  }
}

// ----------------------
// 牌桌管理
// ----------------------
if (tableManagerBackdrop) {
  tableManagerBackdrop.addEventListener("click", (event) => {
    if (event.target === tableManagerBackdrop) {
      closeTableManager();
    }
  });
}

document.addEventListener("click", (event) => {
  if (!event.target.closest?.(".player-box")) {
    closeSeatDetailPopovers();
  }
});

function closeTableActionDialog() {
  document.querySelectorAll(".table-action-dialog-backdrop").forEach(dialog => dialog.remove());
}

function openTableActionDialog({ title, description = "", className = "", buildContent }) {
  closeTableActionDialog();

  const backdrop = document.createElement("div");
  backdrop.className = className
    ? `table-action-dialog-backdrop ${className}`
    : "table-action-dialog-backdrop";
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeTableActionDialog();
  });

  const panel = document.createElement("section");
  panel.className = "table-action-dialog";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.addEventListener("click", event => event.stopPropagation());

  const header = document.createElement("div");
  header.className = "table-action-dialog-header";

  const copy = document.createElement("div");
  const heading = document.createElement("h3");
  heading.textContent = title;
  copy.appendChild(heading);
  if (description) {
    copy.appendChild(createParagraph(description));
  }
  header.appendChild(copy);

  const closeButton = createButton("×", closeTableActionDialog, false, "table-action-dialog-close");
  closeButton.setAttribute("aria-label", "关闭浮窗");
  header.appendChild(closeButton);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "table-action-dialog-body";
  buildContent(body, closeTableActionDialog);
  panel.appendChild(body);

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
}

function createTableDraft() {
  return players.map((player, index) => ({
    id: String(player.id || `player${index}`),
    name: getPlayerName(player),
    seatIndex: index,
    seatStatus: normalizeSeatStatus(player.seatStatus, player.chips, false),
    chips: toNonNegativeNumber(player.chips, 0),
    dealer: Boolean(player.dealer)
  }));
}

function getNextPlayerIdFromDraft() {
  const usedIds = new Set(tableDraft.map(player => player.id));
  let index = players.length + tableDraft.length;
  let id = `player${index}`;
  while (usedIds.has(id)) {
    index += 1;
    id = `player${index}`;
  }
  return id;
}

function normalizeDraftPlayer(draftPlayer, index) {
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
    name: String(draftPlayer?.name || `玩家${index + 1}`).trim() || `玩家${index + 1}`,
    seatIndex: index,
    seatStatus,
    chips,
    folded: !isEligibleForNextHand({ seatStatus, chips }),
    dealer: Boolean(draftPlayer?.dealer),
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: getSeatStatusLabel(seatStatus)
  };
}

function normalizeTableDraftPlayers() {
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

function getPreviewDealerIndex(list = tableDraft) {
  const eligibleIndices = getEligiblePlayerIndices(list);
  if (eligibleIndices.length === 0) return -1;

  const currentDealerIndex = list.findIndex(player => player.dealer);
  if (currentDealerIndex === -1) return eligibleIndices[0];
  return getNextEligibleIndexAfter(currentDealerIndex, eligibleIndices);
}

function getTableDraftSummary() {
  const normalized = tableDraft.map(normalizeDraftPlayer);
  const eligibleIndices = getEligiblePlayerIndices(normalized);
  const sittingOutCount = normalized.filter(player => player.seatStatus === "sittingOut").length;
  const bustedCount = normalized.filter(player => player.seatStatus === "busted").length;
  const leftCount = normalized.filter(player => player.seatStatus === "left").length;

  if (eligibleIndices.length < 2) {
    return `下一手可参与 ${eligibleIndices.length} 人 · 至少需要 2 名已入座且有筹码的玩家`;
  }

  const dealerIndex = getPreviewDealerIndex(normalized);
  const layout = getHandLayout(dealerIndex, normalized);
  const detail = [
    `下一手可参与 ${eligibleIndices.length} 人`,
    `Button ${getPlayerName(normalized[layout.dealerIndex])}`,
    `小盲 ${getPlayerName(normalized[layout.smallBlindIndex])}`,
    `大盲 ${getPlayerName(normalized[layout.bigBlindIndex])}`
  ];

  const pending = [];
  if (bustedCount > 0) pending.push(`${bustedCount} 人待补码`);
  if (sittingOutCount > 0) pending.push(`${sittingOutCount} 人坐出`);
  if (leftCount > 0) pending.push(`${leftCount} 人离桌`);
  if (pending.length > 0) detail.push(pending.join("，"));
  return detail.join(" · ");
}

function openTableManager() {
  if (handStatus !== "settled") {
    alert("牌桌管理只在本手结算完成后开放，避免影响正在进行的牌局。");
    return;
  }

  tableDraft = createTableDraft();
  tableDraftBaseHandId = handId;
  tableDraftBaseStateVersion = stateVersion;
  tableManagerOpen = true;
  renderTableManager();
}

function closeTableManager() {
  tableManagerOpen = false;
  tableDraft = null;
  tableDraftBaseHandId = null;
  tableDraftBaseStateVersion = null;
  if (tableManagerBackdrop) tableManagerBackdrop.hidden = true;
  if (tableManagerPanel) tableManagerPanel.replaceChildren();
}

function renderTableManager() {
  if (!tableManagerBackdrop || !tableManagerPanel || !tableManagerOpen || !tableDraft) return;

  tableManagerBackdrop.hidden = false;
  tableManagerPanel.replaceChildren();

  const header = document.createElement("div");
  header.className = "table-manager-header";

  const copy = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "prompt-eyebrow";
  eyebrow.textContent = "下一手牌桌预设";
  copy.appendChild(eyebrow);

  const title = document.createElement("h3");
  title.id = "table-manager-title";
  title.textContent = "牌桌管理";
  copy.appendChild(title);
  copy.appendChild(createParagraph("调整座次、筹码和离桌/回桌状态；保存后只影响下一手。"));
  header.appendChild(copy);

  const closeButton = createButton("×", closeTableManager, false, "table-manager-close");
  closeButton.setAttribute("aria-label", "关闭牌桌管理");
  header.appendChild(closeButton);
  tableManagerPanel.appendChild(header);

  const summary = document.createElement("div");
  summary.className = "table-manager-summary";
  summary.textContent = getTableDraftSummary();
  tableManagerPanel.appendChild(summary);

  const rows = document.createElement("div");
  rows.className = "table-manager-rows";
  tableDraft.forEach((draftPlayer, index) => {
    rows.appendChild(createTableManagerRow(draftPlayer, index));
  });
  tableManagerPanel.appendChild(rows);

  const addButton = createButton("添加玩家", () => {
    if (tableDraft.length >= MAX_PLAYERS) {
      alert(`最多支持 ${MAX_PLAYERS} 名玩家`);
      renderTableManager();
      return;
    }

    const id = getNextPlayerIdFromDraft();
    tableDraft.push({
      id,
      name: `玩家${tableDraft.length + 1}`,
      seatIndex: tableDraft.length,
      seatStatus: "seated",
      chips: toPositiveInteger(initialChipsInput.value, 1000),
      dealer: false
    });
    renderTableManager();
  }, isSharedPromptActionLocked() || tableDraft.length >= MAX_PLAYERS, "prompt-secondary");
  if (tableDraft.length >= MAX_PLAYERS) {
    addButton.textContent = `最多 ${MAX_PLAYERS} 人`;
  }

  const footer = document.createElement("div");
  footer.className = "table-manager-footer";
  footer.appendChild(addButton);

  const actionGroup = document.createElement("div");
  actionGroup.className = "table-manager-save-actions";
  actionGroup.appendChild(createButton("取消", closeTableManager, false, "prompt-secondary"));
  actionGroup.appendChild(createButton("保存牌桌", () => saveTableDraft({ startNextHand: false }), isSharedPromptActionLocked(), "prompt-secondary"));
  actionGroup.appendChild(createButton("保存并开始下一局", () => saveTableDraft({ startNextHand: true }), isSharedPromptActionLocked() || getEligiblePlayerIndices(tableDraft.map(normalizeDraftPlayer)).length < 2, "prompt-primary"));
  footer.appendChild(actionGroup);
  tableManagerPanel.appendChild(footer);
}

function createTableManagerRow(draftPlayer, index) {
  const row = document.createElement("div");
  row.className = "table-manager-row";
  if (!isEligibleForNextHand(normalizeDraftPlayer(draftPlayer, index))) {
    row.classList.add("is-inactive");
  }

  const seat = document.createElement("div");
  seat.className = "table-seat-cell";
  const seatLabel = document.createElement("strong");
  seatLabel.textContent = `座位 ${index + 1}`;
  seat.appendChild(seatLabel);
  const moveActions = document.createElement("div");
  moveActions.className = "table-seat-actions";
  moveActions.appendChild(createButton("↑", () => moveDraftPlayer(index, -1), index === 0, "table-icon-button"));
  moveActions.appendChild(createButton("↓", () => moveDraftPlayer(index, 1), index === tableDraft.length - 1, "table-icon-button"));
  seat.appendChild(moveActions);
  row.appendChild(seat);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = draftPlayer.name;
  nameInput.setAttribute("aria-label", `座位 ${index + 1} 玩家名`);
  nameInput.addEventListener("input", () => {
    tableDraft[index].name = nameInput.value;
  });
  row.appendChild(nameInput);

  const chipsCell = document.createElement("div");
  chipsCell.className = "table-chip-cell";
  const chipsInput = document.createElement("input");
  chipsInput.type = "number";
  chipsInput.inputMode = "numeric";
  chipsInput.min = "0";
  chipsInput.step = "10";
  chipsInput.value = String(draftPlayer.chips);
  chipsInput.setAttribute("aria-label", `${getPlayerName(draftPlayer)} 筹码`);
  chipsInput.addEventListener("change", () => {
    setDraftChips(index, chipsInput.value);
  });
  chipsCell.appendChild(chipsInput);

  const chipActions = document.createElement("div");
  chipActions.className = "table-chip-actions";
  chipActions.appendChild(createButton("-100", () => adjustDraftChips(index, -100), draftPlayer.chips <= 0, "table-chip-button"));
  chipActions.appendChild(createButton("+100", () => adjustDraftChips(index, 100), false, "table-chip-button"));
  chipActions.appendChild(createButton("+500", () => adjustDraftChips(index, 500), false, "table-chip-button"));
  chipActions.appendChild(createButton("+1000", () => adjustDraftChips(index, 1000), false, "table-chip-button"));
  chipsCell.appendChild(chipActions);
  row.appendChild(chipsCell);

  const statusCell = document.createElement("div");
  statusCell.className = "table-status-cell";
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", `${getPlayerName(draftPlayer)} 状态`);
  Object.entries(SEAT_STATUS_LABELS).forEach(([status, label]) => {
    const option = document.createElement("option");
    option.value = status;
    option.textContent = label;
    option.selected = draftPlayer.seatStatus === status;
    statusSelect.appendChild(option);
  });
  statusSelect.addEventListener("change", () => {
    setDraftStatus(index, statusSelect.value);
  });
  statusCell.appendChild(statusSelect);

  const quickActions = document.createElement("div");
  quickActions.className = "table-status-actions";
  if (draftPlayer.seatStatus === "seated") {
    quickActions.appendChild(createButton("坐出", () => setDraftStatus(index, "sittingOut"), false, "table-chip-button"));
    quickActions.appendChild(createButton("离桌", () => setDraftStatus(index, "left"), false, "table-chip-button table-danger-button"));
  } else {
    quickActions.appendChild(createButton("回桌", () => {
      if (tableDraft[index].chips <= 0) {
        tableDraft[index].chips = toPositiveInteger(initialChipsInput.value, 1000);
      }
      setDraftStatus(index, "seated");
    }, false, "table-chip-button"));
  }
  statusCell.appendChild(quickActions);
  row.appendChild(statusCell);

  return row;
}

function moveDraftPlayer(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= tableDraft.length) return;
  const [player] = tableDraft.splice(index, 1);
  tableDraft.splice(nextIndex, 0, player);
  renderTableManager();
}

function adjustDraftChips(index, delta) {
  const draftPlayer = tableDraft[index];
  draftPlayer.chips = Math.max(0, toNonNegativeNumber(draftPlayer.chips, 0) + delta);
  if (draftPlayer.chips <= 0 && draftPlayer.seatStatus === "seated") {
    draftPlayer.seatStatus = "busted";
  } else if (draftPlayer.chips > 0 && draftPlayer.seatStatus === "busted") {
    draftPlayer.seatStatus = "seated";
  }
  renderTableManager();
}

function setDraftChips(index, value) {
  tableDraft[index].chips = toNonNegativeNumber(value, 0);
  adjustDraftChips(index, 0);
}

function setDraftStatus(index, status) {
  if (status === "seated" && tableDraft[index].chips <= 0) {
    tableDraft[index].chips = toPositiveInteger(initialChipsInput.value, 1000);
  } else if (status === "busted") {
    tableDraft[index].chips = 0;
  }
  tableDraft[index].seatStatus = normalizeSeatStatus(status, tableDraft[index].chips, false);
  renderTableManager();
}

async function saveTableDraft({ startNextHand = false } = {}) {
  if (!tableDraft || handStatus !== "settled") {
    alert("当前不能保存牌桌管理设置");
    return;
  }

  const nextPlayers = normalizeTableDraftPlayers();
  if (nextPlayers.length > MAX_PLAYERS) {
    alert(`最多支持 ${MAX_PLAYERS} 名玩家`);
    renderTableManager();
    return;
  }

  if (startNextHand && getEligiblePlayerIndices(nextPlayers).length < 2) {
    alert("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
    renderTableManager();
    return;
  }

  const expectedHandId = tableDraftBaseHandId;
  const expectedStateVersion = tableDraftBaseStateVersion;
  if (expectedHandId !== handId || expectedStateVersion !== stateVersion) {
    alert("牌桌已被其他设备更新，请关闭后重新打开牌桌管理。");
    closeTableManager();
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;

  players = nextPlayers;
  room.players = players;
  players.forEach(player => {
    player.position = getSeatStatusLabel(player.seatStatus);
  });
  updatePlayerBoxes();
  updateGameLog(`牌桌已更新：${getTableDraftSummary()}`);

  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["settled"],
    expectedStateVersion
  });
  setMutationInProgress(false);

  if (!saved) {
    alert("牌桌管理没有保存成功，已恢复到最新远端状态");
    return;
  }

  closeTableManager();
  if (startNextHand) {
    await resetHand(expectedHandId);
  }
}

// ----------------------
// 下一局
// ----------------------
async function resetHand(expectedHandId = handId) {
  const expectedStateVersion = stateVersion;
  if (mutationInProgress) return;
  if (!gameOver || handStatus !== "settled") {
    alert("当前手牌还没有完成结算，不能开始下一局");
    return;
  }
  if (getEligiblePlayerIndices().length < 2) {
    alert("至少需要 2 名已入座且有筹码的玩家才能开始下一局，请先打开牌桌管理补码或回桌。");
    renderNextHandButton();
    return;
  }

  setMutationInProgress(true);
  const canReset = await isRemoteHandStill(expectedHandId, ["settled"]);
  if (!canReset) {
    setMutationInProgress(false);
    clearHandActions();
    alert("其他设备已经开始了下一局，请等待同步最新状态");
    return;
  }

  batchingStateUpdate = true;
  currentRound = 0;
  currentBet = 0;
  lastRaiseSize = bigBlind;
  pot = 0;
  currentPlayerIndex = -1;
  pendingPots = [];
  selectedWinnersByPot = {};
  pendingDealPrompt = null;
  settlementPreview = null;
  awaitingShowdown = false;
  gameOver = false;
  handId = expectedHandId + 1;
  handStatus = "playing";

  players.forEach(player => {
    player.bet = 0;
    player.totalBet = 0;
    player.folded = false;
    player.acted = false;
    player.allIn = false;
  });

  if (!rotateDealer()) {
    batchingStateUpdate = false;
    setMutationInProgress(false);
    alert("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
    renderNextHandButton();
    return;
  }
  clearGameLog();
  clearHandActions();
  hideShowdownPanel();
  hideDealPromptPanel();
  hideSettlementPreviewPanel();
  room.gameState.inProgress = true;
  startRound();
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["settled"],
    expectedStateVersion
  });
  setMutationInProgress(false);
  if (!saved) {
    alert("下一局没有同步成功，已恢复到最新远端状态");
  }
}

function rotateDealer() {
  const eligibleIndices = getEligiblePlayerIndices();
  if (eligibleIndices.length < 2) return false;

  let dealerIndex = players.findIndex(player => player.dealer);
  if (dealerIndex === -1) dealerIndex = eligibleIndices[eligibleIndices.length - 1];

  const nextIndex = getNextEligibleIndexAfter(dealerIndex, eligibleIndices);
  setDealer(nextIndex);
  return true;
}

function renderNextHandButton() {
  if (!handActions) return;
  clearHandActions();
}

function clearHandActions() {
  if (!handActions) return;
  handActions.replaceChildren();
  handActions.classList.remove("is-current-action");
  handActions.hidden = true;
}

function showNextHandButton() {
  renderNextHandButton();
  updatePlayerBoxes();
}

function inferHandStatus(gameState) {
  if (gameState.pendingDealPrompt) return "waitingDeal";
  if (gameState.settlementPreview) return "settlementPreview";
  if (gameState.awaitingShowdown) return "showdown";
  if (gameState.gameOver) return "settled";
  if (gameState.inProgress) return "playing";
  return "setup";
}

// ----------------------
// UI 更新
// ----------------------
function getRoundDisplayText() {
  let roundText = `当前轮次: ${rounds[currentRound] || "-"}`;
  if (handStatus === "waitingDeal" && pendingDealPrompt) {
    roundText = `等待发牌: ${pendingDealPrompt.cardText}`;
  } else if (handStatus === "settlementPreview") {
    roundText = "等待结算确认";
  } else if (handStatus === "showdown") {
    roundText = "摊牌结算";
  }
  return roundText;
}

function updateGameInfo() {
  const roundEl = document.getElementById("current-round");
  const potEl = document.getElementById("pot-amount");
  roundEl.textContent = getRoundDisplayText();
  potEl.textContent = `奖池: ${pot}`;
}

function createRaisePanel(player, index, actionDisabled) {
  const raiseDisabled = actionDisabled || !canPlayerRaise(player);
  const callAmount = getCallAmount(player);
  const minimumTarget = getMinimumRaiseTarget(player);
  const maximumTarget = getMaximumRaiseTarget(player);

  return {
    open() {
      openTableActionDialog({
        title: `${getPlayerName(player)} 加注`,
        description: `需跟 ${callAmount}，最小加到 ${minimumTarget}，当前奖池 ${pot}。`,
        className: "raise-action-dialog",
        buildContent(body, closeDialog) {
          const panel = document.createElement("div");
          panel.className = "raise-panel";

          const info = document.createElement("div");
          info.className = "raise-panel-info";
          [
            `需跟 ${callAmount}`,
            `最小加到 ${minimumTarget}`,
            `奖池 ${pot}`
          ].forEach(text => {
            const item = document.createElement("span");
            item.textContent = text;
            info.appendChild(item);
          });
          panel.appendChild(info);

          const presetGrid = document.createElement("div");
          presetGrid.className = "raise-preset-grid";
          [
            ["最小", () => getDefaultRaiseTarget(player)],
            ["1/2池", () => getPotSizedRaiseTarget(player, 0.5)],
            ["2/3池", () => getPotSizedRaiseTarget(player, 2 / 3)],
            ["一池", () => getPotSizedRaiseTarget(player, 1)],
            ["All In", () => maximumTarget]
          ].forEach(([label, getTarget]) => {
            const target = getTarget();
            presetGrid.appendChild(createButton(`${label} ${target}`, () => {
              setTarget(target);
            }, raiseDisabled || target <= 0, "raise-preset-button"));
          });
          panel.appendChild(presetGrid);

          const inputRow = document.createElement("div");
          inputRow.className = "raise-input-row";

          const inputWrap = document.createElement("label");
          inputWrap.className = "raise-target-field";
          const inputLabel = document.createElement("span");
          inputLabel.textContent = "加到";
          const raiseInput = document.createElement("input");
          raiseInput.type = "number";
          raiseInput.inputMode = "numeric";
          raiseInput.min = "0";
          raiseInput.step = String(getChipStep());
          raiseInput.value = String(getDefaultRaiseTarget(player));
          inputWrap.appendChild(inputLabel);
          inputWrap.appendChild(raiseInput);
          inputRow.appendChild(inputWrap);

          const nudgeGrid = document.createElement("div");
          nudgeGrid.className = "raise-nudge-grid";
          const step = getChipStep();
          [
            [`-${bigBlind}`, -bigBlind],
            [`-${step}`, -step],
            [`+${step}`, step],
            [`+${bigBlind}`, bigBlind]
          ].forEach(([label, delta]) => {
            nudgeGrid.appendChild(createButton(label, () => {
              setTarget(toPositiveInteger(raiseInput.value, 0) + delta);
            }, raiseDisabled, "raise-nudge-button"));
          });
          inputRow.appendChild(nudgeGrid);
          panel.appendChild(inputRow);

          const preview = document.createElement("div");
          preview.className = "raise-preview";
          const previewTarget = document.createElement("span");
          const previewCommit = document.createElement("span");
          const previewMessage = document.createElement("em");
          preview.appendChild(previewTarget);
          preview.appendChild(previewCommit);
          preview.appendChild(previewMessage);
          panel.appendChild(preview);

          const confirmButton = createButton("确认 Raise", () => {
            closeDialog();
            playerAction("raise", index, raiseInput.value);
          }, raiseDisabled, "action-btn action-confirm raise-confirm-button");
          panel.appendChild(confirmButton);

          function setTarget(value) {
            const nextValue = Math.max(0, Math.min(toPositiveInteger(value, 0), maximumTarget));
            raiseInput.value = String(nextValue);
            updatePreview();
          }

          function updatePreview() {
            const validation = getRaiseValidation(player, raiseInput.value);
            previewTarget.textContent = `加到 ${validation.targetBet || 0}`;
            previewCommit.textContent = `本次投入 ${validation.commitAmount || 0}`;
            previewMessage.textContent = validation.message;
            preview.classList.toggle("is-invalid", !validation.valid);
            confirmButton.textContent = validation.valid
              ? `确认加到 ${validation.targetBet}`
              : "确认 Raise";
            confirmButton.disabled = raiseDisabled || !validation.valid;
          }

          raiseInput.addEventListener("input", updatePreview);
          updatePreview();
          body.appendChild(panel);
          requestAnimationFrame(() => raiseInput.focus());
        }
      });
    }
  };
}

function shouldShowCurrentActionPanel() {
  return !gameOver &&
    !awaitingShowdown &&
    handStatus === "playing" &&
    currentPlayerIndex >= 0 &&
    canAct(players[currentPlayerIndex]);
}

function createActionControls(player, index, actionDisabled, className = "") {
  const actions = document.createElement("div");
  actions.className = className ? `actions ${className}` : "actions";

  actions.appendChild(createButton("Check", () => playerAction("check", index), actionDisabled || player.bet < currentBet, "action-btn action-check"));
  actions.appendChild(createButton(getCallButtonLabel(player), () => playerAction("call", index), actionDisabled || player.bet >= currentBet, "action-btn action-call"));

  const raiseWidget = createRaisePanel(player, index, actionDisabled);
  actions.appendChild(createButton("Raise", () => {
    raiseWidget.open();
  }, actionDisabled || !canPlayerRaise(player), "action-btn action-raise"));
  actions.appendChild(createButton("Fold", () => playerAction("fold", index), actionDisabled, "action-btn action-fold danger"));
  return actions;
}

function renderCurrentActionPanel() {
  if (!handActions) return;
  clearHandActions();
}

function createCenterOperationHeader(titleText, metaItems = []) {
  const header = document.createElement("div");
  header.className = "table-center-operation-header";

  const title = document.createElement("strong");
  title.textContent = titleText;
  header.appendChild(title);

  if (metaItems.length > 0) {
    const meta = document.createElement("div");
    meta.className = "table-center-operation-meta";
    metaItems.forEach(text => {
      const item = document.createElement("span");
      item.textContent = text;
      meta.appendChild(item);
    });
    header.appendChild(meta);
  }

  return header;
}

function openShowdownDialog() {
  if (!awaitingShowdown || handStatus !== "showdown") return;

  openTableActionDialog({
    title: "选择赢家",
    description: "每个奖池可选择一个或多个赢家；多人平分时，余数给第一个被选中的赢家。",
    className: "showdown-action-dialog",
    buildContent(body, closeDialog) {
      renderShowdownDialogBody(body, closeDialog);
    }
  });
}

function renderShowdownDialogBody(body, closeDialog) {
  body.replaceChildren();

  pendingPots.forEach((sidePot, potIndex) => {
    const card = document.createElement("div");
    card.classList.add("pot-card");

    const heading = document.createElement("strong");
    heading.textContent = `奖池 ${potIndex + 1}: ${sidePot.amount} 筹码`;
    card.appendChild(heading);

    const contenderNames = sidePot.contenders
      .map(id => getPlayerById(id))
      .filter(Boolean)
      .map(getPlayerName)
      .join("、");
    card.appendChild(createParagraph(`可争夺玩家: ${contenderNames || "无"}`));

    const options = document.createElement("div");
    options.classList.add("winner-options");

    if (!selectedWinnersByPot[potIndex]) {
      selectedWinnersByPot[potIndex] = new Set();
    }
    if (sidePot.contenders.length === 1) {
      selectedWinnersByPot[potIndex].add(sidePot.contenders[0]);
    }

    sidePot.contenders.forEach(playerId => {
      const player = getPlayerById(playerId);
      if (!player) return;

      const selected = selectedWinnersByPot[potIndex].has(playerId);
      const option = createButton(getPlayerName(player), () => {
        const selectedSet = selectedWinnersByPot[potIndex] || new Set();
        if (selectedSet.has(playerId)) {
          selectedSet.delete(playerId);
        } else {
          selectedSet.add(playerId);
        }
        selectedWinnersByPot[potIndex] = selectedSet;
        renderShowdownDialogBody(body, closeDialog);
      }, isInteractionLocked() || sidePot.contenders.length === 1, "winner-option");
      if (selected) option.classList.add("selected");
      options.appendChild(option);
    });

    card.appendChild(options);
    body.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.classList.add("showdown-actions");
  actions.appendChild(createButton("预结算", () => {
    if (!buildSettlementPlan()) return;
    closeDialog();
    confirmShowdown();
  }, isInteractionLocked() || handStatus !== "showdown", "prompt-primary"));
  body.appendChild(actions);
}

function openSettlementPreviewDialog() {
  if (handStatus !== "settlementPreview" || !settlementPreview) return;

  openTableActionDialog({
    title: "确认结算",
    description: "请检查本手筹码分配。",
    className: "settlement-action-dialog",
    buildContent(body, closeDialog) {
      const list = document.createElement("div");
      list.className = "settlement-preview-list";

      settlementPreview.pots.forEach(previewPot => {
        const card = document.createElement("div");
        card.className = "settlement-preview-card";

        const heading = document.createElement("strong");
        heading.textContent = `奖池 ${previewPot.index + 1}: ${previewPot.amount} 筹码`;
        card.appendChild(heading);

        previewPot.payouts.forEach(payout => {
          const winner = getPlayerById(payout.playerId);
          const row = document.createElement("p");
          row.className = "settlement-preview-row";
          row.appendChild(document.createTextNode(getPlayerName(winner)));
          const amount = document.createElement("span");
          amount.textContent = `+${payout.amount}`;
          row.appendChild(amount);
          card.appendChild(row);
        });

        list.appendChild(card);
      });
      body.appendChild(list);

      const actions = document.createElement("div");
      actions.className = "prompt-actions";
      actions.appendChild(createButton("取消，重新选择", () => {
        closeDialog();
        cancelSettlementPreview();
      }, isSharedPromptActionLocked(), "prompt-secondary"));
      actions.appendChild(createButton("确认结算", () => {
        closeDialog();
        confirmSettlementPreview();
      }, isSharedPromptActionLocked(), "prompt-primary"));
      body.appendChild(actions);
    }
  });
}

function createTableCenterOperations() {
  const operations = document.createElement("div");
  operations.className = "table-center-action-slot";

  if (shouldShowCurrentActionPanel()) {
    const index = currentPlayerIndex;
    const player = players[index];
    const actionDisabled = isInteractionLocked();
    operations.appendChild(createCenterOperationHeader(`${getPlayerName(player)} 行动`, [
      `筹码 ${player.chips}`,
      `需跟 ${getCallAmount(player)}`,
      `本轮下注 ${player.bet}`
    ]));
    operations.appendChild(createActionControls(player, index, actionDisabled, "table-center-action-buttons"));
    return operations;
  }

  if (handStatus === "waitingDeal" && pendingDealPrompt) {
    operations.appendChild(createCenterOperationHeader(pendingDealPrompt.title, [
      pendingDealPrompt.cardText
    ]));
    operations.appendChild(createButton("已发牌，继续", confirmDealPrompt, isSharedPromptActionLocked(), "prompt-primary"));
    return operations;
  }

  if (handStatus === "showdown") {
    operations.appendChild(createCenterOperationHeader("摊牌结算", [
      `${pendingPots.length || 1} 个奖池`
    ]));
    operations.appendChild(createButton("选择赢家", openShowdownDialog, isInteractionLocked(), "prompt-primary"));
    return operations;
  }

  if (handStatus === "settlementPreview") {
    operations.appendChild(createCenterOperationHeader("等待结算确认", [
      `总额 ${settlementPreview?.total || pot}`
    ]));
    operations.appendChild(createButton("查看并确认", openSettlementPreviewDialog, isSharedPromptActionLocked(), "prompt-primary"));
    return operations;
  }

  if (handStatus === "settled") {
    const eligibleCount = getEligiblePlayerIndices().length;
    const buttonHandId = handId;
    operations.appendChild(createCenterOperationHeader("本手已结算", [
      `下一局可参与 ${eligibleCount} 人`
    ]));
    const group = document.createElement("div");
    group.className = "table-center-action-buttons table-center-next-buttons";
    group.appendChild(createButton("牌桌管理", openTableManager, isInteractionLocked(), "table-manager-button"));
    group.appendChild(createButton("开始下一局", () => {
      resetHand(buttonHandId);
    }, isInteractionLocked() || eligibleCount < 2, "next-hand-button"));
    operations.appendChild(group);
    return operations;
  }

  operations.textContent = "操作区";
  return operations;
}

function getPositionMarkers(position = "") {
  const markers = [];
  const isDealer = position.includes("Dealer");
  const isSmallBlind = position.includes("小盲");
  if (isDealer && isSmallBlind) {
    markers.push(["D/SB", "dealer-small-blind"]);
  } else if (isDealer) {
    markers.push(["D", "dealer"]);
  } else if (isSmallBlind) {
    markers.push(["SB", "small-blind"]);
  }
  if (position.includes("大盲")) markers.push(["BB", "big-blind"]);
  return markers;
}

function createPositionMarker(label, type) {
  const marker = document.createElement("span");
  marker.className = `seat-marker seat-marker-${type}`;
  marker.textContent = label;
  return marker;
}

function createSeatPoint(left, top, side, mobileLeft = left, mobileTop = top) {
  return { left, top, side, mobileLeft, mobileTop };
}

const TABLE_SEAT_LAYOUTS = {
  1: [
    createSeatPoint(50, 14, "seat-top", 50, 7)
  ],
  2: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(50, 86, "seat-bottom", 50, 93)
  ],
  3: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(82, 70, "seat-right", 76, 76),
    createSeatPoint(18, 70, "seat-left", 24, 76)
  ],
  4: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(88, 50, "seat-right", 79, 30),
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(12, 50, "seat-left", 21, 70)
  ],
  5: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(86, 34, "seat-right", 79, 28),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(14, 34, "seat-left", 21, 28)
  ],
  6: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(80, 22, "seat-top", 74, 17.5),
    createSeatPoint(80, 78, "seat-bottom", 74, 82.5),
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(20, 78, "seat-bottom", 26, 82.5),
    createSeatPoint(20, 22, "seat-top", 26, 17.5)
  ],
  7: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(80, 21, "seat-top", 74, 17.5),
    createSeatPoint(88, 58, "seat-right", 79, 66),
    createSeatPoint(72, 84, "seat-bottom", 73, 82.5),
    createSeatPoint(50, 88, "seat-bottom", 50, 93),
    createSeatPoint(28, 84, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 58, "seat-left", 21, 66)
  ],
  8: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 73, 17.5),
    createSeatPoint(88, 50, "seat-right", 79, 31),
    createSeatPoint(78, 80, "seat-bottom", 73, 82.5),
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(22, 80, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 50, "seat-left", 21, 69),
    createSeatPoint(22, 20, "seat-top", 27, 17.5)
  ],
  9: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 73, 17.5),
    createSeatPoint(88, 38, "seat-right", 79, 30),
    createSeatPoint(88, 68, "seat-right", 79, 70),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5),
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 54, "seat-left", 21, 70),
    createSeatPoint(22, 20, "seat-top", 27, 17.5)
  ],
  10: [
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(76, 18, "seat-top", 73, 17.5),
    createSeatPoint(88, 34, "seat-right", 79, 30),
    createSeatPoint(88, 66, "seat-right", 79, 70),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5),
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 66, "seat-left", 21, 70),
    createSeatPoint(12, 34, "seat-left", 21, 30),
    createSeatPoint(24, 18, "seat-top", 27, 17.5)
  ]
};

function getSeatCoordinates(index, count) {
  const layout = TABLE_SEAT_LAYOUTS[Math.min(Math.max(count, 1), MAX_PLAYERS)] || TABLE_SEAT_LAYOUTS[1];
  return layout[index] || layout[index % layout.length];
}

function getCompactPlayerStatus(player) {
  if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
  if (player.folded) return "弃牌";
  if (player.allIn) return "All In";
  if (players.indexOf(player) === currentPlayerIndex) return "行动中";
  if (player.acted) return "已行动";
  return "等待";
}

function closeSeatDetailPopovers() {
  document.querySelectorAll(".seat-detail-popover").forEach(popover => popover.remove());
  document.querySelectorAll(".player-box.is-detail-open").forEach(box => {
    box.classList.remove("is-detail-open");
    box.setAttribute("aria-expanded", "false");
  });
}

function createSeatDetailPopover(player, index) {
  const popover = document.createElement("div");
  popover.className = "seat-detail-popover";
  popover.setAttribute("role", "tooltip");
  popover.addEventListener("click", event => event.stopPropagation());

  const title = document.createElement("strong");
  title.textContent = getPlayerName(player);
  popover.appendChild(title);

  [
    ["座位", String(index + 1)],
    ["位置", player.position || "-"],
    ["剩余", String(player.chips)],
    ["本轮下注", String(player.bet)],
    ["本局投入", String(player.totalBet || 0)],
    ["状态", getPlayerStatus(player)]
  ].forEach(([label, value]) => {
    const row = document.createElement("span");
    const labelEl = document.createElement("em");
    labelEl.textContent = label;
    const valueEl = document.createElement("b");
    valueEl.textContent = value;
    row.append(labelEl, valueEl);
    popover.appendChild(row);
  });

  return popover;
}

function toggleSeatDetail(box, player, index) {
  const alreadyOpen = box.classList.contains("is-detail-open");
  closeSeatDetailPopovers();
  if (alreadyOpen) return;

  box.classList.add("is-detail-open");
  box.setAttribute("aria-expanded", "true");
  box.appendChild(createSeatDetailPopover(player, index));
}

function createTableCenterPanel() {
  const center = document.createElement("section");
  center.className = "poker-table-center";
  center.setAttribute("aria-label", "牌桌状态");

  const eyebrow = document.createElement("span");
  eyebrow.className = "prompt-eyebrow";
  eyebrow.textContent = "Poker Table";
  center.appendChild(eyebrow);

  const potBlock = document.createElement("div");
  potBlock.className = "table-center-pot";
  const potLabel = document.createElement("span");
  potLabel.textContent = "奖池";
  const potValue = document.createElement("strong");
  potValue.textContent = String(pot);
  potBlock.append(potLabel, potValue);
  center.appendChild(potBlock);

  const meta = document.createElement("div");
  meta.className = "table-center-meta";
  [getRoundDisplayText(), `最高下注 ${currentBet}`].forEach(text => {
    const item = document.createElement("span");
    item.textContent = text;
    meta.appendChild(item);
  });
  center.appendChild(meta);

  /*
  const turn = document.createElement("div");
  turn.className = "table-center-turn";
  if (shouldShowCurrentActionPanel()) {
    const player = players[currentPlayerIndex];
    turn.textContent = `${getPlayerName(player)} 行动 · 需跟 ${getCallAmount(player)}`;
  } else if (handStatus === "waitingDeal" && pendingDealPrompt) {
    turn.textContent = pendingDealPrompt.title;
  } else if (handStatus === "showdown") {
    turn.textContent = "等待选择赢家";
  } else if (handStatus === "settlementPreview") {
    turn.textContent = "等待结算确认";
  } else if (handStatus === "settled") {
    turn.textContent = "本手已结算";
  } else {
    turn.textContent = "等待牌局更新";
  }
  center.appendChild(turn);
  */


  center.appendChild(createTableCenterOperations());

  return center;
}

function updatePlayerBoxes() {
  const boxes = document.getElementById("player-boxes");
  boxes.replaceChildren();
  boxes.className = "player-boxes";
  boxes.classList.add(`player-count-${Math.min(players.length, MAX_PLAYERS)}`);
  boxes.style.setProperty("--player-count", players.length);
  boxes.appendChild(createTableCenterPanel());

  players.forEach((player, index) => {
    const seat = getSeatCoordinates(index, players.length);

    const box = document.createElement("div");
    box.classList.add("player-box");
    box.classList.add(seat.side);
    if (player.folded) box.classList.add("folded");
    if (player.allIn) box.classList.add("all-in");
    if (player.seatStatus !== "seated") box.classList.add("seat-inactive");
    if (index === currentPlayerIndex) box.classList.add("active");
    box.style.setProperty("--seat-left", `${seat.left}%`);
    box.style.setProperty("--seat-top", `${seat.top}%`);
    box.style.setProperty("--seat-left-mobile", `${seat.mobileLeft}%`);
    box.style.setProperty("--seat-top-mobile", `${seat.mobileTop}%`);
    box.setAttribute("aria-label", `${getPlayerName(player)}，筹码 ${player.chips}，本轮下注 ${player.bet}，${getPlayerStatus(player)}`);
    box.setAttribute("role", "button");
    box.setAttribute("aria-expanded", "false");
    box.tabIndex = 0;
    box.addEventListener("click", () => {
      toggleSeatDetail(box, player, index);
    });
    box.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggleSeatDetail(box, player, index);
    });

    const main = document.createElement("div");
    main.className = "player-seat-main";
    const name = document.createElement("h3");
    name.className = "player-name";
    name.textContent = getPlayerName(player);
    main.appendChild(name);

    const chipValue = document.createElement("p");
    chipValue.className = "seat-chip";
    chipValue.textContent = String(player.chips);
    main.appendChild(chipValue);
    box.appendChild(main);

    const meta = document.createElement("div");
    meta.className = "seat-meta";
    const badges = document.createElement("div");
    badges.className = "player-badges";
    const positionMarkers = getPositionMarkers(player.position);
    if (positionMarkers.length > 0) {
      positionMarkers.forEach(([label, type]) => {
        badges.appendChild(createPositionMarker(label, type));
      });
    } else {
      const seatMarker = document.createElement("span");
      seatMarker.className = "seat-marker seat-marker-seat";
      seatMarker.textContent = String(index + 1);
      badges.appendChild(seatMarker);
    }
    meta.appendChild(badges);

    const betBadge = document.createElement("span");
    betBadge.className = "seat-bet-badge";
    betBadge.textContent = `本轮 ${player.bet}`;
    meta.appendChild(betBadge);

    const status = document.createElement("p");
    status.className = "seat-status-badge";
    status.textContent = getCompactPlayerStatus(player);
    meta.appendChild(status);
    box.appendChild(meta);

    boxes.appendChild(box);
  });

  renderCurrentActionPanel();
}

function getPlayerStatus(player) {
  if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
  if (player.folded) return "Folded";
  if (player.allIn) return "All In";
  if (players.indexOf(player) === currentPlayerIndex) return "行动中";
  if (player.acted) return `已行动，Bet ${player.bet}`;
  return "等待";
}

// 将核心函数导出到全局作用域，方便浏览器控制台调试
window.playerAction = playerAction;
window.resetHand = resetHand;
// End of file
