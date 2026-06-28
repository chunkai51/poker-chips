// src/room/setup-lobby-flow.js
// Setup-page player editing, pregame lobby sync, and lobby action state.

import { createButton } from "../ui/ui-dom.js";
import {
  createPlayerId as createPlayerModelId,
  createSetupPlayer as createSetupPlayerData,
  normalizeSetupPlayers as normalizeSetupPlayerList
} from "../core/player-model.js";
import {
  buildLobbyRoomForWrite,
  createLobbyGameState
} from "./room-lobby-controller.js";

function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function createSetupLobbyFlow({
  elements = {},
  maxPlayers = 10,
  getState,
  mutations = {},
  modes = {},
  permissions = {},
  identity = {},
  remote = {},
  ui = {},
  helpers = {}
} = {}) {
  let lobbySyncTimer = null;

  function getInitialChips() {
    return toPositiveInteger(elements.initialChipsInput?.value, 1000);
  }

  function getLobbyState() {
    return {
      players: [],
      room: {},
      clientId: "",
      bigBlind: 20,
      handId: 0,
      handStatus: "setup",
      stateVersion: 0,
      gameStarted: false,
      authReady: true,
      syncWriteInProgress: false,
      ...(getState ? getState() : {})
    };
  }

  function setPlayers(nextPlayers) {
    mutations.setPlayers?.(nextPlayers);
    return nextPlayers;
  }

  function setRoom(nextRoom) {
    mutations.setRoom?.(nextRoom);
    return nextRoom;
  }

  function createPlayerId() {
    return createPlayerModelId();
  }

  function normalizePlayers() {
    const { players, room } = getLobbyState();
    const normalizedPlayers = normalizeSetupPlayerList(players, { initialChips: getInitialChips() });
    setPlayers(normalizedPlayers);
    if (room) {
      room.players = normalizedPlayers;
      setRoom(room);
    }
    return normalizedPlayers;
  }

  function createSetupPlayer(overrides = {}) {
    const { players } = getLobbyState();
    return createSetupPlayerData({
      seatIndex: players.length,
      initialChips: getInitialChips(),
      overrides
    });
  }

  function scheduleSync() {
    const { room, gameStarted, handStatus } = getLobbyState();
    if (!modes.isRoomMode?.() || !room.roomId || gameStarted || handStatus !== "setup") return;
    clearTimeout(lobbySyncTimer);
    lobbySyncTimer = setTimeout(() => {
      sync();
    }, 320);
  }

  async function sync({ createOnly = false } = {}) {
    const state = getLobbyState();
    if (!modes.isRoomMode?.() || !state.room.roomId || state.gameStarted || state.handStatus !== "setup") return true;
    if (!permissions.canCurrentClientManageRoom?.()) return false;
    clearTimeout(lobbySyncTimer);

    const normalizedPlayers = normalizePlayers();
    const latest = getLobbyState();
    const nextStateVersion = latest.stateVersion + 1;
    const nextGameState = createLobbyGameState({
      bigBlind: latest.bigBlind,
      handId: latest.handId,
      stateVersion: nextStateVersion,
      logs: latest.room.gameState?.logs,
      clientId: latest.clientId
    });

    mutations.setSyncWriteInProgress?.(true);
    ui.setSyncStatus?.("同步中...");
    ui.renderIdentityControls?.();

    try {
      const result = await remote.transactRoom(latest.room.roomId, (currentRoom) => {
        return buildLobbyRoomForWrite({
          currentRoom,
          createOnly,
          room: latest.room,
          players: normalizedPlayers,
          clientId: latest.clientId,
          nextGameState,
          canClientManageRoom: permissions.canClientManageRoomData,
          getRoomHostId: remote.getRoomHostId,
          inferHandStatus: remote.inferHandStatus,
          mergePlayerIdentityFields: helpers.mergePlayerIdentityFields,
          normalizeAdminPlayerIds: helpers.normalizeAdminPlayerIds,
          normalizeJoinRequests: helpers.normalizeJoinRequests,
          touchMemberWithProfile: identity.touchMemberWithProfile
        });
      }, { applyLocally: false });

      if (!result.committed) {
        ui.setSyncStatus?.("房间已进入牌局，等待同步", "error");
        const refreshed = await remote.refreshFromRemote?.();
        if (!refreshed) mutations.setSyncReady?.(false);
        return false;
      }

      const nextRoom = getLobbyState().room;
      nextRoom.gameState = nextGameState;
      nextRoom.members = identity.touchMemberWithProfile?.(nextRoom.members, latest.clientId) || nextRoom.members;
      setRoom(nextRoom);
      mutations.setStateVersion?.(nextStateVersion);
      mutations.setSyncReady?.(true);
      ui.setSyncStatus?.("已同步", "ok");
      return true;
    } catch (_) {
      ui.setSyncStatus?.("同步失败", "error");
      return false;
    } finally {
      mutations.setSyncWriteInProgress?.(false);
      ui.renderIdentityControls?.();
    }
  }

  function updateActionState() {
    const { players, gameStarted, authReady, syncWriteInProgress } = getLobbyState();
    const canManage = permissions.canCurrentClientManageRoom?.() && (!modes.isRoomMode?.() || authReady);
    const canEditRoomSettings = permissions.canCurrentClientEditRoomSettings?.() && (!modes.isRoomMode?.() || authReady);

    if (elements.startGameBtn) elements.startGameBtn.disabled = !canManage || players.length < 2;
    if (elements.addPlayerBtn) {
      elements.addPlayerBtn.disabled = !canManage || players.length >= maxPlayers || Boolean(syncWriteInProgress);
      elements.addPlayerBtn.textContent = players.length >= maxPlayers ? `最多 ${maxPlayers} 人` : "添加玩家";
      if (!canManage && modes.isRoomMode?.()) {
        elements.addPlayerBtn.textContent = "等待房主/协管添加";
      }
    }
    if (elements.initialChipsInput) elements.initialChipsInput.disabled = !canEditRoomSettings || gameStarted;
    if (elements.bigBlindInput) elements.bigBlindInput.disabled = !canEditRoomSettings || gameStarted;
    ui.renderIdentityControls?.();
  }

  function renderPlayers() {
    const { gameStarted } = getLobbyState();
    if (!elements.playerNameInputsContainer || gameStarted) return;

    elements.playerNameInputsContainer
      .querySelectorAll(".player-div")
      .forEach(row => row.remove());

    const normalizedPlayers = normalizePlayers();

    normalizedPlayers.forEach((player) => {
      const playerDiv = document.createElement("div");
      playerDiv.classList.add("player-div");
      if (modes.isRoomMode?.()) playerDiv.classList.add("room-claim-enabled");
      playerDiv.dataset.playerId = player.id;

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "待入座，可手动填写";
      nameInput.value = player.name || "";
      nameInput.classList.add("player-name-input");
      nameInput.disabled = !permissions.canCurrentClientManageRoom?.();
      nameInput.addEventListener("input", () => {
        player.name = nameInput.value;
      });
      nameInput.addEventListener("change", () => {
        player.name = nameInput.value.trim();
        scheduleSync();
      });

      const chipsInput = document.createElement("input");
      chipsInput.type = "text";
      chipsInput.inputMode = "numeric";
      chipsInput.placeholder = "初始筹码";
      chipsInput.value = player.chips;
      chipsInput.classList.add("player-chips-input");
      chipsInput.disabled = !permissions.canCurrentClientManageRoom?.();
      chipsInput.addEventListener("input", () => {
        player.chips = toPositiveInteger(chipsInput.value, 0);
      });
      chipsInput.addEventListener("change", () => {
        player.chips = toPositiveInteger(chipsInput.value, getInitialChips());
        chipsInput.value = player.chips;
        scheduleSync();
      });

      const claimBtn = modes.isRoomMode?.()
        ? createButton(identity.getSetupClaimLabel?.(player) || "入座", () => {
          identity.togglePlayerClaim?.(player.id);
        }, !permissions.canCurrentClientModifyClaims?.(), "claim-player-button")
        : null;
      if (claimBtn && permissions.isCurrentDevicePlayer?.(player)) claimBtn.classList.add("claimed");

      const delBtn = createButton("删除", () => {
        if (!permissions.canCurrentClientManageRoom?.()) {
          ui.showAppAlert?.("只有房主或协管可以删除玩家。");
          return;
        }
        const nextPlayers = getLobbyState().players.filter(item => item.id !== player.id);
        setPlayers(nextPlayers);
        normalizePlayers();
        renderPlayers();
        updateActionState();
        scheduleSync();
      }, !permissions.canCurrentClientManageRoom?.(), "delete-player-button danger");

      playerDiv.append(nameInput, chipsInput);
      if (claimBtn) playerDiv.appendChild(claimBtn);
      playerDiv.appendChild(delBtn);
      elements.playerNameInputsContainer.appendChild(playerDiv);
    });

    updateActionState();
  }

  function addPlayer() {
    const { players } = getLobbyState();
    if (!permissions.canCurrentClientManageRoom?.()) {
      ui.showAppAlert?.("只有房主或协管可以添加玩家。");
      return;
    }
    if (players.length >= maxPlayers) {
      ui.showAppAlert?.(`最多支持 ${maxPlayers} 名玩家`);
      updateActionState();
      return;
    }

    setPlayers([...players, createSetupPlayer()]);
    renderPlayers();
    updateActionState();
    scheduleSync();
  }

  function init() {
    elements.addPlayerBtn?.addEventListener("click", addPlayer);
    renderPlayers();
    updateActionState();
  }

  return {
    init,
    createPlayerId,
    createSetupPlayer,
    normalizePlayers,
    scheduleSync,
    sync,
    updateActionState,
    renderPlayers,
    addPlayer
  };
}
