// src/main.js
import {
  auth,
  onAuthStateChanged,
  signInAnonymously
} from "./firebase.js";
import {
  getApprovalProgress,
  normalizeApprovalMap
} from "./approvals.js";
import {
  createDealPrompt,
  normalizeIncomingDealPrompt as normalizeDealPrompt
} from "./deal-prompts.js";
import {
  closeTableActionDialog,
  openTableActionDialog,
  showAppAlert,
  showAppConfirm
} from "./dialogs.js";
import {
  createButton,
  createParagraph
} from "./ui-dom.js";
import {
  getVisualSeatCoordinates,
  normalizeRotationOffset
} from "./table-layout.js";
import { renderTableManagerView } from "./table-manager-ui.js";
import {
  listenRoom,
  readRoom,
  readRoomGameState,
  roomExists,
  transactRoom,
  updateJoinRequest,
  updateRoomMember
} from "./room-sync.js";
import {
  normalizeIncomingPlayer,
  normalizeIncomingPlayers,
  normalizeIncomingPots,
  normalizeSelectedWinnersByPot,
  normalizeSettlementPreview,
  serializeSelectedWinnersByPot
} from "./room-state.js";
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
const playerAliasInput = document.getElementById("player-alias");
const copyInviteBtn = document.getElementById("copy-invite");
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
const ROOM_DISPLAY_NAME_KEY = "pokerChipsDisplayName";
let clientId = getClientId();
let authReady = false;
let authUnavailable = false;

// ----------------------
// 房间系统数据结构
// ----------------------
let room = {
  roomId: "",
  mode: ROOM_MODES.local,
  operator: clientId,
  hostClientId: clientId,
  inviteToken: "",
  adminKeyHash: "",
  adminPlayerIds: [],
  joinRequests: {},
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
  return player && player.name ? player.name : "空座位";
}

function getRawPlayerName(player) {
  return String(player?.name || "").trim();
}

function isAutoSeatName(name = "") {
  return /^玩家\d+$/.test(String(name || "").trim());
}

function shouldUseRequestNameForSeat(player, index = players.indexOf(player)) {
  const rawName = getRawPlayerName(player);
  return !rawName || rawName === `玩家${index + 1}` || isAutoSeatName(rawName);
}

function getRequestDisplayName(request) {
  return String(request?.displayName || "").trim().slice(0, 24);
}

function getClientShortId(value = clientId) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "local";
}

function normalizeInviteToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);
}

function createInviteToken(length = 22) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  if (crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    bytes.forEach((_, index) => {
      bytes[index] = Math.floor(Math.random() * 256);
    });
  }
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function getDisplayNameStorageKey(roomId = room.roomId) {
  return `${ROOM_DISPLAY_NAME_KEY}:${roomId || "global"}`;
}

function getPreferredDisplayName(roomId = room.roomId) {
  try {
    return String(localStorage.getItem(getDisplayNameStorageKey(roomId)) ||
      localStorage.getItem(ROOM_DISPLAY_NAME_KEY) ||
      "").trim().slice(0, 24);
  } catch (_) {
    return "";
  }
}

function rememberPreferredDisplayName(name, roomId = room.roomId) {
  const safeName = String(name || "").trim().slice(0, 24);
  if (!safeName) return;
  try {
    localStorage.setItem(ROOM_DISPLAY_NAME_KEY, safeName);
    if (roomId) localStorage.setItem(getDisplayNameStorageKey(roomId), safeName);
  } catch (_) {
    // Display names are convenience-only.
  }
}

function getInviteUrl(roomId = room.roomId, inviteToken = room.inviteToken) {
  if (!roomId) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  if (inviteToken) url.searchParams.set("invite", inviteToken);
  return url.toString();
}

function getRoomLinkParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    roomId: normalizeRoomId(params.get("room") || params.get("roomId") || ""),
    inviteToken: normalizeInviteToken(params.get("invite") || "")
  };
}

function normalizeJoinRequests(value = {}) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, request]) => {
      const requestClientId = normalizePlayerOwnerId(request?.clientId || key);
      if (!requestClientId) return null;
      const playerId = String(request?.playerId || "");
      const displayName = getRequestDisplayName(request);
      return [requestClientId, {
        clientId: requestClientId,
        playerId,
        displayName,
        type: request?.type === "reclaim" ? "reclaim" : "join",
        inviteToken: normalizeInviteToken(request?.inviteToken || ""),
        requestedAt: toNonNegativeNumber(request?.requestedAt, Date.now())
      }];
    })
    .filter(Boolean));
}

function getJoinRequestForClient(actorClientId = clientId) {
  return normalizeJoinRequests(room.joinRequests)[normalizePlayerOwnerId(actorClientId)] || null;
}

function getJoinRequestsForPlayer(playerId) {
  return Object.values(normalizeJoinRequests(room.joinRequests))
    .filter(request => request.playerId === playerId);
}

function getPendingJoinRequestCount() {
  return Object.keys(normalizeJoinRequests(room.joinRequests)).length;
}

function touchMemberWithProfile(existingMembers = room.members, actorClientId = clientId, overrides = {}) {
  const members = touchMember(existingMembers, actorClientId);
  const currentMember = members[actorClientId] || {};
  const displayName = String(overrides.displayName || currentMember.displayName || getPreferredDisplayName()).trim().slice(0, 24);
  members[actorClientId] = {
    ...currentMember,
    ...overrides,
    clientId: actorClientId,
    displayName,
    lastSeenAt: Date.now()
  };
  return members;
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

function rekeyRoomMember(previousClientId, nextClientId) {
  if (!previousClientId || !nextClientId || previousClientId === nextClientId) return;
  const members = normalizeMembers(room.members);
  const previousMember = members[previousClientId] || {};
  delete members[previousClientId];
  members[nextClientId] = {
    ...previousMember,
    clientId: nextClientId,
    lastSeenAt: Date.now()
  };
  room.members = members;
  players.forEach(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) === previousClientId) {
      player.ownerClientId = nextClientId;
    }
  });
  if (room.operator === previousClientId) room.operator = nextClientId;
  if (room.hostClientId === previousClientId) room.hostClientId = nextClientId;
}

function applyAuthenticatedClientId(nextClientId) {
  const normalizedClientId = normalizePlayerOwnerId(nextClientId);
  if (!normalizedClientId || normalizedClientId === clientId) return;
  const previousClientId = clientId;
  clientId = normalizedClientId;
  rekeyRoomMember(previousClientId, clientId);
  room.members = touchMemberWithProfile(room.members, clientId);
  if (isLocalMode()) {
    room.operator = clientId;
    room.hostClientId = clientId;
  }
  refreshInteractiveControls();
  if (isRoomMode() && room.roomId) {
    updateRoomMemberPresence();
  }
}

function startAnonymousIdentity() {
  if (!auth) {
    authReady = true;
    authUnavailable = true;
    return;
  }
  onAuthStateChanged(auth, (user) => {
    authReady = true;
    if (user?.uid) {
      authUnavailable = false;
      applyAuthenticatedClientId(user.uid);
      if (isRoomMode() && room.roomId) {
        stopRoomListener();
        listenFirebaseUpdates();
        updateRoomMemberPresence();
      }
      setSyncStatus(isRoomMode() && room.roomId ? "已连接身份" : "身份已就绪", "ok");
    }
    renderIdentityControls();
  });
  signInAnonymously(auth).catch(() => {
    authReady = true;
    authUnavailable = true;
    setSyncStatus(isRoomMode() && room.roomId ? "身份连接异常，房间同步以实际状态为准" : isRoomMode() ? "多人房间未连接" : "本地模式");
    renderIdentityControls();
  });
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

function canCurrentClientEditRoomSettings() {
  if (isLocalMode()) return true;
  if (!room.roomId) return true;
  return getHostClientId(room) === clientId;
}

function getCurrentRoomRoleLabel(roomData = room) {
  if (isLocalMode()) return "本地管理";
  if (getHostClientId(roomData) === clientId) return "房主";
  const currentPlayer = getCurrentDevicePlayer(roomData.players || players);
  if (currentPlayer && normalizeAdminPlayerIds(roomData.adminPlayerIds).includes(currentPlayer.id)) return "协管";
  if (canClientManageRoomData(clientId, roomData)) return "管理员";
  return "玩家";
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
  if (name === "空座位") return false;
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

function addPendingRequestBadge(button, label, { floating = false } = {}) {
  const requestCount = getPendingJoinRequestCount();
  if (requestCount <= 0 || !canCurrentClientManageRoom()) return button;

  const badge = document.createElement("span");
  badge.className = "identity-request-badge";
  if (floating) {
    badge.classList.add("is-floating");
    button.classList.add("has-request-badge");
  }
  badge.textContent = requestCount > 9 ? "9+" : String(requestCount);
  button.appendChild(badge);
  button.setAttribute("aria-label", `${label}，${requestCount} 个待处理请求`);
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
  room.inviteToken = "";
  room.adminKeyHash = "";
  room.adminPlayerIds = [];
  room.joinRequests = {};
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

function getIdentityAuthText() {
  if (isLocalMode()) return "";
  if (authUnavailable) {
    return syncReady ? "" : room.roomId ? "身份连接异常" : "";
  }
  return authReady ? "匿名身份" : "身份连接中";
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
  const roomAuthPending = isRoomMode() && !authReady;
  if (createRoomBtn) createRoomBtn.disabled = gameStarted || syncWriteInProgress || roomAuthPending;
  if (joinRoomBtn) joinRoomBtn.disabled = gameStarted || syncWriteInProgress || roomAuthPending;
  if (copyInviteBtn) copyInviteBtn.disabled = !isRoomMode() || !room.roomId;
  if (playerAliasInput && document.activeElement !== playerAliasInput) {
    playerAliasInput.value = getPreferredDisplayName();
  }
  if (!deviceIdentityEl) return;

  deviceIdentityEl.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = isRoomMode() ? "多人房间" : "单设备本地";
  const detail = document.createElement("span");
  const roomText = isRoomMode()
    ? room.roomId
      ? `房间 ${room.roomId} · ${Object.keys(room.members || {}).length || 1} 台设备${getPendingJoinRequestCount() ? ` · ${getPendingJoinRequestCount()} 个请求` : ""}`
      : "先创建或加入房间"
    : "不写入远程房间";
  const authText = getIdentityAuthText();
  detail.textContent = [getIdentitySummaryText(), roomText, authText].filter(Boolean).join(" · ");
  deviceIdentityEl.append(title, detail);
  if (isRoomMode() && room.roomId) {
    const manageButton = createButton("席位与身份", openTableManager, false, "identity-manage-button");
    addPendingRequestBadge(manageButton, "席位与身份");
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
  const resetDisabled = !hasClaimedPlayer || normalizeRotationOffset(tableViewRotationOffset, players.length) === 0;
  controls.appendChild(createButton("↺", () => rotateTableView(-1), players.length < 2, "table-view-button"));
  controls.appendChild(createButton("以我为底", resetTableViewRotation, resetDisabled, "table-view-button"));
  controls.appendChild(createButton("↻", () => rotateTableView(1), players.length < 2, "table-view-button"));
  const identityButton = createButton("身份", openTableManager, false, "table-view-button");
  addPendingRequestBadge(identityButton, "身份", { floating: true });
  controls.appendChild(identityButton);
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

async function remoteRoomExists(roomId = room.roomId) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) return false;

  try {
    return roomExists(normalizedRoomId);
  } catch (_) {
    setSyncStatus("连接异常，请检查网络后刷新", "error");
    return null;
  }
}

async function getRemoteGameState() {
  try {
    return readRoomGameState(room.roomId);
  } catch (_) {
    return null;
  }
}

async function refreshFromRemote() {
  if (!room.roomId) return false;

  try {
    const data = await readRoom(room.roomId);
    if (!data || !data.gameState) return false;
    syncReady = true;
    applyRoomData(data);
    return true;
  } catch (_) {
    syncReady = false;
    return false;
  }
}

async function updateRoomMemberPresence(extra = {}) {
  if (!isRoomMode() || !room.roomId) return false;
  const member = touchMemberWithProfile(room.members, clientId, extra)[clientId];
  room.members = {
    ...normalizeMembers(room.members),
    [clientId]: member
  };
  try {
    await updateRoomMember(room.roomId, clientId, member);
    return true;
  } catch (_) {
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
  room.members = touchMemberWithProfile(room.members, clientId);

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
    selectedWinnersByPot: serializeSelectedWinnersByPot(selectedWinnersByPot),
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
    inviteToken: room.inviteToken || "",
    adminKeyHash: room.adminKeyHash || "",
    adminPlayerIds: normalizeAdminPlayerIds(room.adminPlayerIds),
    joinRequests: normalizeJoinRequests(room.joinRequests),
    members: room.members,
    gameState: nextGameState,
    players
  };

  syncWriteInProgress = true;
  setSyncStatus("同步中...");
  refreshInteractiveControls();

  try {
    if (guardedWrite) {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        if (!currentRoom || !currentRoom.gameState) return undefined;

        const currentGameState = currentRoom.gameState;
        const currentHandId = toNonNegativeNumber(currentGameState.handId, 0);
        const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
        const currentStateVersion = toNonNegativeNumber(currentGameState.stateVersion, 0);
        if (expectedHandId !== null && currentHandId !== expectedHandId) return undefined;
        if (expectedStateVersion !== null && currentStateVersion !== expectedStateVersion) return undefined;
        if (Array.isArray(allowedStatuses) && !allowedStatuses.includes(currentStatus)) return undefined;
        if (typeof remoteGuard === "function" && !remoteGuard(currentRoom, currentGameState)) return undefined;

        const playersForWrite = mergePlayerIdentityFields(nextRoomData.players, currentRoom.players, { preserveNames: true });

        return {
          ...currentRoom,
          ...nextRoomData,
          mode: normalizeRoomMode(currentRoom.mode || nextRoomData.mode, room.roomId),
          operator: currentRoom.operator || nextRoomData.operator,
          hostClientId: getRoomHostId(currentRoom, nextRoomData.hostClientId),
          inviteToken: currentRoom.inviteToken || nextRoomData.inviteToken,
          adminKeyHash: currentRoom.adminKeyHash || nextRoomData.adminKeyHash,
          adminPlayerIds: normalizeAdminPlayerIds(currentRoom.adminPlayerIds || nextRoomData.adminPlayerIds)
            .filter(playerId => playersForWrite.some(player => player.id === playerId)),
          joinRequests: normalizeJoinRequests(currentRoom.joinRequests || nextRoomData.joinRequests),
          members: {
            ...normalizeMembers(currentRoom.members),
            ...normalizeMembers(nextRoomData.members)
          },
          players: playersForWrite
        };
      }, { applyLocally: false });

      if (!result.committed) {
        const refreshed = await refreshFromRemote();
        if (!refreshed) syncReady = false;
        setSyncStatus("同步被其他设备抢先更新", "error");
        return false;
      }
    } else {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        if (!currentRoom) return nextRoomData;
        const playersForWrite = mergePlayerIdentityFields(nextRoomData.players, currentRoom.players, { preserveNames: true });
        return {
          ...currentRoom,
          ...nextRoomData,
          mode: normalizeRoomMode(currentRoom.mode || nextRoomData.mode, room.roomId),
          operator: currentRoom.operator || nextRoomData.operator,
          hostClientId: getRoomHostId(currentRoom, nextRoomData.hostClientId),
          inviteToken: currentRoom.inviteToken || nextRoomData.inviteToken,
          adminKeyHash: currentRoom.adminKeyHash || nextRoomData.adminKeyHash,
          adminPlayerIds: normalizeAdminPlayerIds(currentRoom.adminPlayerIds || nextRoomData.adminPlayerIds)
            .filter(playerId => playersForWrite.some(player => player.id === playerId)),
          joinRequests: normalizeJoinRequests(currentRoom.joinRequests || nextRoomData.joinRequests),
          members: {
            ...normalizeMembers(currentRoom.members),
            ...normalizeMembers(nextRoomData.members)
          },
          players: playersForWrite
        };
      }, { applyLocally: false });

      if (!result.committed) {
        const refreshed = await refreshFromRemote();
        if (!refreshed) syncReady = false;
        setSyncStatus("同步被其他设备抢先更新", "error");
        return false;
      }
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

function mergePlayerIdentityFields(nextPlayers, sourcePlayers = players, { preserveNames = false } = {}) {
  const sourceById = new Map(normalizeIncomingPlayers(sourcePlayers)
    .map(player => [player.id, player]));
  return normalizeIncomingPlayers(nextPlayers).map((player, index) => {
    const source = sourceById.get(player.id);
    if (!source) return player;
    const sourceName = getRawPlayerName(source);
    const nextName = getRawPlayerName(player);
    return {
      ...player,
      name: preserveNames && sourceName && (!nextName || shouldUseRequestNameForSeat(player, index))
        ? sourceName
        : player.name,
      ownerClientId: normalizePlayerOwnerId(source.ownerClientId),
      playerKeyHash: String(source.playerKeyHash || "")
    };
  });
}

function syncTableDraftIdentityFromPlayers(sourcePlayers = players) {
  if (!tableDraft) return;
  const sourceById = new Map(normalizeIncomingPlayers(sourcePlayers)
    .map(player => [player.id, player]));
  tableDraft.forEach((draftPlayer, index) => {
    const source = sourceById.get(String(draftPlayer.id || ""));
    if (!source) return;
    const sourceName = getRawPlayerName(source);
    if (sourceName && shouldUseRequestNameForSeat(draftPlayer, index)) {
      draftPlayer.name = sourceName;
    }
    draftPlayer.ownerClientId = normalizePlayerOwnerId(source.ownerClientId);
    draftPlayer.playerKeyHash = String(source.playerKeyHash || "");
  });
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
  pendingDealPrompt = normalizeDealPrompt(gameState.pendingDealPrompt, { handId, roundCount: rounds.length });
  settlementPreview = normalizeSettlementPreview(gameState.settlementPreview, { handId });
  nextHandApprovals = normalizeApprovalMap(gameState.nextHandApprovals);
  handId = toNonNegativeNumber(gameState.handId, handId);
  handStatus = String(gameState.handStatus || inferHandStatus(gameState));
  stateVersion = toNonNegativeNumber(gameState.stateVersion, stateVersion);
  room.mode = normalizeRoomMode(data.mode, room.roomId);
  room.operator = String(data.operator || room.operator || clientId);
  room.hostClientId = getRoomHostId(data, room.operator || clientId);
  room.inviteToken = normalizeInviteToken(data.inviteToken || room.inviteToken || "");
  room.adminKeyHash = String(data.adminKeyHash || room.adminKeyHash || "");
  room.adminPlayerIds = normalizeAdminPlayerIds(data.adminPlayerIds);
  room.joinRequests = normalizeJoinRequests(data.joinRequests);
  room.members = touchMemberWithProfile(data.members, clientId);
  room.gameState.logs = Array.isArray(gameState.logs) ? gameState.logs.map(String) : [];
  room.gameState.inProgress = Boolean(gameState.inProgress);
  players = Array.isArray(data.players)
    ? data.players.map(normalizeIncomingPlayer)
    : players;
  room.players = players;
  syncTableDraftIdentityFromPlayers(players);

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

  listenedRoomId = room.roomId;
  syncReady = false;
  setSyncStatus("同步中...");
  unsubscribeRoom = listenRoom(room.roomId, {
    onData: (data) => {
      syncReady = true;
      applyRoomData(data);
      setSyncStatus("已同步", "ok");
    },
    onMissing: () => {
      syncReady = false;
      refreshInteractiveControls();
    },
    onError: (error) => {
      syncReady = false;
      const permissionDenied = String(error?.message || error).includes("permission");
      setSyncStatus(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
      refreshInteractiveControls();
    }
  });
}

function createRoom({ announce = true } = {}) {
  if (!room.roomId) {
    room.roomId = generateRoomId();
  }
  room.mode = ROOM_MODES.room;
  room.operator = clientId;
  room.hostClientId = clientId;
  room.inviteToken = createInviteToken();
  room.adminKeyHash = "";
  room.adminPlayerIds = [];
  room.joinRequests = {};
  room.members = createMembersMap(clientId, {
    [clientId]: {
      role: "host",
      adminVerified: true
    }
  });
  room.members = touchMemberWithProfile(room.members, clientId, { role: "host", adminVerified: true });
  syncReady = true;
  loadTableViewRotation();
  handId = 0;
  handStatus = "setup";
  listenFirebaseUpdates();
  renderIdentityControls();
  const inviteUrl = getInviteUrl();
  if (inviteUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.roomId);
    url.searchParams.set("invite", room.inviteToken);
    window.history.replaceState({}, "", url.toString());
  }
  if (announce) {
    showAppAlert(`房间 ${room.roomId} 已创建。\n分享邀请链接后，玩家输入昵称并请求坐下，由你批准。`, "房间已创建");
  }
}

async function createRoomIfAvailable({ announce = true } = {}) {
  const requestedRoomId = normalizeRoomId(roomIdInput?.value || room.roomId);
  const nextRoomId = requestedRoomId || generateRoomId();
  const exists = await remoteRoomExists(nextRoomId);
  if (exists === null) {
    showAppAlert("无法检查房间是否存在，请检查网络后刷新重试。");
    return false;
  }
  if (exists) {
    roomIdInput.value = nextRoomId;
    setSyncStatus("房间已存在", "error");
    showAppAlert(`房间 ${nextRoomId} 已存在，请直接加入，或更换一个房间 ID 后再创建。`, "房间已存在");
    return false;
  }

  room.roomId = nextRoomId;
  createRoom({ announce: false });
  roomIdInput.value = room.roomId;
  const saved = await syncLobbyState({ createOnly: true });
  if (!saved) {
    setSyncStatus("房间创建失败", "error");
    showAppAlert("房间创建失败，可能已被其他人抢先创建，或当前连接异常。请换一个房间 ID 或刷新后重试。", "创建失败");
    return false;
  }

  setSyncStatus("房间已创建", "ok");
  if (announce) {
    showAppAlert(`房间 ${room.roomId} 已创建。\n分享邀请链接后，玩家输入昵称并请求坐下，由你批准。`, "房间已创建");
  }
  return true;
}

function generateRoomId() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  let id = "";
  const bytes = new Uint8Array(8);
  if (crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
    bytes.forEach(byte => {
      id += alphabet[byte % alphabet.length];
    });
    return id;
  }

  for (let index = 0; index < 8; index += 1) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

function joinRoom(roomId, { inviteToken = "" } = {}) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) return;
  const normalizedInviteToken = normalizeInviteToken(inviteToken);

  const switchingRoom = room.roomId !== normalizedRoomId;
  room.roomId = normalizedRoomId;
  room.mode = ROOM_MODES.room;
  if (switchingRoom) {
    room.operator = "";
    room.hostClientId = "";
    room.inviteToken = normalizedInviteToken;
    room.adminKeyHash = "";
    room.adminPlayerIds = [];
    room.joinRequests = {};
    room.members = createMembersMap(clientId);
    syncReady = false;
  } else if (normalizedInviteToken && !room.inviteToken) {
    room.inviteToken = normalizedInviteToken;
  }
  room.members = touchMemberWithProfile(room.members, clientId);
  roomIdInput.value = normalizedRoomId;
  loadTableViewRotation();
  listenFirebaseUpdates();
  renderIdentityControls();
  updateRoomMemberPresence();
}

function syncRoomFromInput() {
  const id = normalizeRoomId(roomIdInput.value);
  if (!id) return;
  joinRoom(id);
}

if (playerAliasInput) {
  playerAliasInput.value = getPreferredDisplayName();
  playerAliasInput.addEventListener("change", async () => {
    const safeName = playerAliasInput.value.trim().slice(0, 24);
    playerAliasInput.value = safeName;
    rememberPreferredDisplayName(safeName);
    if (isRoomMode() && room.roomId) {
      await updateRoomMemberPresence({ displayName: safeName });
      renderIdentityControls();
      if (tableManagerOpen) renderTableManager();
    }
  });
}

if (copyInviteBtn) {
  copyInviteBtn.addEventListener("click", async () => {
    if (!isRoomMode() || !room.roomId) {
      showAppAlert("请先创建或加入房间。");
      return;
    }
    const inviteUrl = getInviteUrl();
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showAppAlert("邀请链接已复制。朋友打开后输入昵称，请求坐下即可。", "已复制邀请");
    } catch (_) {
      showAppAlert(inviteUrl, "邀请链接");
    }
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
    rememberPreferredDisplayName(playerAliasInput?.value || getPreferredDisplayName());
    await createRoomIfAvailable();
  });
}

if (joinRoomBtn) {
  joinRoomBtn.addEventListener("click", () => {
    const id = normalizeRoomId(roomIdInput.value);
    if (!id) {
      showAppAlert("请输入房间ID");
      return;
    }
    rememberPreferredDisplayName(playerAliasInput?.value || getPreferredDisplayName());
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
  const currentRequest = getJoinRequestForClient();
  if (currentRequest?.playerId === player.id) return "待批准";
  if (isClaimedByOtherDevice(player)) return "已有人入座";
  return canCurrentClientManageRoom() ? "绑定到我" : "请求坐下";
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
  const firstClaim = !player?.playerKeyHash && canCurrentClientManageRoom();
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
  const generatedCode = auth.firstClaim && !auth.canForce ? createAccessCode() : "";
  const generatedHash = generatedCode
    ? hashAccessCode(generatedCode, getPlayerCodeSalt(playerId))
    : "";

  setMutationInProgress(true);
  try {
    const result = await transactRoom(room.roomId, (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      const currentStatus = String(currentRoom.gameState?.handStatus || inferHandStatus(currentRoom.gameState || {}));
      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const target = remotePlayers.find(item => item.id === playerId);
      if (!target) return undefined;

      const adminForce = forceAdmin && canClientManageRoomData(clientId, currentRoom);
      const remoteCanUseCode = Boolean(target.playerKeyHash && isPlayerCodeValid(target, auth.code, currentRoom));
      const remoteFirstClaim = !target.playerKeyHash && auth.firstClaim;
      if (!adminForce && !remoteCanUseCode && !remoteFirstClaim) return undefined;

      remotePlayers.forEach(item => {
        if (normalizePlayerOwnerId(item.ownerClientId) === clientId) {
          item.ownerClientId = "";
        }
      });
      target.ownerClientId = clientId;
      const currentDisplayName = getPreferredDisplayName();
      if (currentDisplayName && shouldUseRequestNameForSeat(target, remotePlayers.indexOf(target))) {
        target.name = currentDisplayName;
      }
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
        displayName: currentDisplayName || members[clientId]?.displayName || "",
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
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
  if (isClaimedByOtherDevice(player)) {
    const confirmed = await showAppConfirm(`${getPlayerIdentityLabel(player)} 已绑定到另一台设备。${canCurrentClientManageRoom() ? "确认要把这个座位接管到当前设备吗？" : "要向房主/协管提交接管请求吗？"}`, {
      title: "确认接管座位",
      confirmLabel: canCurrentClientManageRoom() ? "确认接管" : "提交请求",
      danger: canCurrentClientManageRoom()
    });
    if (!confirmed) return;
  }
  if (canCurrentClientManageRoom()) {
    await claimPlayerIdentity(playerId, { forceAdmin: true, announceCode: false });
    return;
  }
  await requestSeatOwnership(playerId);
}

async function requestSeatOwnership(playerId) {
  if (!isRoomMode() || !room.roomId) return;
  const player = players.find(item => item.id === playerId);
  if (!player) return;
  const displayName = String(playerAliasInput?.value || getPreferredDisplayName()).trim().slice(0, 24);
  if (!displayName) {
    showAppAlert("请先输入你的昵称，再请求坐下。");
    playerAliasInput?.focus();
    return;
  }
  rememberPreferredDisplayName(displayName);
  const request = {
    clientId,
    playerId,
    displayName,
    type: isClaimedByOtherDevice(player) ? "reclaim" : "join",
    inviteToken: room.inviteToken || "",
    requestedAt: Date.now()
  };
  setMutationInProgress(true);
  try {
    await updateJoinRequest(room.roomId, clientId, request);
    room.joinRequests = {
      ...normalizeJoinRequests(room.joinRequests),
      [clientId]: request
    };
    await updateRoomMemberPresence({ displayName });
    showAppAlert("请求已发送。房主或协管批准后，这个座位会绑定到当前设备。", "等待批准");
    setSyncStatus("等待批准", "ok");
  } catch (_) {
    showAppAlert("请求发送失败，请检查房间连接后重试。");
  } finally {
    setMutationInProgress(false);
    renderSetupPlayerInputs();
    updatePlayerBoxes();
    if (tableManagerOpen) renderTableManager();
  }
}

async function approveSeatRequest(requestClientId) {
  if (!canCurrentClientManageRoom() || !room.roomId) return;
  const request = normalizeJoinRequests(room.joinRequests)[requestClientId];
  if (!request) return;
  const target = players.find(player => player.id === request.playerId);
  if (!target) return;

  setMutationInProgress(true);
  try {
    const result = await transactRoom(room.roomId, (currentRoom) => {
      if (!currentRoom || !Array.isArray(currentRoom.players)) return undefined;
      if (!canClientManageRoomData(clientId, currentRoom)) return undefined;
      const requests = normalizeJoinRequests(currentRoom.joinRequests);
      const remoteRequest = requests[requestClientId];
      if (!remoteRequest || remoteRequest.playerId !== request.playerId) return undefined;
      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const remoteTarget = remotePlayers.find(player => player.id === remoteRequest.playerId);
      if (!remoteTarget) return undefined;
      const remoteTargetIndex = remotePlayers.indexOf(remoteTarget);
      const requestDisplayName = getRequestDisplayName(remoteRequest);
      remotePlayers.forEach(player => {
        if (normalizePlayerOwnerId(player.ownerClientId) === requestClientId) {
          player.ownerClientId = "";
        }
      });
      remoteTarget.ownerClientId = requestClientId;
      remoteTarget.playerKeyHash = "";
      if (requestDisplayName && shouldUseRequestNameForSeat(remoteTarget, remoteTargetIndex)) {
        remoteTarget.name = requestDisplayName;
      }
      delete requests[requestClientId];

      const members = touchMember(currentRoom.members || room.members, clientId);
      Object.entries(members).forEach(([memberId, member]) => {
        if (String(member.claimedPlayerId || "") === remoteRequest.playerId) {
          members[memberId] = {
            ...member,
            claimedPlayerId: ""
          };
        }
      });
      members[requestClientId] = {
        ...(members[requestClientId] || {}),
        clientId: requestClientId,
        displayName: requestDisplayName,
        claimedPlayerId: remoteRequest.playerId,
        lastSeenAt: Date.now()
      };

      const nextGameState = currentRoom.gameState || {};
      const currentStatus = String(nextGameState.handStatus || inferHandStatus(nextGameState));
      const nextRoom = {
        ...currentRoom,
        joinRequests: requests,
        members,
        players: remotePlayers
      };
      if (currentStatus === "settled") {
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
      showAppAlert("批准请求失败，房间状态可能已变化。");
      await refreshFromRemote();
      return;
    }
    await refreshFromRemote();
  } catch (_) {
    showAppAlert("批准请求失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    if (tableManagerOpen) renderTableManager();
  }
}

async function declineSeatRequest(requestClientId) {
  if (!canCurrentClientManageRoom() || !room.roomId) return;
  const normalizedRequestClientId = normalizePlayerOwnerId(requestClientId);
  if (!normalizedRequestClientId) return;
  setMutationInProgress(true);
  try {
    const result = await transactRoom(room.roomId, (currentRoom) => {
      if (!currentRoom) return undefined;
      if (!canClientManageRoomData(clientId, currentRoom)) return undefined;
      const requests = normalizeJoinRequests(currentRoom.joinRequests);
      if (!requests[normalizedRequestClientId]) return undefined;
      delete requests[normalizedRequestClientId];
      return {
        ...currentRoom,
        joinRequests: requests,
        members: touchMember(currentRoom.members || room.members, clientId)
      };
    }, { applyLocally: false });
    if (!result.committed) {
      showAppAlert("拒绝请求失败，房间状态可能已变化。");
      await refreshFromRemote();
      return;
    }
    await refreshFromRemote();
    setSyncStatus("已同步", "ok");
  } catch (_) {
    showAppAlert("拒绝请求失败，请稍后再试。");
  } finally {
    setMutationInProgress(false);
    if (tableManagerOpen) renderTableManager();
  }
}

async function verifyAdminIdentity(code) {
  const normalizedCode = normalizeAccessCode(code);
  if (!isRoomMode() || !room.roomId || !normalizedCode) {
    showAppAlert("请输入管理码。");
    return false;
  }
  setMutationInProgress(true);
  try {
    const result = await transactRoom(room.roomId, (currentRoom) => {
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

async function syncLobbyState({ createOnly = false } = {}) {
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
      if (createOnly && currentRoom) return undefined;
      const currentGameState = currentRoom?.gameState;
      const currentStatus = currentGameState
        ? String(currentGameState.handStatus || inferHandStatus(currentGameState))
        : "setup";
      const currentInProgress = Boolean(currentGameState?.inProgress);
      if (currentInProgress && currentStatus !== "setup") return undefined;

      const existingRoom = currentRoom || {};
      if (currentRoom && !canClientManageRoomData(clientId, existingRoom)) return undefined;
      const playersForWrite = mergePlayerIdentityFields(players, existingRoom.players || players);
      return {
        ...existingRoom,
        mode: ROOM_MODES.room,
        operator: existingRoom.operator || room.operator || clientId,
        hostClientId: getRoomHostId(existingRoom, room.hostClientId || clientId),
        inviteToken: existingRoom.inviteToken || room.inviteToken || "",
        adminKeyHash: existingRoom.adminKeyHash || room.adminKeyHash || "",
        adminPlayerIds: normalizeAdminPlayerIds(existingRoom.adminPlayerIds || room.adminPlayerIds),
        joinRequests: normalizeJoinRequests(existingRoom.joinRequests || room.joinRequests),
        members: touchMemberWithProfile(existingRoom.members || room.members, clientId),
        gameState: nextGameState,
        players: playersForWrite
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
    room.members = touchMemberWithProfile(room.members, clientId);
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
  const canManage = canCurrentClientManageRoom() && (!isRoomMode() || authReady);
  const canEditRoomSettings = canCurrentClientEditRoomSettings() && (!isRoomMode() || authReady);
  startGameBtn.disabled = !canManage || players.length < 2;
  addPlayerBtn.disabled = !canManage || players.length >= MAX_PLAYERS;
  if (initialChipsInput) initialChipsInput.disabled = !canEditRoomSettings || gameStarted;
  if (bigBlindInput) bigBlindInput.disabled = !canEditRoomSettings || gameStarted;
  addPlayerBtn.textContent = players.length >= MAX_PLAYERS ? `最多 ${MAX_PLAYERS} 人` : "添加玩家";
  if (!canManage && isRoomMode()) {
    addPlayerBtn.textContent = "等待房主/协管添加";
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
    nameInput.placeholder = "待入座，可手动填写";
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
        showAppAlert("只有房主或协管可以删除玩家。");
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
    showAppAlert("只有房主或协管可以添加玩家。");
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

function applyRoomLinkFromUrl() {
  const params = getRoomLinkParams();
  if (!params.roomId) return;
  enterRoomMode();
  roomIdInput.value = params.roomId;
  joinRoom(params.roomId, { inviteToken: params.inviteToken });
}

startAnonymousIdentity();
applyRoomLinkFromUrl();
renderSetupPlayerInputs();
updateSetupActionState();
syncReady = !isRoomMode();
if (!isRoomMode()) setSyncStatus("本地模式");
renderIdentityControls();

// ----------------------
// 开始游戏逻辑
// ----------------------
startGameBtn.addEventListener("click", async () => {
  if (mutationInProgress) return;
  if (!canCurrentClientManageRoom()) {
    showAppAlert("只有房主或协管可以开始牌局。");
    return;
  }
  setMutationInProgress(true);

  try {
    const roomId = normalizeRoomId(roomIdInput.value);
    if (isRoomMode()) {
      if (roomId) {
        const exists = await remoteRoomExists(roomId);
        if (exists === null) return;
        if (!exists) {
          room.roomId = roomId;
          roomIdInput.value = roomId;
          const created = await createRoomIfAvailable({ announce: false });
          if (!created) return;
        } else {
          joinRoom(roomId);
          const refreshed = await refreshFromRemote();
          if (!refreshed) {
            showAppAlert("无法读取该房间，请检查网络后刷新重试。");
            return;
          }
        }
        if (!canCurrentClientManageRoom()) {
          showAppAlert("只有房主或协管可以开始牌局。");
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
        const created = await createRoomIfAvailable({ announce: false });
        if (!created) return;
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

function getFirstActionIndexForRound(round = currentRound) {
  const dealerIndex = normalizeDealerForHand();
  const layout = getHandLayout(dealerIndex);
  return round === 0 ? layout.preflopFirstIndex : layout.postflopFirstIndex;
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
    const smallBlindPosted = commitChips(players[layout.smallBlindIndex], smallBlind);
    const bigBlindPosted = commitChips(players[layout.bigBlindIndex], bigBlind);
    firstToActIndex = layout.preflopFirstIndex;
    currentBet = getMaxStreetBet();
    pendingDealPrompt = createDealPrompt(0, { handId });
    handStatus = "waitingDeal";
    currentPlayerIndex = -1;
    updateGameInfo();
    updatePlayerBoxes();
    updateGameLog(`盲注已自动下入：${getPlayerIdentityLabel(players[layout.smallBlindIndex])} ${smallBlindPosted}，${getPlayerIdentityLabel(players[layout.bigBlindIndex])} ${bigBlindPosted}。请发两张底牌。`);
    renderDealPromptPanel();
    clearHandActions();
    updateFirebaseState();
    return;
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
  pendingDealPrompt = createDealPrompt(nextRound, { handId });
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
    showAppAlert("只有本局 Dealer 可以确认发牌；未绑定 Dealer 由房主/协管代管。");
    return;
  }

  setMutationInProgress(true);
  batchingStateUpdate = true;
  const isOpeningDeal = prompt.nextRound === 0;
  handStatus = "playing";
  pendingDealPrompt = null;
  if (isOpeningDeal) {
    currentRound = 0;
    currentPlayerIndex = findNextActionableIndex(getFirstActionIndexForRound(0), true);
    hideDealPromptPanel();
    updateGameInfo();
    updatePlayerBoxes();
    updateGameLog("底牌已发，进入翻牌前行动。");

    if (!handleAutomaticHandEnd()) {
      if (currentPlayerIndex === -1) {
        beginShowdown();
      } else {
        updateGameLog(`轮到 ${getPlayerIdentityLabel(players[currentPlayerIndex])} 行动`);
      }
    }
  } else {
    currentRound = prompt.nextRound;
    startRound();
  }
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
      if (!currentRoom || !currentRoom.gameState || !Array.isArray(currentRoom.players)) return undefined;
      const currentGameState = currentRoom.gameState;
      const currentStatus = String(currentGameState.handStatus || inferHandStatus(currentGameState));
      if (currentStatus !== "settlementPreview" || !currentGameState.settlementPreview) return undefined;

      const remotePlayers = currentRoom.players.map(normalizeIncomingPlayer);
      const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview, { handId });
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
      const remotePreview = normalizeSettlementPreview(currentGameState.settlementPreview, { handId });
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

function createTableDraft() {
  return players.map((player, index) => ({
    id: String(player.id || `player${index}`),
    name: getRawPlayerName(player),
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
  const canEdit = canEditTableNow();
  const isActionLocked = isSharedPromptActionLocked();
  let addButtonLabel = "添加玩家";
  if (tableDraft.length >= MAX_PLAYERS) {
    addButtonLabel = `最多 ${MAX_PLAYERS} 人`;
  } else if (!canEdit) {
    addButtonLabel = "当前阶段不可加人";
  }

  const currentPlayer = getCurrentDevicePlayer();
  const currentIndex = currentPlayer ? players.indexOf(currentPlayer) : -1;
  const isAdmin = canCurrentClientManageRoom();
  const displayName = getPreferredDisplayName() || "未填写昵称";
  const pendingRequestCount = getPendingJoinRequestCount();
  const identity = isRoomMode()
    ? {
      titleText: currentPlayer
        ? `当前身份：${getPlayerIdentityLabel(currentPlayer, currentIndex)}${isAdmin ? ` · ${getCurrentRoomRoleLabel()}` : ""}`
        : isAdmin
          ? `当前身份：${getCurrentRoomRoleLabel()}旁观`
          : "当前身份：旁观",
      detailText: `房间 ${room.roomId || "-"} · ${displayName} · 设备 ${getClientShortId()}`,
      hasCurrentPlayer: Boolean(currentPlayer),
      isAdmin,
      isActionLocked,
      roomId: room.roomId,
      pendingRequestCount
    }
    : null;

  const requests = Object.values(normalizeJoinRequests(room.joinRequests))
    .sort((left, right) => left.requestedAt - right.requestedAt)
    .map(request => {
      const targetIndex = players.findIndex(player => player.id === request.playerId);
      const targetPlayer = targetIndex >= 0 ? players[targetIndex] : null;
      return {
        clientId: request.clientId,
        text: `${getRequestDisplayName(request) || "未填写昵称"} 请求${request.type === "reclaim" ? "接管" : "坐下"} ${targetPlayer ? getPlayerIdentityLabel(targetPlayer, targetIndex) : "未知座位"}`
      };
    });

  renderTableManagerView({
    panel: tableManagerPanel,
    context: {
      isRoomMode: isRoomMode(),
      description: isRoomMode()
        ? "玩家在这里查看身份与请求；房主/协管可批准入座，并在开局前或两手牌之间调整牌桌。"
        : "调整座次、筹码和离桌/回桌状态；保存后只影响下一手。",
      summaryText: canEdit
        ? getTableDraftSummary()
        : "身份绑定可随时调整；筹码、座次、删除玩家只在开局前或两手牌之间开放。",
      canEdit,
      canManageRoom: isAdmin,
      isActionLocked,
      tableDraft,
      maxPlayers: MAX_PLAYERS,
      adminPlayerIds: room.adminPlayerIds,
      normalizeDraftPlayer,
      addButtonLabel,
      addDisabled: isActionLocked || !canEdit || tableDraft.length >= MAX_PLAYERS,
      saveDisabled: isActionLocked || !canEdit,
      saveAndStartDisabled: isActionLocked || !canEdit || handStatus !== "settled" || getEligiblePlayerIndices(tableDraft.map(normalizeDraftPlayer)).length < 2
    },
    identity,
    requests,
    callbacks: {
      onClose: closeTableManager,
      onAddPlayer: addDraftPlayer,
      onSave: saveTableDraft,
      onReleaseCurrentPlayer: releaseCurrentPlayerIdentity,
      onCopyInvite: copyInviteLink,
      onShowPendingRequests: count => {
        showAppAlert(`当前有 ${count} 个待处理请求。请在下方列表批准或拒绝。`);
      },
      onApproveSeatRequest: approveSeatRequest,
      onDeclineSeatRequest: declineSeatRequest,
      onMoveDraftPlayer: moveDraftPlayer,
      onDraftNameInput: (index, value) => {
        tableDraft[index].name = value;
      },
      onSetDraftChips: setDraftChips,
      onAdjustDraftChips: adjustDraftChips,
      onSetDraftStatus: setDraftStatus,
      onReturnSeat: returnDraftPlayerToTable,
      onDeleteDraftPlayer: deleteDraftPlayer,
      onTogglePlayerClaim: async playerId => {
        await togglePlayerClaim(playerId);
        renderTableManager();
      },
      onTogglePlayerAdmin: togglePlayerAdmin
    },
    formatters: {
      getPlayerName,
      getSavedPlayer: playerId => players.find(item => item.id === playerId),
      isCurrentDevicePlayer,
      getClientShortId,
      getJoinRequestsForPlayer
    }
  });
}

function addDraftPlayer() {
  if (tableDraft.length >= MAX_PLAYERS) {
    showAppAlert(`最多支持 ${MAX_PLAYERS} 名玩家`);
    renderTableManager();
    return;
  }

  const id = getNextPlayerIdFromDraft();
  tableDraft.push({
    id,
    name: "",
    seatIndex: tableDraft.length,
    seatStatus: "seated",
    chips: toPositiveInteger(initialChipsInput.value, 1000),
    ownerClientId: "",
    playerKeyHash: "",
    dealer: false
  });
  renderTableManager();
}

async function copyInviteLink() {
  const inviteUrl = getInviteUrl();
  if (!inviteUrl) return;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    showAppAlert("邀请链接已复制。", "已复制邀请");
  } catch (_) {
    showAppAlert(inviteUrl, "邀请链接");
  }
}

function returnDraftPlayerToTable(index) {
  if (tableDraft[index].chips <= 0) {
    tableDraft[index].chips = toPositiveInteger(initialChipsInput.value, 1000);
  }
  setDraftStatus(index, "seated");
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
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
      showAppAlert("协管权限更新没有成功，请等待同步后重试。");
      await refreshFromRemote();
      return;
    }
    await refreshFromRemote();
  } catch (_) {
    showAppAlert("协管权限更新失败，请稍后再试。");
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
    showAppAlert("只有房主或协管可以保存牌桌管理设置。");
    return;
  }
  if (!tableDraft) {
    showAppAlert("当前不能保存牌桌管理设置");
    return;
  }

  let nextPlayers = mergePlayerIdentityFields(normalizeTableDraftPlayers(), players);
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
    const result = await transactRoom(room.roomId, (currentRoom) => {
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
  if (roundEl) roundEl.textContent = getRoundDisplayText();
  if (potEl) potEl.textContent = `奖池: ${pot}`;
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

      if (isRoomMode() && requiredApprovers.length > 0 && !progress.complete && (alreadyApproved || !canApprove)) {
        body.appendChild(createWaitingNotice(getApprovalWaitingText(
          settlementPreview.approvals,
          requiredApprovers,
          "确认结算"
        )));
      }

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
    if (!canCurrentClientControlPlayer(player)) {
      operations.appendChild(createWaitingNotice(`等待 ${getPlayerIdentityLabel(player)} 操作`));
      return operations;
    }
    operations.appendChild(createActionControls(player, index, actionDisabled, "table-center-action-buttons"));
    return operations;
  }

  if (handStatus === "waitingDeal" && pendingDealPrompt) {
    const canConfirmDeal = canCurrentClientConfirmDeal();
    operations.appendChild(createCenterOperationHeader(pendingDealPrompt.title, [
      pendingDealPrompt.cardText,
      pendingDealPrompt.detail,
      canConfirmDeal ? "你可确认发牌" : "等待 Dealer 确认"
    ].filter(Boolean)));
    if (!canConfirmDeal) {
      operations.appendChild(createWaitingNotice("等待 Dealer 确认发牌"));
      return operations;
    }
    const confirmLabel = pendingDealPrompt.nextRound === 0 ? "手牌已发，开始行动" : "已发牌，继续";
    operations.appendChild(createButton(confirmLabel, confirmDealPrompt, isSharedPromptActionLocked(), "prompt-primary"));
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
    const settlementProgress = getApprovalProgress(settlementPreview?.approvals, requiredApprovers);
    const canApproveSettlement = isLocalMode() || requiredApprovers.includes(clientId);
    const alreadyApprovedSettlement = Boolean(settlementProgress.approved[clientId]);
    operations.appendChild(createCenterOperationHeader("等待结算确认", [
      `总额 ${settlementPreview?.total || pot}`,
      getApprovalStatusText(settlementPreview?.approvals, requiredApprovers)
    ]));
    if (isRoomMode() && requiredApprovers.length > 0 && !settlementProgress.complete && (alreadyApprovedSettlement || !canApproveSettlement)) {
      operations.appendChild(createWaitingNotice(getApprovalWaitingText(
        settlementPreview?.approvals,
        requiredApprovers,
        "确认结算"
      )));
    }
    const settlementButtonLabel = isRoomMode() && requiredApprovers.length > 0 && !settlementProgress.complete && (alreadyApprovedSettlement || !canApproveSettlement)
      ? "查看结算"
      : "查看并确认";
    operations.appendChild(createButton(settlementButtonLabel, openSettlementPreviewDialog, isSharedPromptActionLocked(), "prompt-primary"));
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
    if (isRoomMode() && nextHandApprovers.length > 0 && !nextHandProgress.complete && (alreadyApprovedNextHand || !canApproveNextHand)) {
      operations.appendChild(createWaitingNotice(getApprovalWaitingText(
        nextHandApprovals,
        nextHandApprovers,
        "确认下一局"
      )));
    }
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

function createWaitingNotice(text) {
  const notice = document.createElement("div");
  notice.className = "table-waiting-notice";
  const dots = document.createElement("span");
  dots.className = "waiting-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  const label = document.createElement("strong");
  label.textContent = text;
  notice.append(dots, label);
  return notice;
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

function getCompactPlayerStatus(player) {
  if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
  if (player.folded) return "弃牌";
  if (player.allIn) return "All In";
  if (players.indexOf(player) === currentPlayerIndex) return "行动中";
  if (player.acted) return "已行动";
  return "等待";
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
  if (approverId === getHostClientId(roomData)) return "房主/协管";
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

function getApprovalWaitingText(approvals, requiredIds, actionLabel, list = players) {
  const progress = getApprovalProgress(approvals, requiredIds);
  const pending = requiredIds
    .filter(approverId => !progress.approved[approverId])
    .map(approverId => getApprovalPlayerLabelForClient(approverId, list));
  return pending.length > 0
    ? `等待 ${pending.join("、")} ${actionLabel}`
    : `等待同步${actionLabel}`;
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
      togglePlayerClaim(player.id);
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
    const seat = getVisualSeatCoordinates({
      playerIndex: index,
      count: players.length,
      currentDevicePlayerIndex: getCurrentDevicePlayerIndex(),
      rotationOffset: tableViewRotationOffset,
      roomMode: isRoomMode(),
      maxSeats: MAX_PLAYERS
    });

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
