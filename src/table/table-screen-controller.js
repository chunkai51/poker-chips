import { getApprovalProgress } from "../core/approvals.js";
import { canAct, getSeatStatusLabel } from "../core/game-rules.js";
import { openTableActionDialog } from "../ui/dialogs.js";
import {
  closeSeatDetailPopovers,
  createPlayerSeatBox
} from "../ui/player-seat-ui.js";
import { renderRaisePanelContent } from "../ui/raise-ui.js";
import {
  createCenterOperationHeader,
  createTableCenterPanel as createTableCenterPanelView,
  createWaitingNotice,
  renderSettlementPreviewContent,
  renderShowdownSelection
} from "../ui/table-center-ui.js";
import { createButton } from "../ui/ui-dom.js";
import { getVisualSeatCoordinates } from "./table-layout.js";

export function createTableScreenController({
  elements,
  maxPlayers,
  getState,
  modes,
  permissions,
  labels,
  betting,
  approvals,
  actions
}) {
  const {
    handActions,
    showdownPanel,
    dealPromptPanel,
    settlementPreviewPanel
  } = elements;

  function getRoundDisplayText() {
    const { currentRound, rounds, handStatus, pendingDealPrompt } = getState();
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
    const { pot } = getState();
    const roundEl = document.getElementById("current-round");
    const potEl = document.getElementById("pot-amount");
    if (roundEl) roundEl.textContent = getRoundDisplayText();
    if (potEl) potEl.textContent = `奖池: ${pot}`;
  }

  function renderNextHandButton() {
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
    hideDealPromptPanel();
  }

  function hideSettlementPreviewPanel() {
    if (!settlementPreviewPanel) return;
    settlementPreviewPanel.hidden = true;
    settlementPreviewPanel.replaceChildren();
  }

  function renderSettlementPreviewPanel() {
    hideSettlementPreviewPanel();
  }

  function renderShowdownPanel() {
    hideShowdownPanel();
  }

  function shouldShowCurrentActionPanel() {
    const { players, currentPlayerIndex, gameOver, awaitingShowdown, handStatus } = getState();
    return !gameOver &&
      !awaitingShowdown &&
      handStatus === "playing" &&
      currentPlayerIndex >= 0 &&
      canAct(players[currentPlayerIndex]);
  }

  function createRaisePanel(player, index, actionDisabled) {
    const { pot, bigBlind } = getState();
    const raiseDisabled = actionDisabled || !betting.canPlayerRaise(player);
    const callAmount = betting.getCallAmount(player);
    const minimumTarget = betting.getMinimumRaiseTarget(player);
    const maximumTarget = betting.getMaximumRaiseTarget(player);

    return {
      open() {
        openTableActionDialog({
          title: `${labels.getPlayerIdentityLabel(player)} 加注`,
          description: `需跟 ${callAmount}，最小加注 ${minimumTarget}，当前奖池 ${pot}。`,
          className: "raise-action-dialog",
          buildContent(body, closeDialog) {
            const step = betting.getChipStep();
            renderRaisePanelContent(body, {
              infoItems: [
                `需跟 ${callAmount}`,
                `最小加到 ${minimumTarget}`,
                `奖池 ${pot}`
              ],
              presets: [
                ["最小", () => betting.getDefaultRaiseTarget(player)],
                ["1/2池", () => betting.getPotSizedRaiseTarget(player, 0.5)],
                ["2/3池", () => betting.getPotSizedRaiseTarget(player, 2 / 3)],
                ["一池", () => betting.getPotSizedRaiseTarget(player, 1)],
                ["All In", () => maximumTarget]
              ].map(([label, getTarget]) => ({
                label,
                target: getTarget()
              })),
              nudges: [
                [`-${bigBlind}`, -bigBlind],
                [`-${step}`, -step],
                [`+${step}`, step],
                [`+${bigBlind}`, bigBlind]
              ].map(([label, delta]) => ({ label, delta })),
              defaultTarget: betting.getDefaultRaiseTarget(player),
              maximumTarget,
              step,
              disabled: raiseDisabled,
              getValidation: rawTarget => betting.getRaiseValidation(player, rawTarget),
              onConfirm: rawTarget => {
                closeDialog();
                actions.playerAction("raise", index, rawTarget);
              }
            });
          }
        });
      }
    };
  }

  function createActionControls(player, index, actionDisabled, className = "") {
    const { currentBet } = getState();
    const actionsEl = document.createElement("div");
    actionsEl.className = className ? `actions ${className}` : "actions";
    const permissionDisabled = !permissions.canCurrentClientControlPlayer(player);
    const disabled = actionDisabled || permissionDisabled;

    actionsEl.appendChild(createButton("Check", () => actions.playerAction("check", index), disabled || player.bet < currentBet, "action-btn action-check"));
    actionsEl.appendChild(createButton(betting.getCallButtonLabel(player), () => actions.playerAction("call", index), disabled || player.bet >= currentBet, "action-btn action-call"));

    const raiseWidget = createRaisePanel(player, index, disabled);
    actionsEl.appendChild(createButton("Raise", () => {
      raiseWidget.open();
    }, disabled || !betting.canPlayerRaise(player), "action-btn action-raise"));
    actionsEl.appendChild(createButton("Fold", () => actions.playerAction("fold", index), disabled, "action-btn action-fold danger"));
    return actionsEl;
  }

  function renderCurrentActionPanel() {
    clearHandActions();
  }

  function openShowdownDialog() {
    const { awaitingShowdown, handStatus } = getState();
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
    const { pendingPots, selectedWinnersByPot } = getState();
    const pots = pendingPots.map((sidePot, potIndex) => {
      const contenderNames = sidePot.contenders
        .map(id => actions.getPlayerById(id))
        .filter(Boolean)
        .map(player => labels.getPlayerIdentityLabel(player))
        .join("、");
      if (!selectedWinnersByPot[potIndex]) {
        selectedWinnersByPot[potIndex] = new Set();
      }
      if (sidePot.contenders.length === 1) {
        selectedWinnersByPot[potIndex].add(sidePot.contenders[0]);
      }

      return {
        index: potIndex,
        amount: sidePot.amount,
        contenderNames,
        options: sidePot.contenders
          .map(playerId => {
            const player = actions.getPlayerById(playerId);
            if (!player) return null;
            return {
              playerId,
              label: labels.getPlayerIdentityLabel(player),
              selected: selectedWinnersByPot[potIndex].has(playerId),
              disabled: permissions.isInteractionLocked() || sidePot.contenders.length === 1
            };
          })
          .filter(Boolean)
      };
    });

    renderShowdownSelection(body, {
      pots,
      onToggleWinner: (potIndex, playerId) => {
        actions.toggleWinner(potIndex, playerId);
        renderShowdownDialogBody(body, closeDialog);
      },
      onConfirm: () => {
        if (!actions.buildSettlementPlan()) return;
        closeDialog();
        actions.confirmShowdown();
      },
      confirmDisabled: permissions.isInteractionLocked() || getState().handStatus !== "showdown"
    });
  }

  function openSettlementPreviewDialog() {
    const { settlementPreview, handStatus, clientId } = getState();
    if (handStatus !== "settlementPreview" || !settlementPreview) return;
    const requiredApprovers = approvals.getSettlementApproverIds();
    const progress = getApprovalProgress(settlementPreview.approvals, requiredApprovers);
    const canApprove = !modes.isRoomMode() || requiredApprovers.includes(clientId);
    const alreadyApproved = Boolean(progress.approved[clientId]);

    openTableActionDialog({
      title: "确认结算",
      description: modes.isRoomMode()
        ? approvals.getApprovalStatusText(settlementPreview.approvals, requiredApprovers)
        : "请检查本手筹码分配。",
      className: "settlement-action-dialog",
      buildContent(body, closeDialog) {
        const confirmLabel = modes.isRoomMode() && alreadyApproved && !progress.complete ? "已确认" : "确认结算";
        const showWaiting = modes.isRoomMode() && requiredApprovers.length > 0 && !progress.complete && (alreadyApproved || !canApprove);
        renderSettlementPreviewContent(body, {
          preview: settlementPreview,
          getPlayerLabel: playerId => labels.getPlayerIdentityLabel(actions.getPlayerById(playerId)),
          showWaiting,
          waitingText: showWaiting
            ? approvals.getApprovalWaitingText(settlementPreview.approvals, requiredApprovers, "确认结算")
            : "",
          cancelDisabled: permissions.isSharedPromptActionLocked(),
          confirmDisabled: permissions.isSharedPromptActionLocked() || !canApprove || (alreadyApproved && !progress.complete),
          confirmLabel,
          onCancel: () => {
            closeDialog();
            actions.cancelSettlementPreview();
          },
          onConfirm: () => {
            closeDialog();
            actions.confirmSettlementPreview();
          }
        });
      }
    });
  }

  function createTableCenterOperations() {
    const state = getState();
    const operations = document.createElement("div");
    operations.className = "table-center-action-slot";

    if (shouldShowCurrentActionPanel()) {
      const index = state.currentPlayerIndex;
      const player = state.players[index];
      const actionDisabled = permissions.isInteractionLocked();
      operations.appendChild(createCenterOperationHeader(`${labels.getPlayerIdentityLabel(player)} 行动`, [
        `筹码 ${player.chips}`,
        `需跟 ${betting.getCallAmount(player)}`,
        `本轮下注 ${player.bet}`
      ]));
      if (!permissions.canCurrentClientControlPlayer(player)) {
        operations.appendChild(createWaitingNotice(`等待 ${labels.getPlayerIdentityLabel(player)} 操作`));
        return operations;
      }
      operations.appendChild(createActionControls(player, index, actionDisabled, "table-center-action-buttons"));
      return operations;
    }

    if (state.handStatus === "waitingDeal" && state.pendingDealPrompt) {
      const canConfirmDeal = permissions.canCurrentClientConfirmDeal();
      operations.appendChild(createCenterOperationHeader(state.pendingDealPrompt.title, [
        state.pendingDealPrompt.cardText,
        state.pendingDealPrompt.detail,
        canConfirmDeal ? "你可确认发牌" : "等待 Dealer 确认"
      ].filter(Boolean)));
      if (!canConfirmDeal) {
        operations.appendChild(createWaitingNotice("等待 Dealer 确认发牌"));
        return operations;
      }
      const confirmLabel = state.pendingDealPrompt.nextRound === 0 ? "手牌已发，开始行动" : "已发牌，继续";
      operations.appendChild(createButton(confirmLabel, actions.confirmDealPrompt, permissions.isSharedPromptActionLocked(), "prompt-primary"));
      return operations;
    }

    if (state.handStatus === "showdown") {
      operations.appendChild(createCenterOperationHeader("摊牌结算", [
        `${state.pendingPots.length || 1} 个奖池`
      ]));
      operations.appendChild(createButton("选择赢家", openShowdownDialog, permissions.isInteractionLocked(), "prompt-primary"));
      return operations;
    }

    if (state.handStatus === "settlementPreview") {
      const requiredApprovers = approvals.getSettlementApproverIds();
      const settlementProgress = getApprovalProgress(state.settlementPreview?.approvals, requiredApprovers);
      const canApproveSettlement = modes.isLocalMode() || requiredApprovers.includes(state.clientId);
      const alreadyApprovedSettlement = Boolean(settlementProgress.approved[state.clientId]);
      operations.appendChild(createCenterOperationHeader("等待结算确认", [
        `总额 ${state.settlementPreview?.total || state.pot}`,
        approvals.getApprovalStatusText(state.settlementPreview?.approvals, requiredApprovers)
      ]));
      if (modes.isRoomMode() && requiredApprovers.length > 0 && !settlementProgress.complete && (alreadyApprovedSettlement || !canApproveSettlement)) {
        operations.appendChild(createWaitingNotice(approvals.getApprovalWaitingText(
          state.settlementPreview?.approvals,
          requiredApprovers,
          "确认结算"
        )));
      }
      const settlementButtonLabel = modes.isRoomMode() && requiredApprovers.length > 0 && !settlementProgress.complete && (alreadyApprovedSettlement || !canApproveSettlement)
        ? "查看结算"
        : "查看并确认";
      operations.appendChild(createButton(settlementButtonLabel, openSettlementPreviewDialog, permissions.isSharedPromptActionLocked(), "prompt-primary"));
      return operations;
    }

    if (state.handStatus === "settled") {
      const eligibleCount = betting.getEligiblePlayerIndices().length;
      const buttonHandId = state.handId;
      const nextHandApprovers = approvals.getNextHandApproverIds();
      const nextHandProgress = getApprovalProgress(state.nextHandApprovals, nextHandApprovers);
      const canApproveNextHand = modes.isLocalMode() || nextHandApprovers.includes(state.clientId);
      const alreadyApprovedNextHand = Boolean(nextHandProgress.approved[state.clientId]);
      operations.appendChild(createCenterOperationHeader("本手已结算", [
        `下一局可参与 ${eligibleCount} 人`,
        modes.isRoomMode() ? approvals.getApprovalStatusText(state.nextHandApprovals, nextHandApprovers) : "本地可直接开始"
      ]));
      if (modes.isRoomMode() && nextHandApprovers.length > 0 && !nextHandProgress.complete && (alreadyApprovedNextHand || !canApproveNextHand)) {
        operations.appendChild(createWaitingNotice(approvals.getApprovalWaitingText(
          state.nextHandApprovals,
          nextHandApprovers,
          "确认下一局"
        )));
      }
      const group = document.createElement("div");
      group.className = "table-center-action-buttons table-center-next-buttons";
      group.appendChild(createButton("席位管理", actions.openTableManager, permissions.isInteractionLocked() || (modes.isLocalMode() && !permissions.canCurrentClientManageRoom()), "table-manager-button"));
      const nextHandLabel = modes.isRoomMode() && alreadyApprovedNextHand && !nextHandProgress.complete ? "已确认" : "确认下一局";
      group.appendChild(createButton(modes.isLocalMode() ? "开始下一局" : nextHandLabel, () => {
        actions.approveNextHandStart(buttonHandId);
      }, permissions.isInteractionLocked() || eligibleCount < 2 || !canApproveNextHand || (alreadyApprovedNextHand && !nextHandProgress.complete), "next-hand-button"));
      operations.appendChild(group);
      return operations;
    }

    operations.textContent = "操作区";
    return operations;
  }

  function createTableCenterPanel() {
    const { pot, currentBet } = getState();
    return createTableCenterPanelView({
      pot,
      metaItems: [getRoundDisplayText(), `最高下注 ${currentBet}`],
      operations: createTableCenterOperations()
    });
  }

  function getCompactPlayerStatus(player) {
    const { players, currentPlayerIndex } = getState();
    if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
    if (player.folded) return "弃牌";
    if (player.allIn) return "All In";
    if (players.indexOf(player) === currentPlayerIndex) return "行动中";
    if (player.acted) return "已行动";
    return "等待";
  }

  function getPlayerStatus(player) {
    const { players, currentPlayerIndex } = getState();
    if (player.seatStatus !== "seated") return getSeatStatusLabel(player.seatStatus);
    if (player.folded) return "Folded";
    if (player.allIn) return "All In";
    if (players.indexOf(player) === currentPlayerIndex) return "行动中";
    if (player.acted) return `已行动，Bet ${player.bet}`;
    return "等待";
  }

  function updatePlayerBoxes() {
    const state = getState();
    const boxes = document.getElementById("player-boxes");
    boxes.replaceChildren();
    boxes.className = "player-boxes";
    boxes.classList.add(`player-count-${Math.min(state.players.length, maxPlayers)}`);
    boxes.style.setProperty("--player-count", state.players.length);
    boxes.appendChild(createTableCenterPanel());

    state.players.forEach((player, index) => {
      const seat = getVisualSeatCoordinates({
        playerIndex: index,
        count: state.players.length,
        currentDevicePlayerIndex: permissions.getCurrentDevicePlayerIndex(),
        rotationOffset: state.tableViewRotationOffset,
        roomMode: modes.isRoomMode(),
        maxSeats: maxPlayers
      });

      boxes.appendChild(createPlayerSeatBox({
        index,
        seat,
        side: seat.side,
        isMine: permissions.isCurrentDevicePlayer(player),
        folded: player.folded,
        allIn: player.allIn,
        inactive: player.seatStatus !== "seated",
        active: index === state.currentPlayerIndex,
        ariaLabel: `${labels.getPlayerIdentityLabel(player, index)}，筹码 ${player.chips}，本轮下注 ${player.bet}，${getPlayerStatus(player)}`,
        identityLabel: labels.getPlayerIdentityLabel(player, index),
        compactIdentityLabel: labels.getPlayerCompactIdentityLabel(player, index),
        chips: player.chips,
        bet: player.bet,
        statusLabel: getPlayerStatus(player),
        compactStatusLabel: getCompactPlayerStatus(player),
        position: player.position,
        detailRows: [
          ["座位", String(index + 1)],
          ["位置", player.position || "-"],
          ["剩余筹码", String(player.chips)],
          ["本轮下注", String(player.bet)],
          ["本局投入", String(player.totalBet || 0)],
          ["状态", getPlayerStatus(player)]
        ],
        claim: modes.isRoomMode()
          ? {
            label: labels.getSetupClaimLabel(player),
            disabled: !permissions.canCurrentClientModifyClaims(),
            claimed: permissions.isCurrentDevicePlayer(player),
            onClick: () => actions.togglePlayerClaim(player.id)
          }
          : null
      }));
    });

    renderCurrentActionPanel();
  }

  function closeSeatPopoversOnOutsideClick(event) {
    if (!event.target.closest?.(".player-box")) {
      closeSeatDetailPopovers();
    }
  }

  return {
    getRoundDisplayText,
    updateGameInfo,
    updatePlayerBoxes,
    renderNextHandButton,
    clearHandActions,
    showNextHandButton,
    hideShowdownPanel,
    hideDealPromptPanel,
    renderDealPromptPanel,
    hideSettlementPreviewPanel,
    renderSettlementPreviewPanel,
    renderShowdownPanel,
    renderCurrentActionPanel,
    closeSeatPopoversOnOutsideClick
  };
}
