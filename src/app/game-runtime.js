import { createHandPlayFlow } from "../game/hand-play-flow.js";
import { createNextHandFlow } from "../game/next-hand-flow.js";
import { createSettlementFlow } from "../game/settlement-flow.js";
import { createStartGameFlow } from "../game/start-game-flow.js";
import { transactRoom } from "../room/room-sync.js";
import { showAppAlert, showAppConfirm } from "../ui/dialogs.js";
import { inferHandStatus } from "./app-policy.js";
import { MAX_PLAYERS } from "./app-state.js";

export function createGameRuntime({ store, elements, policy, ui, roomRuntime }) {
  const { state } = store;
  const { roomSession, setupLobby, gameSync, approvals } = roomRuntime;
  let handPlay;
  let settlement;
  let nextHand;

  const updateFirebaseState = options => gameSync.updateFirebaseState(options);
  const isRemoteHandStill = (handId, statuses) => gameSync.isRemoteHandStill(handId, statuses);

  handPlay = createHandPlayFlow({
    getState: store.getState,
    mutations: {
      applyState: store.patch,
      setMutationInProgress: ui.setMutationInProgress,
      setBatchingStateUpdate: inProgress => {
        state.batchingStateUpdate = Boolean(inProgress);
      }
    },
    labels: policy,
    rules: {
      getRaiseState: policy.getRaiseState
    },
    permissions: policy,
    remote: {
      getRemoteGameState: roomSession.getRemoteGameState,
      updateFirebaseState
    },
    ui: {
      showAppAlert,
      showAppConfirm,
      hideShowdownPanel: ui.hideShowdownPanel,
      hideDealPromptPanel: ui.hideDealPromptPanel,
      hideSettlementPreviewPanel: ui.hideSettlementPreviewPanel,
      renderDealPromptPanel: ui.renderDealPromptPanel,
      clearHandActions: ui.clearHandActions,
      showNextHandButton: ui.showNextHandButton,
      updateGameInfo: ui.updateGameInfo,
      updatePlayerBoxes: ui.updatePlayerBoxes,
      updateGameLog: ui.updateGameLog
    },
    actions: {
      beginShowdown: (...args) => settlement.beginShowdown(...args),
      awardRemainingPot: (...args) => settlement.awardRemainingPot(...args),
      getPlayerById: policy.getPlayerById,
      inferHandStatus
    }
  });

  settlement = createSettlementFlow({
    getState: store.getState,
    mutations: {
      applyState: store.patch,
      setMutationInProgress: ui.setMutationInProgress,
      setBatchingStateUpdate: inProgress => {
        state.batchingStateUpdate = Boolean(inProgress);
      },
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      }
    },
    labels: policy,
    permissions: policy,
    approvals,
    remote: {
      isRemoteHandStill,
      updateFirebaseState,
      transactRoom,
      refreshFromRemote: roomSession.refreshFromRemote
    },
    ui: {
      showAppAlert,
      setSyncStatus: ui.setSyncStatus,
      hideShowdownPanel: ui.hideShowdownPanel,
      hideDealPromptPanel: ui.hideDealPromptPanel,
      renderDealPromptPanel: ui.renderDealPromptPanel,
      hideSettlementPreviewPanel: ui.hideSettlementPreviewPanel,
      renderSettlementPreviewPanel: ui.renderSettlementPreviewPanel,
      renderShowdownPanel: ui.renderShowdownPanel,
      clearHandActions: ui.clearHandActions,
      showNextHandButton: ui.showNextHandButton,
      updateGameInfo: ui.updateGameInfo,
      updatePlayerBoxes: ui.updatePlayerBoxes,
      updateGameLog: ui.updateGameLog
    },
    actions: {
      getPlayerById: policy.getPlayerById,
      inferHandStatus
    }
  });

  nextHand = createNextHandFlow({
    getState: store.getState,
    mutations: {
      applyState: store.patch,
      setMutationInProgress: ui.setMutationInProgress,
      setBatchingStateUpdate: inProgress => {
        state.batchingStateUpdate = Boolean(inProgress);
      },
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      },
      setRoomGameInProgress: inProgress => {
        state.room.gameState.inProgress = Boolean(inProgress);
      }
    },
    permissions: policy,
    approvals,
    rules: {
      getEligiblePlayerIndices: policy.getEligiblePlayerIndices
    },
    remote: {
      transactRoom,
      refreshFromRemote: roomSession.refreshFromRemote,
      isRemoteHandStill,
      updateFirebaseState
    },
    ui: {
      showAppAlert,
      setSyncStatus: ui.setSyncStatus,
      renderNextHandButton: ui.renderNextHandButton,
      clearGameLog: ui.clearGameLog,
      clearHandActions: ui.clearHandActions,
      hideShowdownPanel: ui.hideShowdownPanel,
      hideDealPromptPanel: ui.hideDealPromptPanel,
      hideSettlementPreviewPanel: ui.hideSettlementPreviewPanel
    },
    actions: {
      inferHandStatus,
      startRound: handPlay.startRound
    }
  });

  const startGame = createStartGameFlow({
    elements: {
      startGameBtn: elements.startGameBtn,
      roomIdInput: elements.roomIdInput,
      bigBlindInput: elements.bigBlindInput
    },
    maxPlayers: MAX_PLAYERS,
    getState: store.getState,
    mutations: {
      applyRoomPatch: patch => {
        store.setRoom({ ...state.room, ...patch });
      },
      applyStartState: patch => {
        store.patch({
          players: patch.players,
          bigBlind: patch.bigBlind,
          smallBlind: patch.smallBlind,
          selectedWinnersByPot: {},
          pendingDealPrompt: null,
          settlementPreview: null,
          nextHandApprovals: {},
          pendingPots: [],
          awaitingShowdown: false,
          handId: patch.handId,
          handStatus: "playing",
          gameStarted: true,
          gameOver: false,
          currentRound: 0,
          currentBet: 0,
          lastRaiseSize: patch.bigBlind,
          pot: 0
        });
        state.room.gameState.inProgress = true;
      },
      setMutationInProgress: ui.setMutationInProgress,
      setSyncReady: ready => {
        state.syncReady = Boolean(ready);
      }
    },
    modes: policy,
    permissions: policy,
    remote: {
      remoteRoomExists: roomSession.remoteRoomExists,
      createRoomIfAvailable: roomSession.createRoomIfAvailable,
      joinRoom: roomSession.joinRoom,
      refreshFromRemote: roomSession.refreshFromRemote,
      getRemoteGameState: roomSession.getRemoteGameState,
      stopListener: roomSession.stopListener
    },
    setup: {
      normalizePlayers: setupLobby.normalizePlayers,
      createPlayerId: setupLobby.createPlayerId
    },
    ui: {
      showAppAlert,
      setSyncStatus: ui.setSyncStatus,
      clearGameLog: ui.clearGameLog,
      showGameTable: ui.showGameTable,
      clearHandActions: ui.clearHandActions,
      hideShowdownPanel: ui.hideShowdownPanel,
      hideDealPromptPanel: ui.hideDealPromptPanel,
      hideSettlementPreviewPanel: ui.hideSettlementPreviewPanel
    },
    actions: {
      inferHandStatus,
      startRound: handPlay.startRound
    }
  });

  return {
    init: startGame.bindStartButton,
    handPlay,
    settlement,
    nextHand,
    startGame,
    updateFirebaseState,
    isRemoteHandStill,
    playerAction: handPlay.playerAction,
    confirmDealPrompt: handPlay.confirmDealPrompt,
    startRound: handPlay.startRound,
    toggleWinner: settlement.toggleWinner,
    buildSettlementPlan: settlement.buildSettlementPlan,
    confirmShowdown: settlement.confirmShowdown,
    cancelSettlementPreview: settlement.cancelSettlementPreview,
    confirmSettlementPreview: settlement.confirmSettlementPreview,
    approveNextHandStart: nextHand.approveNextHandStart,
    resetHand: nextHand.resetHand
  };
}
