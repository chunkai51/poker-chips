// src/main.js
import { db, get, onValue, ref, runTransaction, update } from "./firebase.js";
import {
  ROOM_MODES,
  createAccessCode,
  createMembersMap,
  getClientId,
  getRoomHostId,
  hashAccessCode,
  normalizeAccessCode,
  normalizeAdminPlayerIds,
  normalizeMembers,
  normalizePlayerOwnerId,
  normalizeRoomMode,
  touchMember,
  verifyAccessCode
} from "./identity.js";
import {
  SEAT_STATUS_LABELS,
  canAct,
  canPlayerRaise as canPlayerRaiseWithState,
  getCallAmount as calculateCallAmount,
  getChipStep as calculateChipStep,
  getDefaultRaiseTarget as calculateDefaultRaiseTarget,
  getEligibleOrderFrom as buildEligibleOrderFrom,
  getEligiblePlayerIndices as collectEligiblePlayerIndices,
  getHandLayout as buildHandLayout,
  getMaximumRaiseTarget as calculateMaximumRaiseTarget,
  getMinimumRaiseTarget as calculateMinimumRaiseTarget,
  getNextEligibleIndexAfter,
  getNextEligibleIndexFrom,
  getPotSizedRaiseTarget as calculatePotSizedRaiseTarget,
  getRaiseUnavailableMessage as getRaiseUnavailableMessageForState,
  getRaiseValidation as validateRaiseTarget,
  getSeatStatusLabel,
  isEligibleForNextHand,
  normalizeSeatStatus
} from "./game-rules.js";
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
const localModeBtn = document.getElementById("local-mode");
const roomModeBtn = document.getElementById("room-mode");
const createRoomBtn = document.getElementById("create-room");
const joinRoomBtn = document.getElementById("join-room");
const roomEntry = document.getElementById("room-entry");
const deviceIdentityEl = document.getElementById("device-identity");
const gameLog = document.getElementById("game-log");
const handActions = document.getElementById("hand-actions");
const tableViewToolbar = document.getElementById("table-view-toolbar");
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
let nextHandApprovals = {};
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
let lobbySyncTimer = null;
let tableViewRotationOffset = 0;

const MAX_PLAYERS = 10;
const TABLE_VIEW_ROTATION_KEY_PREFIX = "pokerChipsTableViewRotation:";
const ROOM_ADMIN_CODE_KEY_PREFIX = "pokerChipsAdminCode:";
const PLAYER_CODE_KEY_PREFIX = "pokerChipsPlayerCode:";
const clientId = getClientId();

// ----------------------
// 房间系统数据结构
// ----------------------
let room = {
  roomId: "",
  mode: ROOM_MODES.local,
  operator: clientId,
  hostClientId: clientId,
  adminKeyHash: "",
  adminPlayerIds: [],
  members: createMembersMap(clientId),
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
    nextHandApprovals: {},
    handId: 0,
    handStatus: "setup",
    stateVersion: 0,
    updatedBy: clientId
  }
};

// ----------------------
// 通用工具函数
// ----------------------
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

function getClientShortId(value = clientId) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "local";
}

function getAdminCodeStorageKey(roomId = room.roomId) {
  return `${ROOM_ADMIN_CODE_KEY_PREFIX}${roomId || "local"}`;
}

function getPlayerCodeStorageKey(playerId, roomId = room.roomId) {
  return `${PLAYER_CODE_KEY_PREFIX}${roomId || "local"}:${playerId}`;
}

function rememberAdminCode(code, roomId = room.roomId) {
  const normalizedCode = normalizeAccessCode(code);
  if (!normalizedCode || !roomId) return;
  try {
    localStorage.setItem(getAdminCodeStorageKey(roomId), normalizedCode);
  } catch (_) {
    // Access recovery codes are convenience-only; storage failures should not block play.
  }
}

function getRememberedAdminCode(roomId = room.roomId) {
  try {
    return normalizeAccessCode(localStorage.getItem(getAdminCodeStorageKey(roomId)));
  } catch (_) {
    return "";
  }
}

function forgetAdminCode(roomId = room.roomId) {
  try {
    localStorage.removeItem(getAdminCodeStorageKey(roomId));
  } catch (_) {
    // Optional local cache.
  }
}

function rememberPlayerCode(playerId, code, roomId = room.roomId) {
  const normalizedCode = normalizeAccessCode(code);
  if (!playerId || !normalizedCode || !roomId) return;
  try {
    localStorage.setItem(getPlayerCodeStorageKey(playerId, roomId), normalizedCode);
  } catch (_) {
    // Optional local cache.
  }
}

function getRememberedPlayerCode(playerId, roomId = room.roomId) {
  if (!playerId) return "";
  try {
    return normalizeAccessCode(localStorage.getItem(getPlayerCodeStorageKey(playerId, roomId)));
  } catch (_) {
    return "";
  }
}

function getPlayerCodeSalt(playerId, roomId = room.roomId) {
  return `${roomId || "local"}:${playerId}`;
}

function getAdminCodeSalt(roomId = room.roomId) {
  return `${roomId || "local"}:admin`;
}

function isPlayerCodeValid(player, code, roomData = room) {
  const normalizedCode = normalizeAccessCode(code);
  if (!player?.playerKeyHash || !normalizedCode) return false;
  return verifyAccessCode(normalizedCode, player.playerKeyHash, getPlayerCodeSalt(player.id, roomData.roomId || room.roomId));
}

function isAdminCodeValid(code, roomData = room) {
  const normalizedCode = normalizeAccessCode(code);
  if (!roomData?.adminKeyHash || !normalizedCode) return false;
  return verifyAccessCode(normalizedCode, roomData.adminKeyHash, getAdminCodeSalt(roomData.roomId || room.roomId));
}

function getPlayerById(id) {
  return players.find(player => player.id === id);
}

function getActivePlayers() {
  return players.filter(player => !player.folded);
}

function isLocalMode() {
  return room.mode === ROOM_MODES.local;
}

function isRoomMode() {
  return room.mode === ROOM_MODES.room;
}

function needsRemoteSync() {
  return isRoomMode() && Boolean(room.roomId);
}

function getHostClientId(roomData = room) {
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || room.roomId);
  const fallbackClientId = mode === ROOM_MODES.local ? clientId : roomData?.operator || "";
  return getRoomHostId(roomData, fallbackClientId) || fallbackClientId;
}

function isClientAdminInRoom(actorClientId, roomData = room) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const members = normalizeMembers(roomData?.members);
  const member = members[normalizedActorId];
  const adminPlayerIds = normalizeAdminPlayerIds(roomData?.adminPlayerIds);
  const claimedPlayerId = String(member?.claimedPlayerId || "");
  const roomPlayers = normalizeIncomingPlayers(roomData?.players || players);
  const ownsAdminPlayer = adminPlayerIds.includes(claimedPlayerId) &&
    roomPlayers.some(player => player.id === claimedPlayerId && normalizePlayerOwnerId(player.ownerClientId) === normalizedActorId);
  const rememberedCodeValid = normalizedActorId === clientId &&
    isAdminCodeValid(getRememberedAdminCode(roomData?.roomId || room.roomId), roomData);
  return Boolean(member?.adminVerified) ||
    rememberedCodeValid ||
    ownsAdminPlayer ||
    getHostClientId(roomData) === normalizedActorId;
}

function getRoomManagerProxyId(roomData = room) {
  const adminPlayerIds = normalizeAdminPlayerIds(roomData?.adminPlayerIds);
  const roomPlayers = normalizeIncomingPlayers(roomData?.players || players);
  const adminPlayerOwner = roomPlayers
    .filter(player => adminPlayerIds.includes(player.id))
    .map(player => normalizePlayerOwnerId(player.ownerClientId))
    .find(Boolean);
  if (adminPlayerOwner) return adminPlayerOwner;

  const adminMemberId = Object.values(normalizeMembers(roomData?.members))
    .filter(member => member.adminVerified)
    .sort((left, right) => toNonNegativeNumber(right.lastSeenAt, 0) - toNonNegativeNumber(left.lastSeenAt, 0))
    .map(member => member.clientId)[0];
  return adminMemberId || getHostClientId(roomData);
}

function canClientManageRoomData(actorClientId, roomData = room) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || room.roomId);
  if (mode === ROOM_MODES.local) return true;
  return isClientAdminInRoom(normalizedActorId, roomData);
}

function canClientControlPlayerInRoom(actorClientId, player, roomData = room) {
  const normalizedActorId = normalizePlayerOwnerId(actorClientId);
  if (!normalizedActorId) return false;
  const mode = normalizeRoomMode(roomData?.mode, roomData?.roomId || room.roomId);
  if (mode === ROOM_MODES.local) return true;
  const ownerClientId = normalizePlayerOwnerId(player?.ownerClientId);
  if (ownerClientId) return ownerClientId === normalizedActorId;
  return canClientManageRoomData(normalizedActorId, roomData);
}

function getCurrentDevicePlayerIndex(list = players) {
  return list.findIndex(player => normalizePlayerOwnerId(player.ownerClientId) === clientId);
}

function getCurrentDevicePlayer(list = players) {
  const index = getCurrentDevicePlayerIndex(list);
  return index >= 0 ? list[index] : null;
}

function isCurrentDevicePlayer(player) {
  return normalizePlayerOwnerId(player?.ownerClientId) === clientId;
}

function getPlayerControllerId(player, roomData = room) {
  return normalizePlayerOwnerId(player?.ownerClientId) || getRoomManagerProxyId(roomData);
}

function canCurrentClientControlPlayer(player) {
  return canClientControlPlayerInRoom(clientId, player, room);
}

function canCurrentClientManageRoom() {
  return canClientManageRoomData(clientId, room);
}

function canCurrentClientModifyClaims() {
  return isRoomMode() && Boolean(room.roomId);
}

function getDealerPlayer() {
  return players.find(player => player.dealer) || null;
}

function canCurrentClientConfirmDeal() {
  return isLocalMode() || canCurrentClientControlPlayer(getDealerPlayer());
}

function hasDuplicatePlayerName(player, list = players) {
  const name = getPlayerName(player).trim().toLocaleLowerCase();
  return list.filter(item => getPlayerName(item).trim().toLocaleLowerCase() === name).length > 1;
}

function getPlayerIdentityLabel(player, index = players.indexOf(player), list = players) {
  const name = getPlayerName(player);
  const seatNumber = index >= 0 ? index + 1 : "?";
  return hasDuplicatePlayerName(player, list) ? `${name} · 座位 ${seatNumber}` : name;
}

function getPlayerCompactIdentityLabel(player, index = players.indexOf(player), list = players) {
  const name = getPlayerName(player);
  const seatNumber = index >= 0 ? index + 1 : "?";
  return hasDuplicatePlayerName(player, list) ? `${name} · S${seatNumber}` : name;
}

function getEligiblePlayerIndices(list = players) {
  return collectEligiblePlayerIndices(list);
}

function getCallAmount(player) {
  return calculateCallAmount(player, currentBet);
}

function getCallButtonLabel(player) {
  const callAmount = getCallAmount(player);
  if (callAmount <= 0) return "Call";
  if (player.chips < callAmount) return `All In ${player.chips}`;
  return `Call ${callAmount}`;
}

function getRaiseState() {
  return {
    currentBet,
    lastRaiseSize,
    bigBlind,
    smallBlind,
    pot,
    chipStep: getChipStep()
  };
}

function getRaiseUnavailableMessage(player) {
  return getRaiseUnavailableMessageForState(player, getRaiseState());
}

function canPlayerRaise(player) {
  return canPlayerRaiseWithState(player, getRaiseState());
}

function getChipStep() {
  return calculateChipStep(smallBlind, bigBlind);
}

function getMaximumRaiseTarget(player) {
  return calculateMaximumRaiseTarget(player);
}

function getMinimumRaiseTarget(player) {
  return calculateMinimumRaiseTarget(player, getRaiseState());
}

function getDefaultRaiseTarget(player) {
  return calculateDefaultRaiseTarget(player, getRaiseState());
}

function getPotSizedRaiseTarget(player, fraction) {
  return calculatePotSizedRaiseTarget(player, fraction, getRaiseState());
}

function getRaiseValidation(player, rawTarget) {
  return validateRaiseTarget(player, rawTarget, getRaiseState());
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

function closeAppDialog(result = false) {
  const backdrop = document.querySelector(".app-dialog-backdrop");
  if (!backdrop) return;

  const resolver = backdrop._resolveDialog;
  const previousFocus = backdrop._previousFocus;
  backdrop.remove();
  if (previousFocus && typeof previousFocus.focus === "function") {
    try {
      previousFocus.focus({ preventScroll: true });
    } catch (_) {
      previousFocus.focus();
    }
  }
  if (resolver) resolver(result);
}

function showAppDialog({
  title = "提示",
  message = "",
  confirmLabel = "知道了",
  cancelLabel = "",
  danger = false
} = {}) {
  closeAppDialog(false);

  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "app-dialog-backdrop";
    backdrop._resolveDialog = resolve;
    backdrop._previousFocus = previousFocus;

    const dialog = document.createElement("section");
    dialog.className = "app-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.addEventListener("click", event => event.stopPropagation());

    const heading = document.createElement("h3");
    heading.textContent = title;
    dialog.appendChild(heading);

    if (message) {
      const content = createParagraph(message);
      content.className = "app-dialog-message";
      dialog.appendChild(content);
    }

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";

    if (cancelLabel) {
      actions.appendChild(createButton(cancelLabel, () => {
        closeAppDialog(false);
      }, false, "app-dialog-button app-dialog-cancel"));
    }

    const confirmButton = createButton(confirmLabel, () => {
      closeAppDialog(true);
    }, false, danger ? "app-dialog-button app-dialog-confirm danger" : "app-dialog-button app-dialog-confirm");
    actions.appendChild(confirmButton);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", () => {
      closeAppDialog(false);
    });
    backdrop.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAppDialog(false);
      }
    });
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => confirmButton.focus());
  });
}

function showAppAlert(message, title = "提示") {
  return showAppDialog({
    title,
    message,
    confirmLabel: "知道了"
  });
}

function showAppConfirm(message, {
  title = "请确认",
  confirmLabel = "确认",
  cancelLabel = "取消",
  danger = false
} = {}) {
  return showAppDialog({
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger
  });
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

function getTableViewRotationStorageKey() {
  return `${TABLE_VIEW_ROTATION_KEY_PREFIX}${room.roomId || "local"}`;
}

function loadTableViewRotation() {
  try {
    tableViewRotationOffset = parseInt(localStorage.getItem(getTableViewRotationStorageKey()) || "0", 10) || 0;
  } catch (_) {
    tableViewRotationOffset = 0;
  }
}

function saveTableViewRotation() {
  try {
    localStorage.setItem(getTableViewRotationStorageKey(), String(tableViewRotationOffset));
  } catch (_) {
    // Local view rotation is optional; storage failures should not affect the hand.
  }
}

function rotateTableView(delta) {
  tableViewRotationOffset += delta;
  saveTableViewRotation();
  updatePlayerBoxes();
  renderTableViewToolbar();
}

function resetTableViewRotation() {
  tableViewRotationOffset = 0;
  saveTableViewRotation();
  updatePlayerBoxes();
  renderTableViewToolbar();
}

function stopRoomListener() {
  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }
  listenedRoomId = "";
}

function enterLocalMode() {
  if (gameStarted && !isLocalMode()) {
    showAppAlert("牌局进行中不能切换到本地模式。");
    return;
  }
  stopRoomListener();
  room.roomId = "";
  room.mode = ROOM_MODES.local;
  room.operator = clientId;
  room.hostClientId = clientId;
  room.adminKeyHash = "";
  room.adminPlayerIds = [];
  room.members = createMembersMap(clientId);
  roomIdInput.value = "";
  syncReady = true;
  loadTableViewRotation();
  setSyncStatus("本地模式");
  renderIdentityControls();
  renderSetupPlayerInputs();
  updatePlayerBoxes();
}

function enterRoomMode() {
  if (gameStarted && !isRoomMode()) {
    showAppAlert("牌局进行中不能切换房间模式。");
    return;
  }
  room.mode = ROOM_MODES.room;
  syncReady = Boolean(room.roomId && syncReady);
  loadTableViewRotation();
  setSyncStatus(room.roomId ? "等待同步" : "多人房间未连接");
  renderIdentityControls();
  renderSetupPlayerInputs();
  updatePlayerBoxes();
}

function getIdentitySummaryText() {
  const currentPlayer = getCurrentDevicePlayer();
  const currentIndex = currentPlayer ? players.indexOf(currentPlayer) : -1;
  if (currentPlayer) {
    return `当前设备：${getPlayerIdentityLabel(currentPlayer, currentIndex)} · ${isRoomMode() ? `ID ${getClientShortId()}` : "本地控制"}`;
  }
  return isRoomMode()
    ? `当前设备未绑定玩家 · ID ${getClientShortId()}`
    : "本地模式：这台设备可以管理整桌";
}

function renderIdentityControls() {
  if (localModeBtn) {
    localModeBtn.classList.toggle("active", isLocalMode());
    localModeBtn.disabled = gameStarted && !isLocalMode();
  }
  if (roomModeBtn) {
    roomModeBtn.classList.toggle("active", isRoomMode());
    roomModeBtn.disabled = gameStarted && !isRoomMode();
  }
  if (roomEntry) roomEntry.hidden = !isRoomMode();
  if (createRoomBtn) createRoomBtn.disabled = gameStarted || syncWriteInProgress;
  if (joinRoomBtn) joinRoomBtn.disabled = gameStarted || syncWriteInProgress;
  if (!deviceIdentityEl) return;

  deviceIdentityEl.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = isRoomMode() ? "多人房间" : "单设备本地";
  const detail = document.createElement("span");
  const roomText = isRoomMode()
    ? room.roomId
      ? `房间 ${room.roomId} · ${Object.keys(room.members || {}).length || 1} 台设备`
      : "先创建或加入房间"
    : "不写入远程房间";
  detail.textContent = `${getIdentitySummaryText()} · ${roomText}`;
  deviceIdentityEl.append(title, detail);
  if (isRoomMode() && room.roomId) {
    const manageButton = createButton("席位与身份", openTableManager, false, "identity-manage-button");
    deviceIdentityEl.appendChild(manageButton);
  }
}

function renderTableViewToolbar() {
  if (!tableViewToolbar) return;
  tableViewToolbar.replaceChildren();
  if (!gameStarted) {
    tableViewToolbar.hidden = true;
    return;
  }

  tableViewToolbar.hidden = false;
  const summary = document.createElement("div");
  summary.className = "table-view-summary";
  const currentPlayer = getCurrentDevicePlayer();
  const currentIndex = currentPlayer ? players.indexOf(currentPlayer) : -1;
  const title = document.createElement("strong");
  title.textContent = currentPlayer
    ? `我的视角：${getPlayerIdentityLabel(currentPlayer, currentIndex)}`
    : isRoomMode()
      ? "旁观视角"
      : "本地整桌视角";
  const detail = document.createElement("span");
  detail.textContent = isRoomMode()
    ? "视角旋转只保存在这台设备"
    : "本地模式不绑定玩家身份";
  summary.append(title, detail);
  tableViewToolbar.appendChild(summary);

  if (!isRoomMode()) return;

  const controls = document.createElement("div");
  controls.className = "table-view-controls";
  const hasClaimedPlayer = Boolean(currentPlayer);
  const resetDisabled = !hasClaimedPlayer || normalizeRotationOffset(players.length) === 0;
  controls.appendChild(createButton("↺", () => rotateTableView(-1), players.length < 2, "table-view-button"));
  controls.appendChild(createButton("以我为底", resetTableViewRotation, resetDisabled, "table-view-button"));
  controls.appendChild(createButton("↻", () => rotateTableView(1), players.length < 2, "table-view-button"));
  controls.appendChild(createButton("身份", openTableManager, false, "table-view-button"));
  tableViewToolbar.appendChild(controls);
}

function isInteractionLocked() {
  return mutationInProgress || syncWriteInProgress || (needsRemoteSync() && !syncReady);
}

function isSharedPromptActionLocked() {
  return mutationInProgress || syncWriteInProgress || (needsRemoteSync() && !syncReady);
}

function refreshInteractiveControls() {
  renderIdentityControls();
  updatePlayerBoxes();
  renderTableViewToolbar();
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
    expectedStateVersion = null,
    remoteGuard = null
  } = options;
  const guardedWrite = expectedHandId !== null ||
    expectedStateVersion !== null ||
    Array.isArray(allowedStatuses);
  const nextStateVersion = stateVersion + 1;
  room.mode = normalizeRoomMode(room.mode, room.roomId);
  room.hostClientId = getRoomHostId(room, clientId);
  room.members = touchMember(room.members, clientId);

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
    nextHandApprovals,
    handId,
    handStatus,
    stateVersion: nextStateVersion,
    updatedBy: clientId
  };
  const nextRoomData = {
    mode: room.mode,
    operator: room.operator,
    hostClientId: room.hostClientId,
    adminKeyHash: room.adminKeyHash || "",
    adminPlayerIds: normalizeAdminPlayerIds(room.adminPlayerIds),
    members: room.members,
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
        if (typeof remoteGuard === "function" && !remoteGuard(currentRoom, currentGameState)) return undefined;

        return {
          ...currentRoom,
          ...nextRoomData,
          mode: normalizeRoomMode(currentRoom.mode || nextRoomData.mode, room.roomId),
          operator: currentRoom.operator || nextRoomData.operator,
          hostClientId: getRoomHostId(currentRoom, nextRoomData.hostClientId),
          adminKeyHash: currentRoom.adminKeyHash || nextRoomData.adminKeyHash,
          adminPlayerIds: normalizeAdminPlayerIds(currentRoom.adminPlayerIds || nextRoomData.adminPlayerIds),
          members: {
            ...normalizeMembers(currentRoom.members),
            ...normalizeMembers(nextRoomData.members)
          }
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
    ownerClientId: normalizePlayerOwnerId(player?.ownerClientId),
    playerKeyHash: String(player?.playerKeyHash || ""),
    bet: toNonNegativeNumber(player?.bet, 0),
    totalBet: toNonNegativeNumber(player?.totalBet, 0),
    allIn,
    acted: Boolean(player?.acted),
    position: String(player?.position || "")
  };
}

function normalizeIncomingPlayers(list) {
  return Array.isArray(list) ? list.map(normalizeIncomingPlayer) : [];
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
    approvals: normalizeApprovalMap(preview.approvals),
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
  nextHandApprovals = normalizeApprovalMap(gameState.nextHandApprovals);
  handId = toNonNegativeNumber(gameState.handId, handId);
  handStatus = String(gameState.handStatus || inferHandStatus(gameState));
  stateVersion = toNonNegativeNumber(gameState.stateVersion, stateVersion);
  room.mode = normalizeRoomMode(data.mode, room.roomId);
  room.operator = String(data.operator || room.operator || clientId);
  room.hostClientId = getRoomHostId(data, room.operator || clientId);
  room.adminKeyHash = String(data.adminKeyHash || room.adminKeyHash || "");
  room.adminPlayerIds = normalizeAdminPlayerIds(data.adminPlayerIds);
  room.members = touchMember(data.members, clientId);
  room.gameState.logs = Array.isArray(gameState.logs) ? gameState.logs.map(String) : [];
  room.gameState.inProgress = Boolean(gameState.inProgress);
  players = Array.isArray(data.players)
    ? data.players.map(normalizeIncomingPlayer)
    : players;
  room.players = players;

  renderIdentityControls();
  renderGameLog(room.gameState.logs);
  updateGameInfo();
  updatePlayerBoxes();
  renderTableViewToolbar();
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
    renderSetupPlayerInputs();
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
  const adminCode = createAccessCode();
  room.mode = ROOM_MODES.room;
  room.operator = clientId;
  room.hostClientId = clientId;
  room.adminKeyHash = hashAccessCode(adminCode, getAdminCodeSalt(room.roomId));
  room.adminPlayerIds = [];
  room.members = createMembersMap(clientId, {
    [clientId]: {
      adminVerified: true
    }
  });
  rememberAdminCode(adminCode, room.roomId);
  syncReady = true;
  loadTableViewRotation();
  handId = 0;
  handStatus = "setup";
  listenFirebaseUpdates();
  renderIdentityControls();
  showAppAlert(`房间 ${room.roomId} 已创建。\n管理码：${adminCode}\n请保存这个管理码，用于换设备后恢复管理权限。`, "房间已创建");
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

  const switchingRoom = room.roomId !== normalizedRoomId;
  room.roomId = normalizedRoomId;
  room.mode = ROOM_MODES.room;
  if (switchingRoom) {
    room.operator = "";
    room.hostClientId = "";
    room.adminKeyHash = "";
    room.adminPlayerIds = [];
    room.members = createMembersMap(clientId);
    syncReady = false;
  }
  room.members = touchMember(room.members, clientId);
  roomIdInput.value = normalizedRoomId;
  loadTableViewRotation();
  listenFirebaseUpdates();
  renderIdentityControls();
}

function syncRoomFromInput() {
  const id = normalizeRoomId(roomIdInput.value);
  if (!id) return;
  joinRoom(id);
}

if (manualSyncBtn) {
  manualSyncBtn.addEventListener("click", () => {
    const id = normalizeRoomId(roomIdInput.value);
    if (!id) {
      showAppAlert("请输入房间ID");
      return;
    }
    room.mode = ROOM_MODES.room;
    joinRoom(id);
  });
}

if (localModeBtn) {
  localModeBtn.addEventListener("click", enterLocalMode);
}

if (roomModeBtn) {
  roomModeBtn.addEventListener("click", enterRoomMode);
}

if (createRoomBtn) {
  createRoomBtn.addEventListener("click", async () => {
    if (gameStarted) return;
    room.roomId = normalizeRoomId(roomIdInput.value);
    createRoom();
    roomIdInput.value = room.roomId;
    setSyncStatus("房间已创建", "ok");
    await syncLobbyState();
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    const id = normalizeRoomId(roomIdInput.value);
    if (!id) {
      showAppAlert("请输入房间ID");
      return;
    }
    joinRoom(id);
  });
}

// ----------------------
// 添加玩家逻辑
// ----------------------
function createPlayerId() {
  if (crypto.randomUUID) return `player_${crypto.randomUUID().slice(0, 8)}`;
  return `player_${Date.now().toString(36)}_${Math.floor(Math.random() * 100000).toString(36)}`;
}

function normalizeSetupPlayers() {
  players = players.map((player, index) => ({
    id: String(player.id || createPlayerId()),
    name: String(player.name || "").trim(),
    seatIndex: index,
    seatStatus: normalizeSeatStatus(player.seatStatus || "seated", toNonNegativeNumber(player.chips, 0), false),
    chips: toPositiveInteger(player.chips, toPositiveInteger(initialChipsInput.value, 1000)),
    folded: false,
    dealer: Boolean(player.dealer),
    ownerClientId: normalizePlayerOwnerId(player.ownerClientId),
    playerKeyHash: String(player.playerKeyHash || ""),
    bet: 0,
    totalBet: 0,
    allIn: false,
    acted: false,
    position: ""
  }));
  room.players = players;
}

function createSetupPlayer(overrides = {}) {
  return {
    id: createPlayerId(),
    name: "",
    seatIndex: players.length,
    seatStatus: "seated",
    chips: toPositiveInteger(initialChipsInput.value, 1000),
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

function isClaimedByOtherDevice(player) {
  const ownerClientId = normalizePlayerOwnerId(player?.ownerClientId);
  return Boolean(ownerClientId && ownerClientId !== clientId);
}

function getSetupClaimLabel(player) {
  if (!isRoomMode()) return "本地";
  if (isCurrentDevicePlayer(player)) return "我的座位";
  if (isClaimedByOtherDevice(player)) return "接管";
  return "绑定";
}

function setCurrentMemberClaim(playerId, extra = {}) {
  const members = normalizeMembers(room.members);
  const currentMember = members[clientId] || {};
  room.members = {
    ...members,
    [clientId]: {
      ...currentMember,
      ...extra,
      clientId,
      claimedPlayerId: playerId || "",
      lastSeenAt: Date.now()
    }
  };
}

function applyLocalPlayerClaim(playerId, shouldClaim) {
  players.forEach(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) === clientId) {
      player.ownerClientId = "";
    }
  });
  const player = players.find(item => item.id === playerId);
  if (shouldClaim && !player) return false;
  if (shouldClaim) {
    player.ownerClientId = clientId;
    setCurrentMemberClaim(playerId);
  } else {
    setCurrentMemberClaim("");
  }
  if (handStatus === "settled") nextHandApprovals = {};
  room.players = players;
  return true;
}

function getClaimAuthForPlayer(player, code = "", forceAdmin = false) {
  const normalizedCode = normalizeAccessCode(code) || getRememberedPlayerCode(player?.id);
  const canForce = forceAdmin && canCurrentClientManageRoom();
  const canUseCode = Boolean(player?.playerKeyHash && isPlayerCodeValid(player, normalizedCode));
  const firstClaim = !player?.playerKeyHash;
  return {
    code: normalizedCode,
    canForce,
    canUseCode,
    firstClaim,
    allowed: canForce || canUseCode || firstClaim
  };
}

async function claimPlayerIdentity(playerId, { code = "", forceAdmin = false, announceCode = true } = {}) {
  if (!isRoomMode()) return;
  const player = players.find(item => item.id === playerId);
  if (!player) return;

  if (!room.roomId) {
    applyLocalPlayerClaim(playerId, true);
    renderSetupPlayerInputs();
    updatePlayerBoxes();
    renderTableViewToolbar();
    return;
  }

  const auth = getClaimAuthForPlayer(player, code, forceAdmin);
  if (!auth.allowed) {
    showAppAlert("请输入该玩家的玩家码，或由管理员重置/接管。");
    return;
  }
  const generatedCode = auth.firstClaim ? createAccessCode() : "";
  const generatedHash = generatedCode
    ? hashAccessCode(generatedCode, getPlayerCodeSalt(playerId))
    : "";

  setMutationInProgress(true);
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      const currentStatus = String(currentRoom.gameState?.handStatus || inferHandStatus(currentRoom.gameState || {}));
      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const target = remotePlayers.find(item => item.id === playerId);
      if (!target) return undefined;

      const adminForce = forceAdmin && canClientManageRoomData(clientId, currentRoom);
      const remoteCanUseCode = Boolean(target.playerKeyHash && isPlayerCodeValid(target, auth.code, currentRoom));
      const remoteFirstClaim = !target.playerKeyHash;
      if (!adminForce && !remoteCanUseCode && !remoteFirstClaim) return undefined;

      remotePlayers.forEach(item => {
        if (normalizePlayerOwnerId(item.ownerClientId) === clientId) {
          item.ownerClientId = "";
        }
      });
      target.ownerClientId = clientId;
      if (remoteFirstClaim && generatedHash) {
        target.playerKeyHash = generatedHash;
      }
      const nextGameState = currentRoom.gameState || {};
      const resetNextHandApprovals = currentStatus === "settled";
      const members = touchMember(currentRoom.members || room.members, clientId);
      Object.entries(members).forEach(([memberId, member]) => {
        if (memberId !== clientId && String(member.claimedPlayerId || "") === playerId) {
          members[memberId] = {
            ...member,
            claimedPlayerId: ""
          };
        }
      });
      members[clientId] = {
        ...members[clientId],
        claimedPlayerId: playerId
      };

      const nextRoom = {
        ...currentRoom,
        mode: normalizeRoomMode(currentRoom.mode, room.roomId),
        hostClientId: getRoomHostId(currentRoom, room.hostClientId || clientId),
        members,
        players: remotePlayers
      };
      if (resetNextHandApprovals) {
        nextRoom.gameState = {
          ...nextGameState,
          nextHandApprovals: {},
          stateVersion: toNonNegativeNumber(nextGameState.stateVersion, 0) + 1,
          updatedBy: clientId
        };
      }
      return nextRoom;
    }, { applyLocally: false });

    if (!result.committed) {
      showAppAlert("绑定没有成功，请检查玩家码或等待同步后重试。");
      const refreshed = await refreshFromRemote();
      if (!refreshed) syncReady = false;
      return;
    }

    if (generatedCode) {
      rememberPlayerCode(playerId, generatedCode);
      if (announceCode) {
        showAppAlert(`${getPlayerIdentityLabel(player)} 已绑定到当前设备。\n玩家码：${generatedCode}\n请保存，换设备时可用它重新接管。`, "玩家码已生成");
      }
    } else if (auth.code) {
      rememberPlayerCode(playerId, auth.code);
    }
    applyLocalPlayerClaim(playerId, true);
    setSyncStatus("已同步", "ok");
  } catch (_) {
    showAppAlert("绑定同步失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    renderSetupPlayerInputs();
    updatePlayerBoxes();
    renderTableViewToolbar();
  }
}

async function releaseCurrentPlayerIdentity() {
  if (!isRoomMode() || !room.roomId) return;
  const currentPlayer = getCurrentDevicePlayer();
  if (!currentPlayer) return;
  setMutationInProgress(true);
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      remotePlayers.forEach(player => {
        if (normalizePlayerOwnerId(player.ownerClientId) === clientId) {
          player.ownerClientId = "";
        }
      });
      const members = touchMember(currentRoom.members || room.members, clientId);
      members[clientId] = {
        ...members[clientId],
        claimedPlayerId: ""
      };
      return {
        ...currentRoom,
        members,
        players: remotePlayers
      };
    }, { applyLocally: false });
    if (!result.committed) {
      showAppAlert("退出绑定没有成功，请等待同步后重试。");
      await refreshFromRemote();
      return;
    }
    applyLocalPlayerClaim(currentPlayer.id, false);
    setSyncStatus("已同步", "ok");
  } catch (_) {
    showAppAlert("退出绑定同步失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    renderSetupPlayerInputs();
    updatePlayerBoxes();
    renderTableViewToolbar();
  }
}

async function togglePlayerClaim(playerId) {
  const player = players.find(item => item.id === playerId);
  if (!player) return;
  if (isCurrentDevicePlayer(player)) {
    await releaseCurrentPlayerIdentity();
    return;
  }
  await claimPlayerIdentity(playerId);
}

async function verifyAdminIdentity(code) {
  const normalizedCode = normalizeAccessCode(code);
  if (!isRoomMode() || !room.roomId || !normalizedCode) {
    showAppAlert("请输入管理码。");
    return false;
  }
  setMutationInProgress(true);
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !currentRoom.adminKeyHash) return undefined;
      if (!isAdminCodeValid(normalizedCode, currentRoom)) return undefined;
      const members = touchMember(currentRoom.members || room.members, clientId);
      members[clientId] = {
        ...members[clientId],
        adminVerified: true
      };
      return {
        ...currentRoom,
        members
      };
    }, { applyLocally: false });
    if (!result.committed) {
      showAppAlert("管理码不正确，或房间尚未完成同步。");
      await refreshFromRemote();
      return false;
    }
    rememberAdminCode(normalizedCode);
    const members = normalizeMembers(room.members);
    members[clientId] = {
      ...(members[clientId] || {}),
      clientId,
      adminVerified: true,
      lastSeenAt: Date.now()
    };
    room.members = members;
    setSyncStatus("已获得管理权限", "ok");
    await refreshFromRemote();
    return true;
  } catch (_) {
    showAppAlert("管理权限验证失败，请稍后再试。");
    return false;
  } finally {
    setMutationInProgress(false);
  }
}

function scheduleLobbySync() {
  if (!isRoomMode() || !room.roomId || gameStarted || handStatus !== "setup") return;
  clearTimeout(lobbySyncTimer);
  lobbySyncTimer = setTimeout(() => {
    syncLobbyState();
  }, 320);
}

async function syncLobbyState() {
  if (!isRoomMode() || !room.roomId || gameStarted || handStatus !== "setup") return true;
  if (!canCurrentClientManageRoom()) return false;
  clearTimeout(lobbySyncTimer);
  normalizeSetupPlayers();
  const nextStateVersion = stateVersion + 1;
  const nextGameState = {
    currentRound: 0,
    pot: 0,
    currentBet: 0,
    lastRaiseSize: bigBlind,
    currentPlayerIndex: -1,
    logs: room.gameState.logs,
    inProgress: false,
    gameOver: false,
    awaitingShowdown: false,
    pendingPots: [],
    selectedWinnersByPot: {},
    pendingDealPrompt: null,
    settlementPreview: null,
    nextHandApprovals: {},
    handId,
    handStatus: "setup",
    stateVersion: nextStateVersion,
    updatedBy: clientId
  };

  syncWriteInProgress = true;
  setSyncStatus("同步中...");
  renderIdentityControls();
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      const currentGameState = currentRoom?.gameState;
      const currentStatus = currentGameState
        ? String(currentGameState.handStatus || inferHandStatus(currentGameState))
        : "setup";
      const currentInProgress = Boolean(currentGameState?.inProgress);
      if (currentInProgress && currentStatus !== "setup") return undefined;

      const existingRoom = currentRoom || {};
      if (currentRoom && !canClientManageRoomData(clientId, existingRoom)) return undefined;
      return {
        ...existingRoom,
        mode: ROOM_MODES.room,
        operator: existingRoom.operator || room.operator || clientId,
        hostClientId: getRoomHostId(existingRoom, room.hostClientId || clientId),
        adminKeyHash: existingRoom.adminKeyHash || room.adminKeyHash || "",
        adminPlayerIds: normalizeAdminPlayerIds(existingRoom.adminPlayerIds || room.adminPlayerIds),
        members: touchMember(existingRoom.members || room.members, clientId),
        gameState: nextGameState,
        players
      };
    }, { applyLocally: false });

    if (!result.committed) {
      setSyncStatus("房间已进入牌局，等待同步", "error");
      const refreshed = await refreshFromRemote();
      if (!refreshed) syncReady = false;
      return false;
    }

    stateVersion = nextStateVersion;
    room.gameState = nextGameState;
    room.members = touchMember(room.members, clientId);
    syncReady = true;
    setSyncStatus("已同步", "ok");
    return true;
  } catch (_) {
    setSyncStatus("同步失败", "error");
    return false;
  } finally {
    syncWriteInProgress = false;
    renderIdentityControls();
  }
}

function updateSetupActionState() {
  const canManage = canCurrentClientManageRoom();
  startGameBtn.disabled = !canManage || players.length < 2;
  addPlayerBtn.disabled = !canManage || players.length >= MAX_PLAYERS;
  addPlayerBtn.textContent = players.length >= MAX_PLAYERS ? `最多 ${MAX_PLAYERS} 人` : "添加玩家";
  if (!canManage && isRoomMode()) {
    addPlayerBtn.textContent = "等待管理员添加";
  }
  renderIdentityControls();
}

function renderSetupPlayerInputs() {
  if (!playerNameInputsContainer || gameStarted) return;
  playerNameInputsContainer.querySelectorAll(".player-div").forEach(row => row.remove());
  normalizeSetupPlayers();

  players.forEach((player, index) => {
    const playerDiv = document.createElement("div");
    playerDiv.classList.add("player-div");
    if (isRoomMode()) playerDiv.classList.add("room-claim-enabled");
    playerDiv.dataset.playerId = player.id;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = `输入玩家 ${index + 1} 昵称`;
    nameInput.value = player.name || "";
    nameInput.classList.add("player-name-input");
    nameInput.disabled = !canCurrentClientManageRoom();
    nameInput.addEventListener("input", () => {
      player.name = nameInput.value;
    });
    nameInput.addEventListener("change", () => {
      player.name = nameInput.value.trim();
      scheduleLobbySync();
    });

    const chipsInput = document.createElement("input");
    chipsInput.type = "text";
    chipsInput.inputMode = "numeric";
    chipsInput.placeholder = "初始筹码";
    chipsInput.value = player.chips;
    chipsInput.classList.add("player-chips-input");
    chipsInput.disabled = !canCurrentClientManageRoom();
    chipsInput.addEventListener("input", () => {
      player.chips = toPositiveInteger(chipsInput.value, 0);
    });
    chipsInput.addEventListener("change", () => {
      player.chips = toPositiveInteger(chipsInput.value, toPositiveInteger(initialChipsInput.value, 1000));
      chipsInput.value = player.chips;
      scheduleLobbySync();
    });

    const claimBtn = isRoomMode()
      ? createButton(getSetupClaimLabel(player), () => {
        togglePlayerClaim(player.id);
      }, !canCurrentClientModifyClaims(), "claim-player-button")
      : null;
    if (claimBtn && isCurrentDevicePlayer(player)) claimBtn.classList.add("claimed");

    const delBtn = createButton("删除", () => {
      if (!canCurrentClientManageRoom()) {
        showAppAlert("只有管理员可以删除玩家。");
        return;
      }
      players = players.filter(item => item.id !== player.id);
      normalizeSetupPlayers();
      renderSetupPlayerInputs();
      updateSetupActionState();
      scheduleLobbySync();
    }, !canCurrentClientManageRoom(), "delete-player-button danger");

    playerDiv.append(nameInput, chipsInput);
    if (claimBtn) playerDiv.appendChild(claimBtn);
    playerDiv.appendChild(delBtn);
    playerNameInputsContainer.appendChild(playerDiv);
  });
  updateSetupActionState();
}

addPlayerBtn.addEventListener("click", () => {
  if (!canCurrentClientManageRoom()) {
    showAppAlert("只有管理员可以添加玩家。");
    return;
  }
  if (players.length >= MAX_PLAYERS) {
    showAppAlert(`最多支持 ${MAX_PLAYERS} 名玩家`);
    updateSetupActionState();
    return;
  }

  players.push(createSetupPlayer());
  renderSetupPlayerInputs();
  updateSetupActionState();
  scheduleLobbySync();
});
renderSetupPlayerInputs();
updateSetupActionState();
syncReady = true;
setSyncStatus("本地模式");
renderIdentityControls();

// ----------------------
// 开始游戏逻辑
// ----------------------
startGameBtn.addEventListener("click", async () => {
  if (mutationInProgress) return;
  if (!canCurrentClientManageRoom()) {
    showAppAlert("只有管理员可以开始牌局。");
    return;
  }
  setMutationInProgress(true);

  try {
    const roomId = normalizeRoomId(roomIdInput.value);
    if (isRoomMode()) {
      if (roomId) {
        joinRoom(roomId);
        const remoteExists = await refreshFromRemote();
        if (!remoteExists) {
          room.roomId = roomId;
          createRoom();
          roomIdInput.value = room.roomId;
          await syncLobbyState();
        } else if (!canCurrentClientManageRoom()) {
          showAppAlert("只有管理员可以开始牌局。");
          return;
        }
        const remoteGameState = await getRemoteGameState();
        const remoteStatus = remoteGameState
          ? String(remoteGameState.handStatus || inferHandStatus(remoteGameState))
          : "setup";
        if (remoteGameState && remoteStatus !== "setup") {
          showAppAlert("该房间已有牌局状态，请等待同步完成，不要从本地设置页重新开始");
          return;
        }
      } else {
        createRoom();
        roomIdInput.value = room.roomId;
        await syncLobbyState();
      }
    } else {
      stopRoomListener();
      room.roomId = "";
      room.mode = ROOM_MODES.local;
      room.operator = clientId;
      room.hostClientId = clientId;
      room.members = createMembersMap(clientId);
      roomIdInput.value = "";
      syncReady = true;
      setSyncStatus("本地模式");
    }

    normalizeSetupPlayers();
    if (players.length < 2) {
      showAppAlert("至少需要两个玩家开始游戏");
      return;
    }
    if (players.length > MAX_PLAYERS) {
      showAppAlert(`最多支持 ${MAX_PLAYERS} 名玩家`);
      return;
    }

    bigBlind = toPositiveInteger(bigBlindInput.value, 20);
    smallBlind = Math.floor(bigBlind / 2);
    players = players.map((player, index) => ({
      id: String(player.id || createPlayerId()),
      name: String(player.name || "").trim() || `玩家${index + 1}`,
      seatIndex: index,
      seatStatus: "seated",
      chips: toPositiveInteger(player.chips, 1000),
      folded: false,
      dealer: index === 0,
      ownerClientId: normalizePlayerOwnerId(player.ownerClientId),
      playerKeyHash: String(player.playerKeyHash || ""),
      bet: 0,
      totalBet: 0,
      allIn: false,
      acted: false,
      position: ""
    }));

    selectedWinnersByPot = {};
    pendingDealPrompt = null;
    settlementPreview = null;
    nextHandApprovals = {};
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
  return buildEligibleOrderFrom(startIndex, eligibleIndices);
}

function getHandLayout(dealerIndex, list = players) {
  return buildHandLayout(dealerIndex, list);
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
  nextHandApprovals = {};
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

  updateGameLog(`轮到 ${getPlayerIdentityLabel(players[currentPlayerIndex])} 行动`);
  updateFirebaseState();
}

// ----------------------
// playerAction：处理各操作（check/call/raise/fold）
// ----------------------
async function playerAction(action, index, amount = 0) {
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (mutationInProgress || gameOver || awaitingShowdown || handStatus !== "playing") {
    showAppAlert("当前手牌已结束或正在等待结算");
    return;
  }
  if (index !== currentPlayerIndex) {
    showAppAlert("当前不是你的回合！");
    return;
  }

  const player = players[index];
  if (!canCurrentClientControlPlayer(player)) {
    showAppAlert("你不能操作这个玩家。");
    return;
  }
  if (!canAct(player)) {
    showAppAlert("该玩家当前不能行动");
    return;
  }

  if (action === "fold") {
    const confirmed = await showAppConfirm(`${getPlayerIdentityLabel(player)} 确认弃牌？`, {
      title: "确认 Fold",
      confirmLabel: "确认弃牌",
      danger: true
    });
    if (!confirmed) return;
  }

  setMutationInProgress(true);
  const remoteGameState = await getRemoteGameState();
  if (!remoteGameState && room.roomId) {
    setMutationInProgress(false);
    showAppAlert("还没有完成同步，不能操作");
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
      showAppAlert("牌局状态已在其他设备更新，请等待同步后再操作");
      return;
    }
  }

  let logAction = action;
  batchingStateUpdate = true;

  switch (action) {
    case "check":
      if (player.bet < currentBet) {
        showAppAlert("已有下注，不能选择 Check！");
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
        showAppAlert("当前无需跟注，可以选择 Check");
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
        showAppAlert(validation.message);
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
      showAppAlert("无效操作！");
      batchingStateUpdate = false;
      setMutationInProgress(false);
      return;
  }

  updateGameLog(`${getPlayerIdentityLabel(player)} 选择了 ${logAction}，奖池：${pot}`);
  nextPlayer();
  updateGameInfo();
  updatePlayerBoxes();
  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["playing"],
    expectedStateVersion,
    remoteGuard: (currentRoom) => {
      const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
      const remotePlayer = remotePlayers[index];
      return Boolean(remotePlayer && canClientControlPlayerInRoom(clientId, remotePlayer, currentRoom));
    }
  });
  setMutationInProgress(false);
  if (!saved) {
    showAppAlert("操作没有同步成功，已恢复到最新远端状态");
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
  updateGameLog(`轮到 ${getPlayerIdentityLabel(players[currentPlayerIndex])} 行动`);
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
    showAppAlert("当前没有等待确认的发牌提示");
    return;
  }
  if (!canCurrentClientConfirmDeal()) {
    showAppAlert("只有本局 Dealer 可以确认发牌；未绑定 Dealer 由管理员代管。");
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
    expectedStateVersion,
    remoteGuard: (currentRoom) => {
      const remoteDealer = normalizeIncomingPlayers(currentRoom.players).find(player => player.dealer);
      return canClientControlPlayerInRoom(clientId, remoteDealer, currentRoom);
    }
  });
  setMutationInProgress(false);
  if (!saved) {
    showAppAlert("发牌确认没有同步成功，已恢复到最新远端状态");
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
  nextHandApprovals = {};
  const bustedNames = markZeroChipPlayersBusted();
  gameOver = true;
  handStatus = "settled";

  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`${winner ? getPlayerIdentityLabel(winner) : "无人"} 赢得奖池 ${wonAmount}`);
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
  nextHandApprovals = {};

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
      showAppAlert(`请为奖池 ${index + 1} 至少选择一位赢家`);
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
    approvals: {},
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
      lines.push(`${getPlayerIdentityLabel(winner)} 获得 ${payout.amount} 筹码`);
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
      bustedNames.push(getPlayerIdentityLabel(player));
    }
  });
  return bustedNames;
}

async function confirmShowdown() {
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;
  if (isInteractionLocked() || handStatus !== "showdown") {
    showAppAlert("当前手牌已不在摊牌结算阶段");
    return;
  }

  const settlementPlan = buildSettlementPlan();
  if (!settlementPlan) return;

  setMutationInProgress(true);
  const canSettle = await isRemoteHandStill(expectedHandId, ["showdown"]);
  if (!canSettle) {
    setMutationInProgress(false);
    showAppAlert("其他设备已经更新结算状态，请等待同步最新状态");
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
    showAppAlert("结算预览没有同步成功，已恢复到最新远端状态");
  }
}

async function cancelSettlementPreview() {
  const preview = settlementPreview;
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (isSharedPromptActionLocked() || handStatus !== "settlementPreview" || !preview) {
    showAppAlert("当前没有可取消的结算预览");
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
    showAppAlert("取消结算预览没有同步成功，已恢复到最新远端状态");
  }
}

async function confirmSettlementPreview() {
  if (isRoomMode()) {
    await approveSettlementPreview();
    return;
  }
  await finalizeSettlementPreview();
}

async function approveSettlementPreview() {
  const preview = settlementPreview;
  if (isSharedPromptActionLocked() || handStatus !== "settlementPreview" || !preview) {
    showAppAlert("当前没有可确认的结算预览");
    return;
  }

  const requiredApprovers = getSettlementApproverIds();
  const progress = getApprovalProgress(preview.approvals, requiredApprovers);
  if (!requiredApprovers.includes(clientId)) {
    showAppAlert("你不是本手需要确认的玩家。");
    return;
  }
  if (progress.complete) {
    await finalizeSettlementPreview();
    return;
  }
  if (progress.approved[clientId]) {
    showAppAlert("你已经确认过，正在等待其他玩家。");
    return;
  }

  setMutationInProgress(true);
  let completeAfterCommit = false;
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !currentRoom.gameState || !Array.isArray(currentRoom.players)) return undefined;
      const currentGameState = currentRoom.gameState;
      const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
      if (currentStatus !== "settlementPreview" || !currentGameState.settlementPreview) return undefined;

      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview);
      if (!remotePreview) return undefined;
      const remoteRequiredApprovers = getSettlementApproverIds(remotePlayers, currentRoom);
      if (!remoteRequiredApprovers.includes(clientId)) return undefined;

      remotePreview.approvals = {
        ...normalizeApprovalMap(remotePreview.approvals),
        [clientId]: true
      };
      const remoteProgress = getApprovalProgress(remotePreview.approvals, remoteRequiredApprovers);
      completeAfterCommit = remoteProgress.complete;
      const nextStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0) + 1;
      const logs = Array.isArray(currentGameState.logs) ? currentGameState.logs.map(String) : [];
      logs.push(`${getApprovalPlayerLabelForClient(clientId, remotePlayers, currentRoom)} 已确认结算（${remoteProgress.approvedCount}/${remoteProgress.requiredCount}）`);

      return {
        ...currentRoom,
        members: touchMember(currentRoom.members || room.members, clientId),
        gameState: {
          ...currentGameState,
          settlementPreview: remotePreview,
          logs,
          stateVersion: nextStateVersion,
          updatedBy: clientId
        }
      };
    }, { applyLocally: false });

    if (!result.committed) {
      const refreshed = await refreshFromRemote();
      if (!refreshed) syncReady = false;
      showAppAlert("结算确认没有成功，请等待同步后重试。");
      return;
    }

    syncReady = true;
    setSyncStatus("已同步", "ok");
    await refreshFromRemote();
    if (completeAfterCommit) {
      setMutationInProgress(false);
      await finalizeSettlementPreview();
      return;
    }
  } catch (_) {
    showAppAlert("结算确认同步失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
  }
}

async function finalizeSettlementPreview() {
  const preview = settlementPreview;
  const expectedHandId = handId;
  const expectedStateVersion = stateVersion;

  if (isSharedPromptActionLocked() || handStatus !== "settlementPreview" || !preview) {
    showAppAlert("当前没有可确认的结算预览");
    return;
  }
  if (isRoomMode()) {
    const requiredApprovers = getSettlementApproverIds();
    const progress = getApprovalProgress(preview.approvals, requiredApprovers);
    if (!progress.complete) {
      showAppAlert(getApprovalStatusText(preview.approvals, requiredApprovers));
      return;
    }
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
  nextHandApprovals = {};
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
    expectedStateVersion,
    remoteGuard: (currentRoom, currentGameState) => {
      if (!isRoomMode()) return true;
      const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
      const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview);
      const remoteRequiredApprovers = getSettlementApproverIds(remotePlayers, currentRoom);
      return getApprovalProgress(remotePreview?.approvals, remoteRequiredApprovers).complete;
    }
  });
  setMutationInProgress(false);
  if (saved) {
    showNextHandButton();
  } else {
    showAppAlert("结算没有同步成功，已恢复到最新远端状态");
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
    ownerClientId: normalizePlayerOwnerId(player.ownerClientId),
    playerKeyHash: String(player.playerKeyHash || ""),
    dealer: Boolean(player.dealer)
  }));
}

function getNextPlayerIdFromDraft() {
  const usedIds = new Set(tableDraft.map(player => player.id));
  let id = createPlayerId();
  while (usedIds.has(id)) {
    id = createPlayerId();
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
    ownerClientId: normalizePlayerOwnerId(draftPlayer?.ownerClientId),
    playerKeyHash: String(draftPlayer?.playerKeyHash || ""),
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
    `Button ${getPlayerIdentityLabel(normalized[layout.dealerIndex], layout.dealerIndex, normalized)}`,
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

function canEditTableNow() {
  if (!canCurrentClientManageRoom()) return false;
  return handStatus === "setup" || handStatus === "settled";
}

function openTableManager() {
  if (isLocalMode() && handStatus !== "settled") {
    showAppAlert("本地模式的牌桌管理只在本手结算完成后开放。");
    return;
  }
  if (isRoomMode() && !room.roomId) {
    showAppAlert("请先创建或加入房间。");
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
  eyebrow.textContent = "Room Seats";
  copy.appendChild(eyebrow);

  const title = document.createElement("h3");
  title.id = "table-manager-title";
  title.textContent = "席位与身份管理";
  copy.appendChild(title);
  copy.appendChild(createParagraph(isRoomMode()
    ? "玩家可在这里换设备接管身份；管理员可在开局前或两手牌之间调整牌桌。"
    : "调整座次、筹码和离桌/回桌状态；保存后只影响下一手。"));
  header.appendChild(copy);

  const closeButton = createButton("×", closeTableManager, false, "table-manager-close");
  closeButton.setAttribute("aria-label", "关闭牌桌管理");
  header.appendChild(closeButton);
  tableManagerPanel.appendChild(header);

  if (isRoomMode()) {
    tableManagerPanel.appendChild(createIdentityManagerPanel());
  }

  const summary = document.createElement("div");
  summary.className = "table-manager-summary";
  summary.textContent = canEditTableNow()
    ? getTableDraftSummary()
    : "身份绑定可随时调整；筹码、座次、删除玩家只在开局前或两手牌之间开放。";
  tableManagerPanel.appendChild(summary);

  const rows = document.createElement("div");
  rows.className = "table-manager-rows";
  tableDraft.forEach((draftPlayer, index) => {
    rows.appendChild(createTableManagerRow(draftPlayer, index));
  });
  tableManagerPanel.appendChild(rows);

  const canEdit = canEditTableNow();
  const addButton = createButton("添加玩家", () => {
    if (tableDraft.length >= MAX_PLAYERS) {
      showAppAlert(`最多支持 ${MAX_PLAYERS} 名玩家`);
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
      ownerClientId: "",
      playerKeyHash: "",
      dealer: false
    });
    renderTableManager();
  }, isSharedPromptActionLocked() || !canEdit || tableDraft.length >= MAX_PLAYERS, "prompt-secondary");
  if (tableDraft.length >= MAX_PLAYERS) {
    addButton.textContent = `最多 ${MAX_PLAYERS} 人`;
  } else if (!canEdit) {
    addButton.textContent = "当前阶段不可加人";
  }

  const footer = document.createElement("div");
  footer.className = "table-manager-footer";
  footer.appendChild(addButton);

  const actionGroup = document.createElement("div");
  actionGroup.className = "table-manager-save-actions";
  actionGroup.appendChild(createButton("取消", closeTableManager, false, "prompt-secondary"));
  actionGroup.appendChild(createButton("保存牌桌", () => saveTableDraft({ startNextHand: false }), isSharedPromptActionLocked() || !canEdit, "prompt-secondary"));
  actionGroup.appendChild(createButton("保存并开始下一局", () => saveTableDraft({ startNextHand: true }), isSharedPromptActionLocked() || !canEdit || handStatus !== "settled" || getEligiblePlayerIndices(tableDraft.map(normalizeDraftPlayer)).length < 2, "prompt-primary"));
  footer.appendChild(actionGroup);
  tableManagerPanel.appendChild(footer);
}

function createIdentityManagerPanel() {
  const panel = document.createElement("div");
  panel.className = "identity-manager-panel";

  const currentPlayer = getCurrentDevicePlayer();
  const currentIndex = currentPlayer ? players.indexOf(currentPlayer) : -1;
  const isAdmin = canCurrentClientManageRoom();
  const summary = document.createElement("div");
  summary.className = "identity-manager-summary";
  const title = document.createElement("strong");
  title.textContent = currentPlayer
    ? `当前身份：${getPlayerIdentityLabel(currentPlayer, currentIndex)}${isAdmin ? " · 管理员" : ""}`
    : isAdmin
      ? "当前身份：管理员旁观"
      : "当前身份：旁观";
  const detail = document.createElement("span");
  detail.textContent = `房间 ${room.roomId || "-"} · 设备 ${getClientShortId()}`;
  summary.append(title, detail);
  panel.appendChild(summary);

  const actions = document.createElement("div");
  actions.className = "identity-manager-actions";
  if (currentPlayer) {
    actions.appendChild(createButton("退出当前玩家", releaseCurrentPlayerIdentity, isSharedPromptActionLocked(), "table-chip-button"));
  }

  if (!isAdmin) {
    const adminInput = document.createElement("input");
    adminInput.type = "text";
    adminInput.inputMode = "text";
    adminInput.placeholder = "输入管理码";
    adminInput.autocomplete = "one-time-code";
    adminInput.value = getRememberedAdminCode();
    adminInput.className = "identity-code-input";
    actions.appendChild(adminInput);
    actions.appendChild(createButton("获得管理权限", async () => {
      const ok = await verifyAdminIdentity(adminInput.value);
      if (ok) renderTableManager();
    }, isSharedPromptActionLocked(), "table-chip-button"));
  } else {
    actions.appendChild(createButton("清除本机管理码", () => {
      forgetAdminCode();
      showAppAlert("已清除这台设备保存的管理码。当前会话中的管理权限不会被立即撤销。");
      renderIdentityControls();
      renderTableManager();
    }, false, "table-chip-button"));
  }

  panel.appendChild(actions);
  return panel;
}

function createTableManagerRow(draftPlayer, index) {
  const row = document.createElement("div");
  row.className = "table-manager-row";
  if (!isEligibleForNextHand(normalizeDraftPlayer(draftPlayer, index))) {
    row.classList.add("is-inactive");
  }
  const canEdit = canEditTableNow();

  const seat = document.createElement("div");
  seat.className = "table-seat-cell";
  const seatLabel = document.createElement("strong");
  seatLabel.textContent = `座位 ${index + 1}`;
  seat.appendChild(seatLabel);
  const moveActions = document.createElement("div");
  moveActions.className = "table-seat-actions";
  moveActions.appendChild(createButton("↑", () => moveDraftPlayer(index, -1), !canEdit || index === 0, "table-icon-button"));
  moveActions.appendChild(createButton("↓", () => moveDraftPlayer(index, 1), !canEdit || index === tableDraft.length - 1, "table-icon-button"));
  seat.appendChild(moveActions);
  row.appendChild(seat);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = draftPlayer.name;
  nameInput.setAttribute("aria-label", `座位 ${index + 1} 玩家名`);
  nameInput.disabled = !canEdit;
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
  chipsInput.disabled = !canEdit;
  chipsInput.addEventListener("change", () => {
    setDraftChips(index, chipsInput.value);
  });
  chipsCell.appendChild(chipsInput);

  const chipActions = document.createElement("div");
  chipActions.className = "table-chip-actions";
  chipActions.appendChild(createButton("-100", () => adjustDraftChips(index, -100), !canEdit || draftPlayer.chips <= 0, "table-chip-button"));
  chipActions.appendChild(createButton("+100", () => adjustDraftChips(index, 100), !canEdit, "table-chip-button"));
  chipActions.appendChild(createButton("+500", () => adjustDraftChips(index, 500), !canEdit, "table-chip-button"));
  chipActions.appendChild(createButton("+1000", () => adjustDraftChips(index, 1000), !canEdit, "table-chip-button"));
  chipsCell.appendChild(chipActions);
  row.appendChild(chipsCell);

  const statusCell = document.createElement("div");
  statusCell.className = "table-status-cell";
  const statusSelect = document.createElement("select");
  statusSelect.setAttribute("aria-label", `${getPlayerName(draftPlayer)} 状态`);
  statusSelect.disabled = !canEdit;
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
    quickActions.appendChild(createButton("坐出", () => setDraftStatus(index, "sittingOut"), !canEdit, "table-chip-button"));
    quickActions.appendChild(createButton("离桌", () => setDraftStatus(index, "left"), !canEdit, "table-chip-button table-danger-button"));
  } else {
    quickActions.appendChild(createButton("回桌", () => {
      if (tableDraft[index].chips <= 0) {
        tableDraft[index].chips = toPositiveInteger(initialChipsInput.value, 1000);
      }
      setDraftStatus(index, "seated");
    }, !canEdit, "table-chip-button"));
  }
  quickActions.appendChild(createButton("删除", () => deleteDraftPlayer(index), !canEdit || tableDraft.length <= 2, "table-chip-button table-danger-button"));
  statusCell.appendChild(quickActions);
  row.appendChild(statusCell);

  if (isRoomMode()) {
    row.appendChild(createSeatIdentityCell(draftPlayer, index));
  }

  return row;
}

function createSeatIdentityCell(draftPlayer, index) {
  const cell = document.createElement("div");
  cell.className = "table-identity-cell";
  const savedPlayer = players.find(item => item.id === draftPlayer.id);
  const player = savedPlayer || draftPlayer;
  const ownerId = normalizePlayerOwnerId(player.ownerClientId);
  const adminIds = normalizeAdminPlayerIds(room.adminPlayerIds);
  const status = document.createElement("span");
  status.className = "table-identity-status";
  status.textContent = isCurrentDevicePlayer(player)
    ? "当前设备"
    : ownerId
      ? `已绑定 ${getClientShortId(ownerId)}`
      : "未绑定";
  if (adminIds.includes(draftPlayer.id)) {
    status.textContent += " · 管理员";
  }
  cell.appendChild(status);

  const codeInput = document.createElement("input");
  codeInput.type = "text";
  codeInput.inputMode = "text";
  codeInput.autocomplete = "one-time-code";
  codeInput.placeholder = player.playerKeyHash ? "玩家码" : "首次绑定自动生成";
  codeInput.value = getRememberedPlayerCode(player.id);
  codeInput.className = "identity-code-input";
  cell.appendChild(codeInput);

  const actions = document.createElement("div");
  actions.className = "table-identity-actions";
  actions.appendChild(createButton(isCurrentDevicePlayer(player) ? "已绑定" : "接管", async () => {
    if (isCurrentDevicePlayer(player)) return;
    await claimPlayerIdentity(draftPlayer.id, { code: codeInput.value });
    renderTableManager();
  }, isSharedPromptActionLocked() || !savedPlayer || isCurrentDevicePlayer(player), "table-chip-button"));

  if (canCurrentClientManageRoom()) {
    actions.appendChild(createButton("强制接管", async () => {
      await claimPlayerIdentity(draftPlayer.id, { forceAdmin: true, announceCode: false });
      renderTableManager();
    }, isSharedPromptActionLocked() || !savedPlayer, "table-chip-button"));
    actions.appendChild(createButton("重置玩家码", async () => {
      await resetPlayerCode(draftPlayer.id);
    }, isSharedPromptActionLocked() || !savedPlayer, "table-chip-button"));
    const isAdminPlayer = adminIds.includes(draftPlayer.id);
    actions.appendChild(createButton(isAdminPlayer ? "撤销管理" : "设为管理", async () => {
      await togglePlayerAdmin(draftPlayer.id, !isAdminPlayer);
    }, isSharedPromptActionLocked() || !savedPlayer, "table-chip-button"));
  }
  cell.appendChild(actions);
  return cell;
}

function moveDraftPlayer(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= tableDraft.length) return;
  const [player] = tableDraft.splice(index, 1);
  tableDraft.splice(nextIndex, 0, player);
  renderTableManager();
}

async function resetPlayerCode(playerId) {
  if (!canCurrentClientManageRoom()) return;
  const player = players.find(item => item.id === playerId);
  if (!player || !room.roomId) return;
  const nextCode = createAccessCode();
  const nextHash = hashAccessCode(nextCode, getPlayerCodeSalt(playerId));
  setMutationInProgress(true);
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      if (!canClientManageRoomData(clientId, currentRoom)) return undefined;
      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const target = remotePlayers.find(item => item.id === playerId);
      if (!target) return undefined;
      target.playerKeyHash = nextHash;
      return {
        ...currentRoom,
        players: remotePlayers,
        members: touchMember(currentRoom.members || room.members, clientId)
      };
    }, { applyLocally: false });
    if (!result.committed) {
      showAppAlert("重置玩家码没有成功，请等待同步后重试。");
      await refreshFromRemote();
      return;
    }
    rememberPlayerCode(playerId, nextCode);
    showAppAlert(`${getPlayerIdentityLabel(player)} 的新玩家码：${nextCode}`, "玩家码已重置");
    await refreshFromRemote();
  } catch (_) {
    showAppAlert("重置玩家码失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    if (tableManagerOpen) renderTableManager();
  }
}

async function togglePlayerAdmin(playerId, shouldGrant) {
  if (!canCurrentClientManageRoom() || !room.roomId) return;
  setMutationInProgress(true);
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      if (!canClientManageRoomData(clientId, currentRoom)) return undefined;
      if (!currentRoom.players.some(player => String(player?.id) === playerId)) return undefined;
      const currentIds = normalizeAdminPlayerIds(currentRoom.adminPlayerIds);
      const nextIds = shouldGrant
        ? [...new Set([...currentIds, playerId])]
        : currentIds.filter(id => id !== playerId);
      return {
        ...currentRoom,
        adminPlayerIds: nextIds,
        members: touchMember(currentRoom.members || room.members, clientId)
      };
    }, { applyLocally: false });
    if (!result.committed) {
      showAppAlert("管理员权限更新没有成功，请等待同步后重试。");
      await refreshFromRemote();
      return;
    }
    await refreshFromRemote();
  } catch (_) {
    showAppAlert("管理员权限更新失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    if (tableManagerOpen) renderTableManager();
  }
}

async function deleteDraftPlayer(index) {
  if (!canEditTableNow() || tableDraft.length <= 2) return;
  const target = tableDraft[index];
  const confirmed = await showAppConfirm(`删除 ${getPlayerIdentityLabel(target, index, tableDraft)}？这只会在保存后生效。`, {
    title: "确认删除玩家",
    confirmLabel: "删除",
    danger: true
  });
  if (!confirmed) return;
  const [removed] = tableDraft.splice(index, 1);
  room.adminPlayerIds = normalizeAdminPlayerIds(room.adminPlayerIds).filter(id => id !== removed?.id);
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
  if (!canEditTableNow()) {
    showAppAlert("只有管理员可以保存牌桌管理设置。");
    return;
  }
  if (!tableDraft) {
    showAppAlert("当前不能保存牌桌管理设置");
    return;
  }

  const nextPlayers = normalizeTableDraftPlayers();
  if (nextPlayers.length > MAX_PLAYERS) {
    showAppAlert(`最多支持 ${MAX_PLAYERS} 名玩家`);
    renderTableManager();
    return;
  }

  if (startNextHand && getEligiblePlayerIndices(nextPlayers).length < 2) {
    showAppAlert("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
    renderTableManager();
    return;
  }

  if (handStatus === "setup") {
    players = nextPlayers.map((player, index) => ({
      ...player,
      folded: false,
      dealer: index === 0,
      bet: 0,
      totalBet: 0,
      allIn: false,
      acted: false,
      position: ""
    }));
    room.players = players;
    room.adminPlayerIds = normalizeAdminPlayerIds(room.adminPlayerIds)
      .filter(playerId => players.some(player => player.id === playerId));
    renderSetupPlayerInputs();
    updateSetupActionState();
    updatePlayerBoxes();
    await syncLobbyState();
    closeTableManager();
    return;
  }

  const expectedHandId = tableDraftBaseHandId;
  const expectedStateVersion = tableDraftBaseStateVersion;
  if (expectedHandId !== handId || expectedStateVersion !== stateVersion) {
    showAppAlert("牌桌已被其他设备更新，请关闭后重新打开牌桌管理。");
    closeTableManager();
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;

  players = nextPlayers;
  room.players = players;
  room.adminPlayerIds = normalizeAdminPlayerIds(room.adminPlayerIds)
    .filter(playerId => players.some(player => player.id === playerId));
  nextHandApprovals = {};
  players.forEach(player => {
    player.position = getSeatStatusLabel(player.seatStatus);
  });
  updatePlayerBoxes();
  updateGameLog(`牌桌已更新：${getTableDraftSummary()}`);

  batchingStateUpdate = false;
  const saved = await updateFirebaseState({
    expectedHandId,
    allowedStatuses: ["settled"],
    expectedStateVersion,
    remoteGuard: (currentRoom) => canClientManageRoomData(clientId, currentRoom)
  });
  setMutationInProgress(false);

  if (!saved) {
    showAppAlert("牌桌管理没有保存成功，已恢复到最新远端状态");
    return;
  }

  closeTableManager();
  if (startNextHand) {
    await approveNextHandStart(expectedHandId);
  }
}

// ----------------------
// 下一局
// ----------------------
async function approveNextHandStart(expectedHandId = handId) {
  if (isLocalMode()) {
    await resetHand(expectedHandId);
    return;
  }
  if (isInteractionLocked()) return;
  if (!gameOver || handStatus !== "settled") {
    showAppAlert("当前手牌还没有完成结算，不能确认下一局");
    return;
  }

  const requiredApprovers = getNextHandApproverIds();
  const progress = getApprovalProgress(nextHandApprovals, requiredApprovers);
  if (!requiredApprovers.includes(clientId)) {
    showAppAlert("你不是下一局需要确认的玩家。");
    return;
  }
  if (progress.complete) {
    await resetHand(expectedHandId);
    return;
  }
  if (progress.approved[clientId]) {
    showAppAlert("你已经确认过，正在等待其他玩家。");
    return;
  }

  setMutationInProgress(true);
  let completeAfterCommit = false;
  try {
    const result = await runTransaction(getRoomRef(), (currentRoom) => {
      if (!currentRoom || !currentRoom.gameState || !Array.isArray(currentRoom.players)) return undefined;
      const currentGameState = currentRoom.gameState;
      const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
      if (currentStatus !== "settled") return undefined;

      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const remoteRequiredApprovers = getNextHandApproverIds(remotePlayers, currentRoom);
      if (remoteRequiredApprovers.length < 1 || !remoteRequiredApprovers.includes(clientId)) return undefined;

      const approvals = {
        ...normalizeApprovalMap(currentGameState.nextHandApprovals),
        [clientId]: true
      };
      const remoteProgress = getApprovalProgress(approvals, remoteRequiredApprovers);
      completeAfterCommit = remoteProgress.complete;
      const nextStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0) + 1;
      const logs = Array.isArray(currentGameState.logs) ? currentGameState.logs.map(String) : [];
      logs.push(`${getApprovalPlayerLabelForClient(clientId, remotePlayers, currentRoom)} 已确认下一局（${remoteProgress.approvedCount}/${remoteProgress.requiredCount}）`);

      return {
        ...currentRoom,
        members: touchMember(currentRoom.members || room.members, clientId),
        gameState: {
          ...currentGameState,
          nextHandApprovals: approvals,
          logs,
          stateVersion: nextStateVersion,
          updatedBy: clientId
        }
      };
    }, { applyLocally: false });

    if (!result.committed) {
      const refreshed = await refreshFromRemote();
      if (!refreshed) syncReady = false;
      showAppAlert("下一局确认没有成功，请等待同步后重试。");
      return;
    }

    syncReady = true;
    setSyncStatus("已同步", "ok");
    await refreshFromRemote();
    if (completeAfterCommit) {
      setMutationInProgress(false);
      await resetHand(expectedHandId);
      return;
    }
  } catch (_) {
    showAppAlert("下一局确认同步失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
  }
}

async function resetHand(expectedHandId = handId) {
  const expectedStateVersion = stateVersion;
  if (mutationInProgress) return;
  if (!gameOver || handStatus !== "settled") {
    showAppAlert("当前手牌还没有完成结算，不能开始下一局");
    return;
  }
  if (getEligiblePlayerIndices().length < 2) {
    showAppAlert("至少需要 2 名已入座且有筹码的玩家才能开始下一局，请先打开牌桌管理补码或回桌。");
    renderNextHandButton();
    return;
  }
  if (isRoomMode()) {
    const requiredApprovers = getNextHandApproverIds();
    const progress = getApprovalProgress(nextHandApprovals, requiredApprovers);
    if (!progress.complete) {
      showAppAlert(getApprovalStatusText(nextHandApprovals, requiredApprovers));
      return;
    }
  }

  setMutationInProgress(true);
  const canReset = await isRemoteHandStill(expectedHandId, ["settled"]);
  if (!canReset) {
    setMutationInProgress(false);
    clearHandActions();
    showAppAlert("其他设备已经开始了下一局，请等待同步最新状态");
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
  nextHandApprovals = {};
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
    showAppAlert("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
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
    expectedStateVersion,
    remoteGuard: (currentRoom, currentGameState) => {
      if (!isRoomMode()) return true;
      const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
      const remoteRequiredApprovers = getNextHandApproverIds(remotePlayers, currentRoom);
      const remoteApprovals = normalizeApprovalMap(currentGameState.nextHandApprovals);
      return getApprovalProgress(remoteApprovals, remoteRequiredApprovers).complete;
    }
  });
  setMutationInProgress(false);
  if (!saved) {
    showAppAlert("下一局没有同步成功，已恢复到最新远端状态");
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
        title: `${getPlayerIdentityLabel(player)} 加注`,
        description: `需跟 ${callAmount}，最小加注 ${minimumTarget}，当前奖池 ${pot}。`,
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
  const permissionDisabled = !canCurrentClientControlPlayer(player);
  const disabled = actionDisabled || permissionDisabled;

  actions.appendChild(createButton("Check", () => playerAction("check", index), disabled || player.bet < currentBet, "action-btn action-check"));
  actions.appendChild(createButton(getCallButtonLabel(player), () => playerAction("call", index), disabled || player.bet >= currentBet, "action-btn action-call"));

  const raiseWidget = createRaisePanel(player, index, disabled);
  actions.appendChild(createButton("Raise", () => {
    raiseWidget.open();
  }, disabled || !canPlayerRaise(player), "action-btn action-raise"));
  actions.appendChild(createButton("Fold", () => playerAction("fold", index), disabled, "action-btn action-fold danger"));
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
      .map(player => getPlayerIdentityLabel(player))
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
      const option = createButton(getPlayerIdentityLabel(player), () => {
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
  const requiredApprovers = getSettlementApproverIds();
  const progress = getApprovalProgress(settlementPreview.approvals, requiredApprovers);
  const canApprove = !isRoomMode() || requiredApprovers.includes(clientId);
  const alreadyApproved = Boolean(progress.approved[clientId]);

  openTableActionDialog({
    title: "确认结算",
    description: isRoomMode()
      ? getApprovalStatusText(settlementPreview.approvals, requiredApprovers)
      : "请检查本手筹码分配。",
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
          row.appendChild(document.createTextNode(getPlayerIdentityLabel(winner)));
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
      const confirmLabel = isRoomMode() && alreadyApproved && !progress.complete ? "已确认" : "确认结算";
      actions.appendChild(createButton(confirmLabel, () => {
        closeDialog();
        confirmSettlementPreview();
      }, isSharedPromptActionLocked() || !canApprove || (alreadyApproved && !progress.complete), "prompt-primary"));
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
    operations.appendChild(createCenterOperationHeader(`${getPlayerIdentityLabel(player)} 行动`, [
      `筹码 ${player.chips}`,
      `需跟 ${getCallAmount(player)}`,
      `本轮下注 ${player.bet}`
    ]));
    operations.appendChild(createActionControls(player, index, actionDisabled, "table-center-action-buttons"));
    return operations;
  }

  if (handStatus === "waitingDeal" && pendingDealPrompt) {
    operations.appendChild(createCenterOperationHeader(pendingDealPrompt.title, [
      pendingDealPrompt.cardText,
      canCurrentClientConfirmDeal() ? "你可确认发牌" : "等待 Dealer 确认"
    ]));
    operations.appendChild(createButton("已发牌，继续", confirmDealPrompt, isSharedPromptActionLocked() || !canCurrentClientConfirmDeal(), "prompt-primary"));
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
    const requiredApprovers = getSettlementApproverIds();
    operations.appendChild(createCenterOperationHeader("等待结算确认", [
      `总额 ${settlementPreview?.total || pot}`,
      getApprovalStatusText(settlementPreview?.approvals, requiredApprovers)
    ]));
    operations.appendChild(createButton("查看并确认", openSettlementPreviewDialog, isSharedPromptActionLocked(), "prompt-primary"));
    return operations;
  }

  if (handStatus === "settled") {
    const eligibleCount = getEligiblePlayerIndices().length;
    const buttonHandId = handId;
    const nextHandApprovers = getNextHandApproverIds();
    const nextHandProgress = getApprovalProgress(nextHandApprovals, nextHandApprovers);
    const canApproveNextHand = isLocalMode() || nextHandApprovers.includes(clientId);
    const alreadyApprovedNextHand = Boolean(nextHandProgress.approved[clientId]);
    operations.appendChild(createCenterOperationHeader("本手已结算", [
      `下一局可参与 ${eligibleCount} 人`,
      isRoomMode() ? getApprovalStatusText(nextHandApprovals, nextHandApprovers) : "本地可直接开始"
    ]));
    const group = document.createElement("div");
    group.className = "table-center-action-buttons table-center-next-buttons";
    group.appendChild(createButton("席位管理", openTableManager, isInteractionLocked() || (isLocalMode() && !canCurrentClientManageRoom()), "table-manager-button"));
    const nextHandLabel = isRoomMode() && alreadyApprovedNextHand && !nextHandProgress.complete ? "已确认" : "确认下一局";
    group.appendChild(createButton(isLocalMode() ? "开始下一局" : nextHandLabel, () => {
      approveNextHandStart(buttonHandId);
    }, isInteractionLocked() || eligibleCount < 2 || !canApproveNextHand || (alreadyApprovedNextHand && !nextHandProgress.complete), "next-hand-button"));
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

// Visual seat slots, ordered from the bottom-center seat clockwise around the table.
// Slot 0 is always the "my player at bottom" anchor; adjust these arrays directly
// when tuning the table layout.
const TABLE_SEAT_LAYOUTS = {
  1: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93)
  ],
  2: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(50, 14, "seat-top", 50, 7)
  ],
  3: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(16, 22, "seat-left", 23, 22),
    createSeatPoint(84, 22, "seat-right", 77, 22)
  ],
  4: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(12, 50, "seat-left", 21, 72),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(88, 50, "seat-right", 79, 28)
  ],
  5: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(16, 62, "seat-left", 20, 75),
    createSeatPoint(24, 22, "seat-top", 23, 17.5),
    createSeatPoint(76, 22, "seat-top", 77, 17.5),
    createSeatPoint(84, 62, "seat-right", 80, 75)
  ],
  6: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(20, 78, "seat-bottom", 23, 75),
    createSeatPoint(20, 22, "seat-top", 23, 25),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(80, 22, "seat-top", 77, 25),
    createSeatPoint(80, 78, "seat-bottom", 77, 75)
  ],
  7: [
    createSeatPoint(50, 88, "seat-bottom", 50, 93),
    createSeatPoint(28, 84, "seat-bottom", 23, 75),
    createSeatPoint(12, 42, "seat-left", 18, 25),
    createSeatPoint(35, 14, "seat-top", 25, 10),
    createSeatPoint(65, 14, "seat-top", 75, 10),
    createSeatPoint(88, 42, "seat-right", 82, 25),
    createSeatPoint(72, 84, "seat-bottom", 77, 75)
  ],
  8: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(22, 80, "seat-bottom", 23, 75),
    createSeatPoint(12, 50, "seat-left", 21, 28),
    createSeatPoint(22, 20, "seat-top", 25, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 75, 17.5),
    createSeatPoint(88, 50, "seat-right", 79, 28),
    createSeatPoint(78, 80, "seat-bottom", 77, 75)
  ],
  9: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 54, "seat-left", 21, 72),
    createSeatPoint(22, 20, "seat-top", 27, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(78, 20, "seat-top", 73, 17.5),
    createSeatPoint(88, 38, "seat-right", 79, 28),
    createSeatPoint(88, 68, "seat-right", 79, 72),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5)
  ],
  10: [
    createSeatPoint(50, 86, "seat-bottom", 50, 93),
    createSeatPoint(24, 82, "seat-bottom", 27, 82.5),
    createSeatPoint(12, 66, "seat-left", 21, 72),
    createSeatPoint(12, 34, "seat-left", 21, 28),
    createSeatPoint(24, 18, "seat-top", 27, 17.5),
    createSeatPoint(50, 14, "seat-top", 50, 7),
    createSeatPoint(76, 18, "seat-top", 73, 17.5),
    createSeatPoint(88, 34, "seat-right", 79, 28),
    createSeatPoint(88, 66, "seat-right", 79, 72),
    createSeatPoint(76, 82, "seat-bottom", 73, 82.5)
  ]
};

function getSeatLayout(count) {
  return TABLE_SEAT_LAYOUTS[Math.min(Math.max(count, 1), MAX_PLAYERS)] || TABLE_SEAT_LAYOUTS[1];
}

function normalizeRotationOffset(length) {
  if (length <= 0) return 0;
  return ((tableViewRotationOffset % length) + length) % length;
}

function getVisualSeatCoordinates(playerIndex, count) {
  const layout = getSeatLayout(count);
  if (count <= 1) return layout[0];

  const currentDevicePlayerIndex = getCurrentDevicePlayerIndex();
  const manualOffset = normalizeRotationOffset(count);
  const anchorPlayerIndex = isRoomMode() && currentDevicePlayerIndex >= 0
    ? currentDevicePlayerIndex
    : 0;
  const visualIndex = (playerIndex - anchorPlayerIndex + manualOffset + count) % count;
  return layout[visualIndex];
}

function getCompactPlayerStatus(player) {
  if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
  if (player.folded) return "弃牌";
  if (player.allIn) return "All In";
  if (players.indexOf(player) === currentPlayerIndex) return "行动中";
  if (player.acted) return "已行动";
  return "等待";
}

function normalizeApprovalMap(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([approverId, approved]) => normalizePlayerOwnerId(approverId) && Boolean(approved))
    .map(([approverId]) => [normalizePlayerOwnerId(approverId), true]));
}

function getApprovalPlayerLabelForClient(approverId, list = players, roomData = room) {
  const controlledPlayers = list
    .map((player, index) => ({ player, index }))
    .filter(({ player }) => getPlayerControllerId(player, roomData) === approverId);
  if (controlledPlayers.length > 0) {
    return controlledPlayers
      .map(({ player, index }) => getPlayerCompactIdentityLabel(player, index, list))
      .join("、");
  }
  if (approverId === getHostClientId(roomData)) return "管理员";
  if (approverId === clientId) return "我";
  return `设备 ${getClientShortId(approverId)}`;
}

function getUniqueApproverIdsForPlayers(list, roomData = room) {
  return [...new Set(list.map(player => getPlayerControllerId(player, roomData)).filter(Boolean))];
}

function getSettlementApprovalPlayers(list = players) {
  return list.filter(player => {
    return player.seatStatus === "seated" || player.totalBet > 0 || player.folded || player.allIn;
  });
}

function getSettlementApproverIds(list = players, roomData = room) {
  return getUniqueApproverIdsForPlayers(getSettlementApprovalPlayers(list), roomData);
}

function getNextHandApproverIds(list = players, roomData = room) {
  return getUniqueApproverIdsForPlayers(list.filter(isEligibleForNextHand), roomData);
}

function getApprovalProgress(approvals, requiredIds) {
  const normalizedApprovals = normalizeApprovalMap(approvals);
  const approvedCount = requiredIds.filter(approverId => normalizedApprovals[approverId]).length;
  return {
    approvedCount,
    requiredCount: requiredIds.length,
    complete: requiredIds.length > 0 && approvedCount >= requiredIds.length,
    approved: normalizedApprovals
  };
}

function getApprovalStatusText(approvals, requiredIds, list = players) {
  const progress = getApprovalProgress(approvals, requiredIds);
  if (requiredIds.length === 0) return "无需确认";
  const pending = requiredIds
    .filter(approverId => !progress.approved[approverId])
    .map(approverId => getApprovalPlayerLabelForClient(approverId, list));
  return pending.length > 0
    ? `已确认 ${progress.approvedCount}/${progress.requiredCount} · 等待 ${pending.join("、")}`
    : `已确认 ${progress.approvedCount}/${progress.requiredCount}`;
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
  title.textContent = getPlayerIdentityLabel(player, index);
  popover.appendChild(title);

  [
    ["座位", String(index + 1)],
    ["位置", player.position || "-"],
    ["剩余筹码", String(player.chips)],
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

  if (isRoomMode()) {
    const claimButton = createButton(getSetupClaimLabel(player), () => {
      if (player.playerKeyHash && !isCurrentDevicePlayer(player) && !getRememberedPlayerCode(player.id) && !canCurrentClientManageRoom()) {
        openTableManager();
      } else {
        togglePlayerClaim(player.id);
      }
      closeSeatDetailPopovers();
    }, !canCurrentClientModifyClaims(), "seat-claim-button");
    if (isCurrentDevicePlayer(player)) claimButton.classList.add("claimed");
    popover.appendChild(claimButton);
  }

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
    const seat = getVisualSeatCoordinates(index, players.length);

    const box = document.createElement("div");
    box.classList.add("player-box");
    box.classList.add(seat.side);
    if (isCurrentDevicePlayer(player)) box.classList.add("is-mine");
    if (player.folded) box.classList.add("folded");
    if (player.allIn) box.classList.add("all-in");
    if (player.seatStatus !== "seated") box.classList.add("seat-inactive");
    if (index === currentPlayerIndex) box.classList.add("active");
    box.style.setProperty("--seat-left", `${seat.left}%`);
    box.style.setProperty("--seat-top", `${seat.top}%`);
    box.style.setProperty("--seat-left-mobile", `${seat.mobileLeft}%`);
    box.style.setProperty("--seat-top-mobile", `${seat.mobileTop}%`);
    box.setAttribute("aria-label", `${getPlayerIdentityLabel(player, index)}，筹码 ${player.chips}，本轮下注 ${player.bet}，${getPlayerStatus(player)}`);
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
    name.textContent = getPlayerCompactIdentityLabel(player, index);
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
    betBadge.textContent = `Bet ${player.bet}`;
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
