import { createApprovalLabels } from "../room/approval-labels.js";
import { createClientAuthFlow } from "../room/client-auth-flow.js";
import { createGameSyncFlow } from "../room/game-sync-flow.js";
import { createIdentityToolbarFlow } from "../room/identity-toolbar-flow.js";
import { normalizeJoinRequests } from "../room/room-entry.js";
import { createRoomDataFlow } from "../room/room-data-flow.js";
import { createRoomSessionFlow } from "../room/room-session-flow.js";
import { transactRoom } from "../room/room-sync.js";
import { createSeatIdentityFlow } from "../room/seat-identity-flow.js";
import { createSetupLobbyFlow } from "../room/setup-lobby-flow.js";
import {
  createMembersMap,
  getRoomHostId,
  normalizeAdminPlayerIds,
  normalizeMembers,
  normalizeRoomMode
} from "../room/identity.js";
import { showAppAlert } from "../ui/dialogs.js";
import { inferHandStatus } from "./app-policy.js";
import { MAX_PLAYERS } from "./app-state.js";

export function createRoomRuntime({ store, elements, policy, ui }) {
  const { state } = store;
  let setupLobby;
  let roomSession;
  let roomData;

  const identity = createSeatIdentityFlow({
    getState: store.getState,
    modes: policy,
    permissions: policy,
    labels: policy,
    access: policy,
    remote: {
      updateRoomMemberPresence: (...args) => roomSession?.updateMemberPresence(...args),
      setMutationInProgress: ui.setMutationInProgress,
      setSyncStatus: ui.setSyncStatus,
      refreshFromRemote: (...args) => roomSession?.refreshFromRemote(...args),
      setSyncReady: value => {
        state.syncReady = Boolean(value);
      },
      inferHandStatus,
      getRoomHostId,
      normalizeRoomMode
    },
    applyLocalClaimResult: result => {
      store.setPlayers(result.players);
      state.room.members = result.members;
      if (result.resetNextHandApprovals) state.nextHandApprovals = {};
    },
    setLocalJoinRequest: (requestClientId, request) => {
      state.room.joinRequests = {
        ...normalizeJoinRequests(state.room.joinRequests),
        [requestClientId]: request
      };
    },
    refreshUi: {
      getAliasInputValue: ui.getAliasInputValue,
      setAliasInputValue: ui.setAliasInputValue,
      renderIdentityControls: ui.renderIdentityControls,
      renderTableManagerIfOpen: ui.renderTableManagerIfOpen,
      renderSetupPlayerInputs: ui.renderSetupPlayers,
      updatePlayerBoxes: ui.updatePlayerBoxes,
      renderTableViewToolbar: ui.renderTableViewToolbar
    }
  });

  const approvals = createApprovalLabels({
    getState: store.getState,
    identity: {
      getPlayerControllerId: policy.getPlayerControllerId,
      getHostClientId: policy.getHostClientId
    },
    labels: policy
  });

  setupLobby = createSetupLobbyFlow({
    elements: {
      playerNameInputsContainer: elements.playerNameInputsContainer,
      startGameBtn: elements.startGameBtn,
      addPlayerBtn: elements.addPlayerBtn,
      initialChipsInput: elements.initialChipsInput,
      bigBlindInput: elements.bigBlindInput
    },
    maxPlayers: MAX_PLAYERS,
    getState: store.getState,
    mutations: {
      setPlayers: store.setPlayers,
      setRoom: store.setRoom,
      setStateVersion: version => {
        state.stateVersion = version;
      },
      setSyncWriteInProgress: inProgress => {
        state.syncWriteInProgress = Boolean(inProgress);
      },
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      }
    },
    modes: policy,
    permissions: policy,
    identity: {
      getSetupClaimLabel: identity.getSetupClaimLabel,
      togglePlayerClaim: identity.togglePlayerClaim,
      touchMemberWithProfile: identity.touchMemberWithProfile
    },
    remote: {
      transactRoom,
      refreshFromRemote: (...args) => roomSession?.refreshFromRemote(...args),
      getRoomHostId,
      inferHandStatus
    },
    ui: {
      showAppAlert,
      setSyncStatus: ui.setSyncStatus,
      renderIdentityControls: ui.renderIdentityControls
    },
    helpers: {
      mergePlayerIdentityFields: policy.mergePlayerIdentityFields,
      normalizeAdminPlayerIds,
      normalizeJoinRequests
    }
  });

  roomSession = createRoomSessionFlow({
    elements: {
      roomIdInput: elements.roomIdInput,
      playerAliasInput: elements.playerAliasInput,
      copyInviteBtn: elements.copyInviteBtn,
      localModeBtn: elements.localModeBtn,
      roomModeBtn: elements.roomModeBtn,
      createRoomBtn: elements.createRoomBtn,
      joinRoomBtn: elements.joinRoomBtn
    },
    getState: store.getState,
    mutations: {
      setRoom: store.setRoom,
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      },
      setHandId: handId => {
        state.handId = handId;
      },
      setHandStatus: handStatus => {
        state.handStatus = handStatus;
      }
    },
    modes: policy,
    identity: {
      touchMemberWithProfile: identity.touchMemberWithProfile,
      rememberPreferredDisplayName: identity.rememberPreferredDisplayName,
      getPreferredDisplayName: identity.getPreferredDisplayName
    },
    setup: {
      renderPlayers: setupLobby.renderPlayers,
      sync: setupLobby.sync
    },
    remote: {
      applyRoomData: data => roomData?.applyRoomData(data)
    },
    ui: {
      showAppAlert,
      setSyncStatus: ui.setSyncStatus,
      renderIdentityControls: ui.renderIdentityControls,
      updatePlayerBoxes: ui.updatePlayerBoxes,
      loadTableViewRotation: ui.loadTableViewRotation,
      refreshInteractiveControls: ui.refreshInteractiveControls
    },
    helpers: {
      createMembersMap
    }
  });

  const gameSync = createGameSyncFlow({
    getState: store.getState,
    mutations: {
      setRoom: store.setRoom,
      setStateVersion: version => {
        state.stateVersion = version;
      },
      setSyncWriteInProgress: inProgress => {
        state.syncWriteInProgress = Boolean(inProgress);
      },
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      }
    },
    remote: {
      transactRoom,
      getRemoteGameState: roomSession.getRemoteGameState,
      refreshFromRemote: roomSession.refreshFromRemote
    },
    ui: {
      setSyncStatus: ui.setSyncStatus,
      refreshInteractiveControls: ui.refreshInteractiveControls
    },
    helpers: {
      inferHandStatus,
      mergePlayerIdentityFields: policy.mergePlayerIdentityFields,
      normalizeRoomMode,
      getRoomHostId,
      normalizeAdminPlayerIds,
      normalizeJoinRequests,
      normalizeMembers,
      touchMemberWithProfile: identity.touchMemberWithProfile
    }
  });

  const identityToolbar = createIdentityToolbarFlow({
    elements: {
      localModeBtn: elements.localModeBtn,
      roomModeBtn: elements.roomModeBtn,
      roomEntry: elements.roomEntry,
      createRoomBtn: elements.createRoomBtn,
      joinRoomBtn: elements.joinRoomBtn,
      copyInviteBtn: elements.copyInviteBtn,
      playerAliasInput: elements.playerAliasInput,
      deviceIdentityEl: elements.deviceIdentityEl,
      tableViewToolbar: elements.tableViewToolbar
    },
    getState: store.getState,
    mutations: {
      setTableViewRotationOffset: offset => {
        state.tableViewRotationOffset = offset;
      }
    },
    modes: policy,
    permissions: policy,
    identity: {
      getCurrentDevicePlayer: policy.getCurrentDevicePlayer,
      getPendingJoinRequestCount: identity.getPendingJoinRequestCount,
      getCurrentDisplayName: identity.getCurrentDisplayName
    },
    labels: policy,
    actions: {
      openTableManager: ui.openTableManager
    },
    ui: {
      updatePlayerBoxes: ui.updatePlayerBoxes
    }
  });

  roomData = createRoomDataFlow({
    getState: store.getState,
    mutations: {
      applyRoomDataState: store.patch,
      setGameStarted: started => {
        state.gameStarted = Boolean(started);
      }
    },
    helpers: {
      touchMemberWithProfile: identity.touchMemberWithProfile
    },
    ui: {
      syncIdentityFromPlayers: ui.syncTableManagerIdentity,
      renderIdentityControls: ui.renderIdentityControls,
      renderGameLog: ui.renderGameLog,
      updateGameInfo: ui.updateGameInfo,
      updatePlayerBoxes: ui.updatePlayerBoxes,
      renderTableViewToolbar: ui.renderTableViewToolbar,
      renderDealPromptPanel: ui.renderDealPromptPanel,
      renderSettlementPreviewPanel: ui.renderSettlementPreviewPanel,
      hideShowdownPanel: ui.hideShowdownPanel,
      clearHandActions: ui.clearHandActions,
      renderShowdownPanel: ui.renderShowdownPanel,
      renderNextHandButton: ui.renderNextHandButton,
      renderCurrentActionPanel: ui.renderCurrentActionPanel,
      showGameTable: ui.showGameTable,
      showSetup: ui.showSetup
    },
    setup: {
      renderPlayers: setupLobby.renderPlayers
    },
    actions: {
      inferHandStatus
    }
  });

  const auth = createClientAuthFlow({
    getState: store.getState,
    mutations: {
      applyAuthenticatedClientState: store.patch,
      setAuthState: store.patch
    },
    modes: policy,
    identity: {
      touchMemberWithProfile: identity.touchMemberWithProfile
    },
    remote: {
      stopListener: roomSession.stopListener,
      listenFirebaseUpdates: roomSession.listenFirebaseUpdates,
      updateMemberPresence: roomSession.updateMemberPresence
    },
    ui: {
      refreshInteractiveControls: ui.refreshInteractiveControls,
      renderIdentityControls: ui.renderIdentityControls,
      setSyncStatus: ui.setSyncStatus
    }
  });

  ui.bind({ identityToolbar, setupLobby });

  function init() {
    if (elements.playerAliasInput) {
      elements.playerAliasInput.value = identity.getCurrentDisplayName();
      elements.playerAliasInput.addEventListener("change", async () => {
        await identity.saveCurrentDisplayName(elements.playerAliasInput.value, { announce: false });
      });
    }
    auth.startAnonymousIdentity();
    roomSession.bindEntryControls();
    roomSession.applyRoomLinkFromUrl();
    setupLobby.init();
    state.syncReady = !policy.isRoomMode();
    if (!policy.isRoomMode()) ui.setSyncStatus("本地模式");
    identityToolbar.renderIdentityControls();
  }

  return {
    init,
    identity,
    approvals,
    setupLobby,
    roomSession,
    gameSync,
    identityToolbar,
    roomData,
    auth
  };
}
