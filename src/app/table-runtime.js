import { createTableManagerFlow } from "../table/table-manager-flow.js";
import { createTableSaveFlow } from "../table/table-save-flow.js";
import { createTableScreenController } from "../table/table-screen-controller.js";
import { transactRoom } from "../room/room-sync.js";
import { showAppAlert } from "../ui/dialogs.js";
import { toPositiveInteger } from "./app-policy.js";
import { MAX_PLAYERS } from "./app-state.js";

export function createTableRuntime({ store, elements, policy, ui, roomRuntime, gameRuntime }) {
  const { state } = store;
  const { roomSession, setupLobby, identity, approvals } = roomRuntime;
  let tableManager;

  const tableSave = createTableSaveFlow({
    maxPlayers: MAX_PLAYERS,
    getState: store.getState,
    mutations: {
      setPlayers: store.setPlayers,
      setRoom: store.setRoom,
      setNextHandApprovals: approvalsMap => {
        state.nextHandApprovals = approvalsMap;
      },
      setMutationInProgress: ui.setMutationInProgress,
      setBatchingStateUpdate: inProgress => {
        state.batchingStateUpdate = Boolean(inProgress);
      }
    },
    permissions: policy,
    rules: {
      getEligiblePlayerIndices: policy.getEligiblePlayerIndices
    },
    remote: {
      transactRoom,
      refreshFromRemote: roomSession.refreshFromRemote,
      updateFirebaseState: gameRuntime.updateFirebaseState
    },
    setup: {
      renderPlayers: setupLobby.renderPlayers,
      updateActionState: setupLobby.updateActionState,
      sync: setupLobby.sync
    },
    ui: {
      showAppAlert,
      closeTableManager: (...args) => tableManager?.close(...args),
      renderTableManagerIfOpen: (...args) => tableManager?.renderIfOpen(...args),
      updatePlayerBoxes: ui.updatePlayerBoxes,
      updateGameLog: ui.updateGameLog
    },
    helpers: {
      mergePlayerIdentityFields: policy.mergePlayerIdentityFields
    }
  });

  tableManager = createTableManagerFlow({
    elements: {
      backdrop: elements.tableManagerBackdrop,
      panel: elements.tableManagerPanel
    },
    maxPlayers: MAX_PLAYERS,
    getState: store.getState,
    getInitialChips: () => toPositiveInteger(elements.initialChipsInput?.value, 1000),
    canEditTableNow: tableSave.canEditTableNow,
    isSharedPromptActionLocked: policy.isSharedPromptActionLocked,
    isLocalMode: policy.isLocalMode,
    isRoomMode: policy.isRoomMode,
    getEligiblePlayerIndices: policy.getEligiblePlayerIndices,
    labels: policy,
    identity: {
      getCurrentDevicePlayer: policy.getCurrentDevicePlayer,
      canCurrentClientManageRoom: policy.canCurrentClientManageRoom,
      getCurrentDisplayName: identity.getCurrentDisplayName,
      getGuestDisplayName: identity.getGuestDisplayName,
      getPendingJoinRequestCount: identity.getPendingJoinRequestCount,
      getCurrentRoomRoleLabel: policy.getCurrentRoomRoleLabel,
      getClientShortId: policy.getClientShortId
    },
    actions: {
      releaseCurrentPlayerIdentity: identity.releaseCurrentPlayerIdentity,
      copyInviteLink: roomSession.copyInviteLink,
      saveCurrentDisplayName: identity.saveCurrentDisplayName,
      setSyncStatus: ui.setSyncStatus,
      approveSeatRequest: identity.approveSeatRequest,
      declineSeatRequest: identity.declineSeatRequest,
      togglePlayerClaim: identity.togglePlayerClaim,
      togglePlayerAdmin: tableSave.togglePlayerAdmin,
      createPlayerId: setupLobby.createPlayerId,
      removeAdminPlayerId: tableSave.removeAdminPlayerId,
      commitTableDraft: tableSave.commitTableDraft,
      approveNextHandStart: gameRuntime.approveNextHandStart
    },
    formatters: {
      getPlayerName: policy.getPlayerName,
      getSavedPlayer: playerId => state.players.find(item => item.id === playerId),
      isCurrentDevicePlayer: policy.isCurrentDevicePlayer,
      getClientShortId: policy.getClientShortId,
      getJoinRequestsForPlayer: identity.getJoinRequestsForPlayer
    }
  });

  const tableScreen = createTableScreenController({
    elements: {
      handActions: elements.handActions,
      showdownPanel: elements.showdownPanel,
      dealPromptPanel: elements.dealPromptPanel,
      settlementPreviewPanel: elements.settlementPreviewPanel
    },
    maxPlayers: MAX_PLAYERS,
    getState: store.getState,
    modes: policy,
    permissions: policy,
    labels: {
      getPlayerIdentityLabel: policy.getPlayerIdentityLabel,
      getPlayerCompactIdentityLabel: policy.getPlayerCompactIdentityLabel,
      getSetupClaimLabel: identity.getSetupClaimLabel
    },
    betting: policy,
    approvals,
    actions: {
      playerAction: gameRuntime.playerAction,
      confirmDealPrompt: gameRuntime.confirmDealPrompt,
      openTableManager: tableManager.open,
      approveNextHandStart: gameRuntime.approveNextHandStart,
      togglePlayerClaim: identity.togglePlayerClaim,
      getPlayerById: policy.getPlayerById,
      toggleWinner: gameRuntime.toggleWinner,
      buildSettlementPlan: gameRuntime.buildSettlementPlan,
      confirmShowdown: gameRuntime.confirmShowdown,
      cancelSettlementPreview: gameRuntime.cancelSettlementPreview,
      confirmSettlementPreview: gameRuntime.confirmSettlementPreview
    }
  });

  ui.bind({ tableManager, tableScreen });

  function init() {
    document.addEventListener("click", event => {
      tableScreen.closeSeatPopoversOnOutsideClick(event);
    });
  }

  return {
    init,
    tableSave,
    tableManager,
    tableScreen
  };
}
