import {
  getPlayerCodeSalt as getPlayerAccessCodeSalt,
  getRememberedAdminCode as getStoredAdminCode,
  getRememberedPlayerCode as getStoredPlayerCode,
  isAdminCodeValid as isAdminAccessCodeValid,
  isPlayerCodeValid as isPlayerAccessCodeValid,
  rememberPlayerCode as storePlayerCode
} from "../room/access-codes.js";
import {
  canPlayerRaise as canPlayerRaiseWithState,
  getCallAmount as calculateCallAmount,
  getChipStep as calculateChipStep,
  getDefaultRaiseTarget as calculateDefaultRaiseTarget,
  getEligiblePlayerIndices as collectEligiblePlayerIndices,
  getMaximumRaiseTarget as calculateMaximumRaiseTarget,
  getMinimumRaiseTarget as calculateMinimumRaiseTarget,
  getPotSizedRaiseTarget as calculatePotSizedRaiseTarget,
  getRaiseValidation as validateRaiseTarget
} from "../core/game-rules.js";
import {
  getPlayerCompactIdentityLabel,
  getPlayerIdentityLabel,
  getPlayerName,
  getRawPlayerName,
  shouldUseRequestNameForSeat
} from "../core/player-model.js";
import {
  normalizeAdminPlayerIds,
  normalizePlayerOwnerId,
  ROOM_MODES
} from "../room/identity.js";
import { getClientShortId } from "../room/room-entry.js";
import {
  canClientControlPlayerInRoom,
  canClientManageRoomData,
  getCurrentDevicePlayer,
  getCurrentDevicePlayerIndex,
  getHostClientId,
  getPlayerControllerId,
  getRoomManagerProxyId,
  isClientAdminInRoom,
  isCurrentDevicePlayer
} from "../room/room-permissions.js";
import { normalizeIncomingPlayers } from "../room/room-state.js";

export function toPositiveInteger(value, fallback = 0) {
  const number = parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function inferHandStatus(gameState = {}) {
  if (gameState.pendingDealPrompt) return "waitingDeal";
  if (gameState.settlementPreview) return "settlementPreview";
  if (gameState.awaitingShowdown) return "showdown";
  if (gameState.gameOver) return "settled";
  if (gameState.inProgress) return "playing";
  return "setup";
}

export function createAppPolicy({ state }) {
  function isLocalMode() {
    return state.room.mode === ROOM_MODES.local;
  }

  function isRoomMode() {
    return state.room.mode === ROOM_MODES.room;
  }

  function needsRemoteSync() {
    return isRoomMode() && Boolean(state.room.roomId);
  }

  function getRememberedAdminCode(roomId = state.room.roomId) {
    return getStoredAdminCode(roomId);
  }

  function rememberPlayerCode(playerId, code, roomId = state.room.roomId) {
    storePlayerCode(playerId, code, roomId);
  }

  function getRememberedPlayerCode(playerId, roomId = state.room.roomId) {
    return getStoredPlayerCode(playerId, roomId);
  }

  function getPlayerCodeSalt(playerId, roomId = state.room.roomId) {
    return getPlayerAccessCodeSalt(playerId, roomId);
  }

  function isPlayerCodeValid(player, code, roomData = state.room) {
    return isPlayerAccessCodeValid(player, code, roomData.roomId || state.room.roomId);
  }

  function isAdminCodeValid(code, roomData = state.room) {
    return isAdminAccessCodeValid(code, {
      ...roomData,
      roomId: roomData.roomId || state.room.roomId
    });
  }

  function getPermissionOptions() {
    return {
      currentClientId: state.clientId,
      currentRoomId: state.room.roomId,
      players: state.players,
      isRememberedAdminCodeValid: (roomData, roomId) => {
        return isAdminCodeValid(getRememberedAdminCode(roomData?.roomId || roomId), roomData);
      }
    };
  }

  function getRoomHostClientId(roomData = state.room) {
    return getHostClientId(roomData, {
      currentRoomId: state.room.roomId,
      localClientId: state.clientId
    });
  }

  function isClientAdmin(actorClientId, roomData = state.room) {
    return isClientAdminInRoom(actorClientId, roomData, getPermissionOptions());
  }

  function getManagerProxyId(roomData = state.room) {
    return getRoomManagerProxyId(roomData, {
      currentRoomId: state.room.roomId,
      localClientId: state.clientId,
      players: state.players
    });
  }

  function canClientManage(actorClientId, roomData = state.room) {
    return canClientManageRoomData(actorClientId, roomData, getPermissionOptions());
  }

  function canClientControlPlayer(actorClientId, player, roomData = state.room) {
    return canClientControlPlayerInRoom(actorClientId, player, roomData, getPermissionOptions());
  }

  function getCurrentPlayerIndex(list = state.players) {
    return getCurrentDevicePlayerIndex(list, state.clientId);
  }

  function getCurrentPlayer(list = state.players) {
    return getCurrentDevicePlayer(list, state.clientId);
  }

  function isCurrentPlayer(player) {
    return isCurrentDevicePlayer(player, state.clientId);
  }

  function getControllerId(player, roomData = state.room) {
    return getPlayerControllerId(player, roomData, {
      currentRoomId: state.room.roomId,
      localClientId: state.clientId,
      players: state.players
    });
  }

  function canCurrentClientControlPlayer(player) {
    return canClientControlPlayer(state.clientId, player, state.room);
  }

  function canCurrentClientManageRoom() {
    return canClientManage(state.clientId, state.room);
  }

  function canCurrentClientEditRoomSettings() {
    if (isLocalMode() || !state.room.roomId) return true;
    return getRoomHostClientId(state.room) === state.clientId;
  }

  function getCurrentRoomRoleLabel(roomData = state.room) {
    if (isLocalMode()) return "本地管理";
    if (getRoomHostClientId(roomData) === state.clientId) return "房主";
    const currentPlayer = getCurrentPlayer(roomData.players || state.players);
    if (currentPlayer && normalizeAdminPlayerIds(roomData.adminPlayerIds).includes(currentPlayer.id)) return "协管";
    if (canClientManage(state.clientId, roomData)) return "管理员";
    return "玩家";
  }

  function canCurrentClientModifyClaims() {
    return isRoomMode() && Boolean(state.room.roomId);
  }

  function canCurrentClientConfirmDeal() {
    const dealer = state.players.find(player => player.dealer) || null;
    return isLocalMode() || canCurrentClientControlPlayer(dealer);
  }

  function isInteractionLocked() {
    return state.mutationInProgress || state.syncWriteInProgress || (needsRemoteSync() && !state.syncReady);
  }

  function getEligiblePlayerIndices(list = state.players) {
    return collectEligiblePlayerIndices(list);
  }

  function getCallAmount(player) {
    return calculateCallAmount(player, state.currentBet);
  }

  function getCallButtonLabel(player) {
    const amount = getCallAmount(player);
    if (amount <= 0) return "Call";
    if (player.chips < amount) return `All In ${player.chips}`;
    return `Call ${amount}`;
  }

  function getChipStep() {
    return calculateChipStep(state.smallBlind, state.bigBlind);
  }

  function getRaiseState() {
    return {
      currentBet: state.currentBet,
      lastRaiseSize: state.lastRaiseSize,
      bigBlind: state.bigBlind,
      smallBlind: state.smallBlind,
      pot: state.pot,
      chipStep: getChipStep()
    };
  }

  function mergePlayerIdentityFields(nextPlayers, sourcePlayers = state.players, { preserveNames = false } = {}) {
    const sourceById = new Map(normalizeIncomingPlayers(sourcePlayers).map(player => [player.id, player]));
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

  return {
    isLocalMode,
    isRoomMode,
    needsRemoteSync,
    getRememberedAdminCode,
    rememberPlayerCode,
    getRememberedPlayerCode,
    getPlayerCodeSalt,
    isPlayerCodeValid,
    isAdminCodeValid,
    getHostClientId: getRoomHostClientId,
    isClientAdminInRoom: isClientAdmin,
    getRoomManagerProxyId: getManagerProxyId,
    canClientManageRoomData: canClientManage,
    canClientControlPlayerInRoom: canClientControlPlayer,
    getCurrentDevicePlayerIndex: getCurrentPlayerIndex,
    getCurrentDevicePlayer: getCurrentPlayer,
    isCurrentDevicePlayer: isCurrentPlayer,
    getPlayerControllerId: getControllerId,
    canCurrentClientControlPlayer,
    canCurrentClientManageRoom,
    canCurrentClientEditRoomSettings,
    getCurrentRoomRoleLabel,
    canCurrentClientModifyClaims,
    canCurrentClientConfirmDeal,
    isInteractionLocked,
    isSharedPromptActionLocked: isInteractionLocked,
    getPlayerName,
    getRawPlayerName,
    getPlayerIdentityLabel: (player, index = state.players.indexOf(player), list = state.players) => getPlayerIdentityLabel(player, index, list),
    getPlayerCompactIdentityLabel: (player, index = state.players.indexOf(player), list = state.players) => getPlayerCompactIdentityLabel(player, index, list),
    getClientShortId: (value = state.clientId) => getClientShortId(value),
    getPlayerById: id => state.players.find(player => player.id === id),
    getEligiblePlayerIndices,
    getCallAmount,
    getCallButtonLabel,
    getRaiseState,
    canPlayerRaise: player => canPlayerRaiseWithState(player, getRaiseState()),
    getChipStep,
    getMaximumRaiseTarget: calculateMaximumRaiseTarget,
    getMinimumRaiseTarget: player => calculateMinimumRaiseTarget(player, getRaiseState()),
    getDefaultRaiseTarget: player => calculateDefaultRaiseTarget(player, getRaiseState()),
    getPotSizedRaiseTarget: (player, fraction) => calculatePotSizedRaiseTarget(player, fraction, getRaiseState()),
    getRaiseValidation: (player, target) => validateRaiseTarget(player, target, getRaiseState()),
    mergePlayerIdentityFields
  };
}
