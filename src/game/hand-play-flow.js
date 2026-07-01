// src/game/hand-play-flow.js
// In-hand betting and street progression workflow.

import {
  createDealPrompt
} from "../core/deal-prompts.js";
import {
  applyBettingAction,
  findNextActionableIndex as findNextActionableIndexData,
  getAutomaticHandEndState,
  isBettingRoundComplete as isBettingRoundCompleteData
} from "../core/hand-flow-controller.js";
import {
  canAct
} from "../core/game-rules.js";
import {
  getFirstActionIndexForRound as getFirstActionIndexForRoundData,
  prepareRoundStartState
} from "./hand-controller.js";
import {
  normalizeIncomingPlayers
} from "../room/room-state.js";

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function createHandPlayFlow({
  getState,
  mutations = {},
  labels = {},
  rules = {},
  permissions = {},
  remote = {},
  ui = {},
  actions = {}
} = {}) {
  function getHandState() {
    return {
      players: [],
      currentPlayerIndex: -1,
      pot: 0,
      currentBet: 0,
      lastRaiseSize: 20,
      currentRound: 0,
      rounds: [],
      bigBlind: 20,
      smallBlind: 10,
      handId: 0,
      handStatus: "setup",
      gameOver: false,
      awaitingShowdown: false,
      stateVersion: 0,
      mutationInProgress: false,
      room: {},
      clientId: "",
      ...(getState ? getState() : {})
    };
  }

  function applyState(patch = {}) {
    mutations.applyState?.(patch);
  }

  function findNextActionableIndex(startIndex, includeStart = false) {
    return findNextActionableIndexData(getHandState().players, startIndex, includeStart);
  }

  function getFirstActionIndexForRound(round = getHandState().currentRound) {
    return getFirstActionIndexForRoundData(getHandState().players, round);
  }

  function applyRoundStartState(roundState) {
    const patch = {
      players: roundState.players,
      currentBet: roundState.currentBet,
      lastRaiseSize: roundState.lastRaiseSize,
      selectedWinnersByPot: roundState.selectedWinnersByPot,
      pendingDealPrompt: roundState.pendingDealPrompt,
      settlementPreview: roundState.settlementPreview,
      nextHandApprovals: roundState.nextHandApprovals,
      gameOver: roundState.gameOver,
      handStatus: roundState.handStatus,
      currentPlayerIndex: roundState.currentPlayerIndex,
      pot: roundState.pot
    };
    if (roundState.pendingPots !== undefined) patch.pendingPots = roundState.pendingPots;
    if (roundState.awaitingShowdown !== undefined) patch.awaitingShowdown = roundState.awaitingShowdown;
    applyState(patch);
  }

  function startRound() {
    const state = getHandState();
    ui.hideShowdownPanel?.();
    ui.hideDealPromptPanel?.();
    ui.hideSettlementPreviewPanel?.();

    const roundState = prepareRoundStartState({
      players: state.players,
      currentRound: state.currentRound,
      pot: state.pot,
      bigBlind: state.bigBlind,
      smallBlind: state.smallBlind,
      handId: state.handId
    });
    applyRoundStartState(roundState);
    const latest = getHandState();

    if (roundState.outcome === "insufficientPlayers") {
      ui.updateGameInfo?.();
      ui.updatePlayerBoxes?.();
      ui.updateGameLog?.("至少需要 2 名已入座且有筹码的玩家才能开始下一局。");
      ui.showNextHandButton?.();
      remote.updateFirebaseState?.();
      return;
    }

    if (roundState.outcome === "waitingDeal") {
      const blindPosts = roundState.blindPosts;
      ui.updateGameInfo?.();
      ui.updatePlayerBoxes?.();
      ui.updateGameLog?.(`盲注已自动下入：${labels.getPlayerIdentityLabel?.(latest.players[blindPosts.smallBlindIndex])} ${blindPosts.smallBlindPosted}，${labels.getPlayerIdentityLabel?.(latest.players[blindPosts.bigBlindIndex])} ${blindPosts.bigBlindPosted}。请发两张底牌。`);
      ui.renderDealPromptPanel?.();
      ui.clearHandActions?.();
      remote.updateFirebaseState?.();
      return;
    }

    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.(`进入 ${latest.rounds[latest.currentRound]} 轮，奖池：${latest.pot}`);

    if (handleAutomaticHandEnd()) return;

    if (getHandState().currentPlayerIndex === -1) {
      actions.beginShowdown?.();
      return;
    }

    const nextState = getHandState();
    ui.updateGameLog?.(`轮到 ${labels.getPlayerIdentityLabel?.(nextState.players[nextState.currentPlayerIndex])} 行动`);
    remote.updateFirebaseState?.();
  }

  async function playerAction(action, index, amount = 0) {
    const state = getHandState();
    const expectedHandId = state.handId;
    const expectedStateVersion = state.stateVersion;

    if (state.mutationInProgress || state.gameOver || state.awaitingShowdown || state.handStatus !== "playing") {
      ui.showAppAlert?.("当前手牌已结束或正在等待结算");
      return;
    }
    if (index !== state.currentPlayerIndex) {
      ui.showAppAlert?.("当前不是你的回合！");
      return;
    }

    const player = state.players[index];
    if (!permissions.canCurrentClientControlPlayer?.(player)) {
      ui.showAppAlert?.("你不能操作这个玩家。");
      return;
    }
    if (!canAct(player)) {
      ui.showAppAlert?.("该玩家当前不能行动");
      return;
    }

    if (action === "fold") {
      const confirmed = await ui.showAppConfirm?.(`${labels.getPlayerIdentityLabel?.(player)} 确认弃牌？`, {
        title: "确认 Fold",
        confirmLabel: "确认弃牌",
        danger: true
      });
      if (!confirmed) return;
    }

    mutations.setMutationInProgress?.(true);
    const remoteGameState = await remote.getRemoteGameState?.();
    const latestBeforeRemote = getHandState();
    if (!remoteGameState && latestBeforeRemote.room.roomId) {
      mutations.setMutationInProgress?.(false);
      ui.showAppAlert?.("还没有完成同步，不能操作");
      return;
    }
    if (remoteGameState) {
      const remoteHandId = toNonNegativeNumber(remoteGameState.handId, 0);
      const remoteStatus = String(remoteGameState.handStatus || actions.inferHandStatus?.(remoteGameState));
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
        mutations.setMutationInProgress?.(false);
        ui.showAppAlert?.("牌局状态已在其他设备更新，请等待同步后再操作");
        return;
      }
    }

    mutations.setBatchingStateUpdate?.(true);
    const latest = getHandState();
    const actionResult = applyBettingAction({
      players: latest.players,
      index,
      action,
      amount,
      currentBet: latest.currentBet,
      lastRaiseSize: latest.lastRaiseSize,
      pot: latest.pot,
      raiseState: rules.getRaiseState?.()
    });
    if (!actionResult.ok) {
      ui.showAppAlert?.(actionResult.message);
      mutations.setBatchingStateUpdate?.(false);
      mutations.setMutationInProgress?.(false);
      return;
    }

    applyState({
      players: actionResult.players,
      currentBet: actionResult.currentBet,
      lastRaiseSize: actionResult.lastRaiseSize,
      pot: actionResult.pot
    });

    const afterAction = getHandState();
    ui.updateGameLog?.(`${labels.getPlayerIdentityLabel?.(afterAction.players[index])} 选择了 ${actionResult.logAction}，奖池：${afterAction.pot}`);
    nextPlayer();
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["playing"],
      expectedStateVersion,
      remoteGuard: (currentRoom) => {
        const remotePlayers = normalizeIncomingPlayers(currentRoom.players);
        const remotePlayer = remotePlayers[index];
        return Boolean(remotePlayer && permissions.canClientControlPlayerInRoom?.(getHandState().clientId, remotePlayer, currentRoom));
      }
    });
    mutations.setMutationInProgress?.(false);
    if (!saved) {
      ui.showAppAlert?.("操作没有同步成功，已恢复到最新远端状态");
    }
  }

  function handleAutomaticHandEnd() {
    const state = getHandState();
    const endState = getAutomaticHandEndState(state.players, state.currentBet);
    if (endState.type === "awardRemainingPot") {
      actions.awardRemainingPot?.(endState.winnerId ? actions.getPlayerById?.(endState.winnerId) : null);
      return true;
    }
    if (endState.type === "showdown") {
      actions.beginShowdown?.();
      return true;
    }
    return false;
  }

  function isBettingRoundComplete() {
    const state = getHandState();
    return isBettingRoundCompleteData(state.players, state.currentBet);
  }

  function nextPlayer() {
    if (handleAutomaticHandEnd()) return;

    const state = getHandState();
    if (isBettingRoundComplete()) {
      if (state.currentRound === state.rounds.length - 1) {
        actions.beginShowdown?.();
      } else {
        endRound();
      }
      return;
    }

    const nextIndex = findNextActionableIndex(state.currentPlayerIndex);
    if (nextIndex === -1) {
      if (state.currentRound === state.rounds.length - 1) {
        actions.beginShowdown?.();
      } else {
        endRound();
      }
      return;
    }

    applyState({ currentPlayerIndex: nextIndex });
    const latest = getHandState();
    ui.updateGameLog?.(`轮到 ${labels.getPlayerIdentityLabel?.(latest.players[latest.currentPlayerIndex])} 行动`);
    ui.updatePlayerBoxes?.();
    remote.updateFirebaseState?.();
  }

  function endRound() {
    const state = getHandState();
    const nextRound = state.currentRound + 1;
    const pendingDealPrompt = createDealPrompt(nextRound, { handId: state.handId });
    applyState({
      pendingDealPrompt,
      handStatus: "waitingDeal",
      currentPlayerIndex: -1
    });
    ui.updateGameLog?.(`${state.rounds[state.currentRound]} 下注结束，${pendingDealPrompt.cardText}后继续。`);
    ui.updateGameInfo?.();
    ui.updatePlayerBoxes?.();
    ui.renderDealPromptPanel?.();
    ui.clearHandActions?.();
  }

  async function confirmDealPrompt() {
    const state = getHandState();
    const prompt = state.pendingDealPrompt;
    const expectedHandId = state.handId;
    const expectedStateVersion = state.stateVersion;

    if (permissions.isSharedPromptActionLocked?.() || state.handStatus !== "waitingDeal" || !prompt) {
      ui.showAppAlert?.("当前没有等待确认的发牌提示");
      return;
    }
    if (!permissions.canCurrentClientConfirmDeal?.()) {
      ui.showAppAlert?.("只有本局 Dealer 可以确认发牌；未绑定 Dealer 由房主/协管代管。");
      return;
    }

    mutations.setMutationInProgress?.(true);
    mutations.setBatchingStateUpdate?.(true);
    const isOpeningDeal = prompt.nextRound === 0;
    applyState({
      handStatus: "playing",
      pendingDealPrompt: null
    });

    if (isOpeningDeal) {
      applyState({
        currentRound: 0,
        currentPlayerIndex: findNextActionableIndex(getFirstActionIndexForRound(0), true)
      });
      ui.hideDealPromptPanel?.();
      ui.updateGameInfo?.();
      ui.updatePlayerBoxes?.();
      ui.updateGameLog?.("底牌已发，进入翻牌前行动。");

      if (!handleAutomaticHandEnd()) {
        const latest = getHandState();
        if (latest.currentPlayerIndex === -1) {
          actions.beginShowdown?.();
        } else {
          ui.updateGameLog?.(`轮到 ${labels.getPlayerIdentityLabel?.(latest.players[latest.currentPlayerIndex])} 行动`);
        }
      }
    } else {
      applyState({ currentRound: prompt.nextRound });
      startRound();
    }
    mutations.setBatchingStateUpdate?.(false);

    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["waitingDeal"],
      expectedStateVersion,
      remoteGuard: (currentRoom) => {
        const remoteDealer = normalizeIncomingPlayers(currentRoom.players).find(player => player.dealer);
        return permissions.canClientControlPlayerInRoom?.(getHandState().clientId, remoteDealer, currentRoom);
      }
    });
    mutations.setMutationInProgress?.(false);
    if (!saved) {
      ui.showAppAlert?.("发牌确认没有同步成功，已恢复到最新远端状态");
    }
  }

  return {
    findNextActionableIndex,
    getFirstActionIndexForRound,
    startRound,
    playerAction,
    nextPlayer,
    endRound,
    confirmDealPrompt
  };
}
