// poker-game.js

// ----------------------
// Firebase 初始化
// ----------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.13.0/firebase-app.js";
import {
  getDatabase,
  ref,
  update,
  onValue
} from "https://www.gstatic.com/firebasejs/9.13.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWngC6KUU2jRcyArjD42U7mKMwJecaqt8",
  authDomain: "online-room-test.firebaseapp.com",
  databaseURL: "https://online-room-test-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "online-room-test",
  storageBucket: "online-room-test.firebasestorage.app",
  messagingSenderId: "225690962519",
  appId: "1:225690962519:web:f9652634f1ab627c197112"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ----------------------
// 全局变量及 DOM 获取
// ----------------------
let players = [];
let currentPlayerIndex = -1;
let pot = 0;               // 累积奖池
let currentBet = 0;        // 本轮最大下注
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
const syncStatusEl = document.getElementById("sync-status");

let bigBlind = 20;
let smallBlind = 10;

let gameOver = false;
let gameStarted = false;
let awaitingShowdown = false;
let pendingPots = [];
let selectedWinnersByPot = {};
let unsubscribeRoom = null;
let listenedRoomId = "";
let stateVersion = 0;

const CLIENT_ID_KEY = "pokerChipsClientId";
const clientId = getClientId();

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
    currentPlayerIndex: -1,
    logs: [],
    inProgress: false,
    gameOver: false,
    awaitingShowdown: false,
    pendingPots: [],
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

function canAct(player) {
  return Boolean(player && !player.folded && !player.allIn && player.chips > 0);
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
  logSummary.textContent = count > 0 ? `操作日志（${count}）` : "操作日志";
}

function setSyncStatus(message, status = "") {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = message;
  syncStatusEl.classList.remove("ok", "error");
  if (status) syncStatusEl.classList.add(status);
}

// ----------------------
// Firebase 同步
// ----------------------
function updateFirebaseState() {
  if (!room.roomId) return;

  stateVersion += 1;
  room.gameState = {
    currentRound,
    pot,
    currentBet,
    currentPlayerIndex,
    logs: room.gameState.logs,
    inProgress: room.gameState.inProgress,
    gameOver,
    awaitingShowdown,
    pendingPots,
    stateVersion,
    updatedBy: clientId
  };

  update(ref(db, "rooms/" + room.roomId), {
    operator: room.operator,
    gameState: room.gameState,
    players
  }).then(() => {
    setSyncStatus("已同步", "ok");
  }).catch((error) => {
    const permissionDenied = String(error?.message || error).includes("permission");
    setSyncStatus(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
  });
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
  updateFirebaseState();
}

function normalizeIncomingPlayer(player, index) {
  return {
    id: String(player?.id || `player${index}`),
    name: String(player?.name || `玩家${index + 1}`),
    chips: toNonNegativeNumber(player?.chips, 0),
    folded: Boolean(player?.folded),
    dealer: Boolean(player?.dealer),
    bet: toNonNegativeNumber(player?.bet, 0),
    totalBet: toNonNegativeNumber(player?.totalBet, 0),
    allIn: Boolean(player?.allIn),
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

function listenFirebaseUpdates() {
  if (!room.roomId || listenedRoomId === room.roomId) return;

  if (unsubscribeRoom) {
    unsubscribeRoom();
    unsubscribeRoom = null;
  }

  const roomRef = ref(db, "rooms/" + room.roomId);
  listenedRoomId = room.roomId;
  setSyncStatus("同步中...");
  unsubscribeRoom = onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (!data || !data.gameState) return;

    const gameState = data.gameState;
    currentRound = toNonNegativeNumber(gameState.currentRound, 0);
    pot = toNonNegativeNumber(gameState.pot, 0);
    currentBet = toNonNegativeNumber(gameState.currentBet, 0);
    currentPlayerIndex = Number.isInteger(gameState.currentPlayerIndex)
      ? gameState.currentPlayerIndex
      : -1;
    gameOver = Boolean(gameState.gameOver);
    awaitingShowdown = Boolean(gameState.awaitingShowdown);
    pendingPots = normalizeIncomingPots(gameState.pendingPots);
    stateVersion = toNonNegativeNumber(gameState.stateVersion, stateVersion);
    room.operator = String(data.operator || room.operator || clientId);
    room.gameState.logs = Array.isArray(gameState.logs) ? gameState.logs.map(String) : [];
    players = Array.isArray(data.players)
      ? data.players.map(normalizeIncomingPlayer)
      : players;

    renderGameLog(room.gameState.logs);
    updateGameInfo();
    updatePlayerBoxes();

    if (awaitingShowdown) {
      renderShowdownPanel();
    } else {
      hideShowdownPanel();
    }

    if (gameOver && !awaitingShowdown) {
      renderNextHandButton();
    }

    if (gameState.inProgress === true) {
      setupContainer.style.display = "none";
      gameContainer.style.display = "block";
      gameStarted = true;
      room.gameState.inProgress = true;
    } else if (!gameStarted) {
      setupContainer.style.display = "block";
      gameContainer.style.display = "none";
      room.gameState.inProgress = false;
    }
  });
}

function createRoom() {
  if (!room.roomId) {
    room.roomId = "room_" + Math.floor(Math.random() * 10000);
  }
  room.operator = clientId;
  updateFirebaseState();
  listenFirebaseUpdates();
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
    alert("已同步最新数据");
  });
}

// ----------------------
// 添加玩家逻辑
// ----------------------
addPlayerBtn.addEventListener("click", () => {
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
    startGameBtn.disabled = players.length < 2;
  });

  playerDiv.appendChild(nameInput);
  playerDiv.appendChild(chipsInput);
  playerDiv.appendChild(delBtn);
  playerNameInputsContainer.appendChild(playerDiv);

  players.push(player);
  startGameBtn.disabled = players.length < 2;
});

// ----------------------
// 开始游戏逻辑
// ----------------------
startGameBtn.addEventListener("click", () => {
  const roomId = normalizeRoomId(roomIdInput.value);
  if (roomId) {
    joinRoom(roomId);
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

  bigBlind = toPositiveInteger(bigBlindInput.value, 20);
  smallBlind = Math.floor(bigBlind / 2);
  players = Array.from(nameInputs).map((input, index) => ({
    id: "player" + index,
    name: input.value.trim() || `玩家${index + 1}`,
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
  pendingPots = [];
  awaitingShowdown = false;
  gameStarted = true;
  gameOver = false;
  currentRound = 0;
  currentBet = 0;
  pot = 0;
  room.players = players;
  room.gameState.inProgress = true;
  clearGameLog();

  setupContainer.style.display = "none";
  gameContainer.style.display = "block";
  clearHandActions();
  hideShowdownPanel();
  startRound();
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

function assignPositions(dealerIndex) {
  for (let offset = 0; offset < players.length; offset += 1) {
    const index = (dealerIndex + offset) % players.length;
    if (players.length === 2) {
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
  }
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
  selectedWinnersByPot = {};
  hideShowdownPanel();

  if (currentRound === 0) {
    pot = 0;
    pendingPots = [];
    awaitingShowdown = false;
    players.forEach(player => {
      player.bet = 0;
      player.totalBet = 0;
      player.folded = player.chips <= 0;
      player.acted = false;
      player.allIn = false;
    });
  } else {
    players.forEach(player => {
      player.bet = 0;
      player.acted = false;
    });
  }

  const dealerIndex = Math.max(players.findIndex(player => player.dealer), 0);
  if (!players.some(player => player.dealer) && players[dealerIndex]) {
    players[dealerIndex].dealer = true;
  }
  assignPositions(dealerIndex);

  let firstToActIndex;
  if (currentRound === 0) {
    if (players.length === 2) {
      const bigBlindIndex = (dealerIndex + 1) % players.length;
      commitChips(players[dealerIndex], smallBlind);
      commitChips(players[bigBlindIndex], bigBlind);
      firstToActIndex = dealerIndex;
    } else {
      const smallBlindIndex = (dealerIndex + 1) % players.length;
      const bigBlindIndex = (dealerIndex + 2) % players.length;
      commitChips(players[smallBlindIndex], smallBlind);
      commitChips(players[bigBlindIndex], bigBlind);
      firstToActIndex = (bigBlindIndex + 1) % players.length;
    }
    currentBet = getMaxStreetBet();
  } else if (players.length === 2) {
    firstToActIndex = (dealerIndex + 1) % players.length;
  } else {
    firstToActIndex = (dealerIndex + 1) % players.length;
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
function playerAction(action, index, amount = 0) {
  if (gameOver || awaitingShowdown) {
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

  let logAction = action;

  switch (action) {
    case "check":
      if (player.bet < currentBet) {
        alert("已有下注，不能选择 Check！");
        return;
      }
      player.acted = true;
      logAction = "Check";
      break;

    case "call": {
      const callAmount = Math.max(0, currentBet - player.bet);
      if (callAmount === 0) {
        alert("当前无需跟注，可以选择 Check");
        return;
      }
      const committed = commitChips(player, callAmount);
      player.acted = true;
      logAction = committed < callAmount ? `All In 跟注 ${committed}` : `Call ${committed}`;
      break;
    }

    case "raise": {
      const requested = toPositiveInteger(amount, 0);
      if (requested <= 0) {
        alert("请输入有效的加注金额！");
        return;
      }

      const callNeeded = Math.max(0, currentBet - player.bet);
      const committed = Math.min(requested, player.chips);
      const targetBet = player.bet + committed;
      const isAllInCommit = committed === player.chips;

      if (targetBet <= currentBet && !isAllInCommit) {
        alert(`加注后的本轮总下注必须超过 ${currentBet}，否则请使用 Call`);
        return;
      }
      if (committed <= callNeeded && !isAllInCommit) {
        alert(`本次投入必须大于跟注额 ${callNeeded}，否则请使用 Call`);
        return;
      }

      commitChips(player, committed);
      player.acted = true;

      if (player.bet > currentBet) {
        currentBet = player.bet;
        players.forEach((otherPlayer, otherIndex) => {
          if (otherIndex !== index && !otherPlayer.folded && !otherPlayer.allIn) {
            otherPlayer.acted = false;
          }
        });
        logAction = player.allIn ? `All In 加注到 ${player.bet}` : `Raise 到 ${player.bet}`;
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
      return;
  }

  updateGameLog(`${getPlayerName(player)} 选择了 ${logAction}，奖池：${pot}`);
  nextPlayer();
  updateGameInfo();
  updatePlayerBoxes();
  updateFirebaseState();
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
  currentRound += 1;
  startRound();
}

function awardRemainingPot(winner) {
  const wonAmount = pot;
  if (winner) {
    winner.chips += wonAmount;
  }

  pot = 0;
  currentBet = 0;
  currentPlayerIndex = -1;
  awaitingShowdown = false;
  pendingPots = [];
  selectedWinnersByPot = {};
  gameOver = true;

  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`${winner ? getPlayerName(winner) : "无人"} 赢得奖池 ${wonAmount}`);
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
  currentPlayerIndex = -1;
  pendingPots = buildSidePots();
  selectedWinnersByPot = {};

  pendingPots.forEach((sidePot, index) => {
    if (sidePot.contenders.length === 1) {
      selectedWinnersByPot[index] = new Set(sidePot.contenders);
    }
  });

  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog("下注结束，请开牌，并在下方为每个奖池选择赢家后确认结算。");
  renderShowdownPanel();
  updateFirebaseState();
}

function hideShowdownPanel() {
  showdownPanel.hidden = true;
  showdownPanel.replaceChildren();
}

function renderShowdownPanel() {
  if (!awaitingShowdown) {
    hideShowdownPanel();
    return;
  }

  showdownPanel.hidden = false;
  showdownPanel.replaceChildren();

  const title = document.createElement("h3");
  title.textContent = "请开牌并选择赢家";
  showdownPanel.appendChild(title);

  const description = createParagraph("每个奖池可选择一个或多个赢家；选择多个时自动平分，余数给第一个被选中的赢家。");
  showdownPanel.appendChild(description);

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

    sidePot.contenders.forEach(playerId => {
      const player = getPlayerById(playerId);
      if (!player) return;

      const selected = selectedWinnersByPot[potIndex].has(playerId);
      const option = createButton(getPlayerName(player), () => {
        toggleWinner(potIndex, playerId);
      }, sidePot.contenders.length === 1, "winner-option");
      if (selected) option.classList.add("selected");
      options.appendChild(option);
    });

    card.appendChild(options);
    showdownPanel.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.classList.add("showdown-actions");
  actions.appendChild(createButton("确认结算", confirmShowdown));
  showdownPanel.appendChild(actions);
}

function toggleWinner(potIndex, playerId) {
  const selected = selectedWinnersByPot[potIndex] || new Set();
  if (selected.has(playerId)) {
    selected.delete(playerId);
  } else {
    selected.add(playerId);
  }
  selectedWinnersByPot[potIndex] = selected;
  renderShowdownPanel();
}

function distributePot(sidePot, winnerIds) {
  const baseShare = Math.floor(sidePot.amount / winnerIds.length);
  let remainder = sidePot.amount % winnerIds.length;
  const lines = [];

  winnerIds.forEach(playerId => {
    const winner = getPlayerById(playerId);
    if (!winner) return;

    const extraChip = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    const payout = baseShare + extraChip;
    winner.chips += payout;
    lines.push(`${getPlayerName(winner)} 获得 ${payout} 筹码`);
  });

  return lines;
}

function confirmShowdown() {
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
      return;
    }

    settlementPlan.push({ sidePot, winnerIds });
  }

  const reportLines = [];
  settlementPlan.forEach(({ sidePot, winnerIds }, index) => {
    reportLines.push(`奖池 ${index + 1}（${sidePot.amount}）:`);
    reportLines.push(...distributePot(sidePot, winnerIds));
  });

  pot = 0;
  currentBet = 0;
  currentPlayerIndex = -1;
  awaitingShowdown = false;
  pendingPots = [];
  selectedWinnersByPot = {};
  gameOver = true;

  hideShowdownPanel();
  updateGameInfo();
  updatePlayerBoxes();
  updateGameLog(`游戏结束，筹码分配：\n${reportLines.join("\n")}`);
  alert(`结算完成！\n${reportLines.join("\n")}`);
  showNextHandButton();
  updateFirebaseState();
}

// ----------------------
// 下一局
// ----------------------
function resetHand() {
  currentRound = 0;
  currentBet = 0;
  pot = 0;
  currentPlayerIndex = -1;
  pendingPots = [];
  selectedWinnersByPot = {};
  awaitingShowdown = false;
  gameOver = false;

  players.forEach(player => {
    player.bet = 0;
    player.totalBet = 0;
    player.folded = false;
    player.acted = false;
    player.allIn = false;
  });

  rotateDealer();
  clearGameLog();
  clearHandActions();
  hideShowdownPanel();
  room.gameState.inProgress = true;
  updateFirebaseState();
  startRound();
}

function rotateDealer() {
  if (players.length === 0) return;

  let dealerIndex = players.findIndex(player => player.dealer);
  if (dealerIndex === -1) dealerIndex = 0;

  players[dealerIndex].dealer = false;
  const nextIndex = (dealerIndex + 1) % players.length;
  players[nextIndex].dealer = true;
}

function renderNextHandButton() {
  if (!handActions || document.getElementById("next-hand-button")) return;

  const button = createButton("开始下一局", () => {
    resetHand();
  }, false, "next-hand-button");
  button.id = "next-hand-button";
  handActions.hidden = false;
  handActions.appendChild(button);
}

function clearHandActions() {
  if (!handActions) return;
  handActions.replaceChildren();
  handActions.hidden = true;
}

function showNextHandButton() {
  renderNextHandButton();
  updateFirebaseState();
}

// ----------------------
// UI 更新
// ----------------------
function updateGameInfo() {
  const roundEl = document.getElementById("current-round");
  const potEl = document.getElementById("pot-amount");
  roundEl.textContent = `当前轮次: ${rounds[currentRound] || "-"}`;
  potEl.textContent = `奖池: ${pot}`;
}

function updatePlayerBoxes() {
  const boxes = document.getElementById("player-boxes");
  boxes.replaceChildren();

  players.forEach((player, index) => {
    const box = document.createElement("div");
    box.classList.add("player-box");
    if (player.folded) box.classList.add("folded");
    if (index === currentPlayerIndex) box.classList.add("active");

    const name = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = getPlayerName(player);
    name.appendChild(strong);
    if (player.allIn) {
      name.appendChild(document.createTextNode(" (All In)"));
    }
    box.appendChild(name);

    box.appendChild(createParagraph(`位置: ${player.position || "-"}`));
    box.appendChild(createParagraph(`状态: ${getPlayerStatus(player)}`));
    box.appendChild(createParagraph(`剩余筹码: ${player.chips}`));
    box.appendChild(createParagraph(`本轮下注: ${player.bet} / 本手投入: ${player.totalBet}`));

    const actions = document.createElement("div");
    actions.classList.add("actions");

    const actionDisabled = gameOver || awaitingShowdown || index !== currentPlayerIndex || !canAct(player);
    actions.appendChild(createButton("Check", () => playerAction("check", index), actionDisabled || player.bet < currentBet));
    actions.appendChild(createButton("Call", () => playerAction("call", index), actionDisabled || player.bet >= currentBet));

    const raiseArea = document.createElement("div");
    raiseArea.classList.add("raise-input");
    raiseArea.style.display = "none";

    const raiseInput = document.createElement("input");
    raiseInput.type = "number";
    raiseInput.inputMode = "numeric";
    raiseInput.placeholder = "本次投入筹码";
    raiseInput.step = "10";
    raiseArea.appendChild(raiseInput);
    raiseArea.appendChild(createButton("确认", () => {
      playerAction("raise", index, raiseInput.value);
      raiseArea.style.display = "none";
    }));

    actions.appendChild(createButton("Raise", () => {
      raiseArea.style.display = raiseArea.style.display === "none" ? "block" : "none";
      raiseInput.focus();
    }, actionDisabled));
    actions.appendChild(createButton("Fold", () => playerAction("fold", index), actionDisabled));
    actions.appendChild(raiseArea);
    box.appendChild(actions);

    boxes.appendChild(box);
  });
}

function getPlayerStatus(player) {
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
