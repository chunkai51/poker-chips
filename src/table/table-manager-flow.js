import { getSeatStatusLabel } from "../core/game-rules.js";
import {
  getPlayerRawName,
  shouldUseRequestNameForPlayerSeat
} from "../core/player-model.js";
import { getRequestDisplayName, normalizeJoinRequests } from "../room/room-entry.js";
import { normalizeIncomingPlayers } from "../room/room-state.js";
import { normalizePlayerOwnerId } from "../room/identity.js";
import { showAppAlert, showAppConfirm } from "../ui/dialogs.js";
import { renderTableManagerView } from "../ui/table-manager-ui.js";
import {
  adjustDraftChips,
  appendDraftPlayer,
  createTableDraft,
  deleteDraftPlayer,
  getPreviewDealerIndex,
  getTableDraftSummary,
  moveDraftPlayer,
  normalizeDraftPlayer,
  normalizeTableDraftPlayers,
  returnDraftPlayerToTable,
  setDraftChips,
  setDraftStatus
} from "./table-manager-controller.js";

export function createTableManagerFlow({
  elements,
  maxPlayers,
  getState,
  getInitialChips,
  canEditTableNow,
  isSharedPromptActionLocked,
  isLocalMode,
  isRoomMode,
  getEligiblePlayerIndices,
  labels,
  identity,
  actions,
  formatters
}) {
  const { backdrop, panel } = elements;
  let tableDraft = null;
  let tableManagerOpen = false;
  let tableDraftBaseHandId = null;
  let tableDraftBaseStateVersion = null;

  if (backdrop) {
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close();
    });
  }

  function createDraft() {
    return createTableDraft(getState().players);
  }

  function getDraftSummary() {
    return getTableDraftSummary(tableDraft, {
      getPlayerIdentityLabel: labels.getPlayerIdentityLabel
    });
  }

  function getPreviewDealerIndexForDraft(list = tableDraft) {
    return getPreviewDealerIndex(list);
  }

  function syncIdentityFromPlayers(sourcePlayers = getState().players) {
    if (!tableDraft) return;
    const sourceById = new Map(normalizeIncomingPlayers(sourcePlayers)
      .map(player => [player.id, player]));
    tableDraft.forEach((draftPlayer, index) => {
      const source = sourceById.get(String(draftPlayer.id || ""));
      if (!source) return;
      const sourceName = getPlayerRawName(source);
      if (sourceName && shouldUseRequestNameForPlayerSeat(draftPlayer, index)) {
        draftPlayer.name = sourceName;
      }
      draftPlayer.ownerClientId = normalizePlayerOwnerId(source.ownerClientId);
      draftPlayer.playerKeyHash = String(source.playerKeyHash || "");
    });
  }

  function open() {
    const { handStatus } = getState();
    if (isLocalMode() && handStatus !== "settled") {
      showAppAlert("本地模式的牌桌管理只在本手结算完成后开放。");
      return;
    }
    if (isRoomMode() && !getState().room.roomId) {
      showAppAlert("请先创建或加入房间。");
      return;
    }

    tableDraft = createDraft();
    tableDraftBaseHandId = getState().handId;
    tableDraftBaseStateVersion = getState().stateVersion;
    tableManagerOpen = true;
    render();
  }

  function close() {
    tableManagerOpen = false;
    tableDraft = null;
    tableDraftBaseHandId = null;
    tableDraftBaseStateVersion = null;
    if (backdrop) backdrop.hidden = true;
    if (panel) panel.replaceChildren();
  }

  function renderIfOpen() {
    if (tableManagerOpen) render();
  }

  function createIdentityModel() {
    if (!isRoomMode()) return null;

    const { players, room } = getState();
    const currentPlayer = identity.getCurrentDevicePlayer();
    const currentIndex = currentPlayer ? players.indexOf(currentPlayer) : -1;
    const isAdmin = identity.canCurrentClientManageRoom();
    const savedDisplayName = identity.getCurrentDisplayName();
    const displayName = savedDisplayName || identity.getGuestDisplayName();
    const pendingRequestCount = identity.getPendingJoinRequestCount();

    return {
      titleText: currentPlayer
        ? `当前身份：${labels.getPlayerIdentityLabel(currentPlayer, currentIndex)}${isAdmin ? ` · ${identity.getCurrentRoomRoleLabel()}` : ""}`
        : isAdmin
          ? `当前身份：${identity.getCurrentRoomRoleLabel()}旁观`
          : "当前身份：旁观",
      detailText: `房间 ${room.roomId || "-"} · 昵称 ${displayName}${savedDisplayName ? "" : "（未设置）"} · 设备 ${identity.getClientShortId()}`,
      displayName: savedDisplayName,
      displayNamePlaceholder: identity.getGuestDisplayName(),
      displayNameDisabled: isSharedPromptActionLocked(),
      hasCurrentPlayer: Boolean(currentPlayer),
      isAdmin,
      isActionLocked: isSharedPromptActionLocked(),
      roomId: room.roomId,
      pendingRequestCount
    };
  }

  function createRequestModels() {
    const { players, room } = getState();
    return Object.values(normalizeJoinRequests(room.joinRequests))
      .sort((left, right) => left.requestedAt - right.requestedAt)
      .map(request => {
        const targetIndex = players.findIndex(player => player.id === request.playerId);
        const targetPlayer = targetIndex >= 0 ? players[targetIndex] : null;
        return {
          clientId: request.clientId,
          text: `${getRequestDisplayName(request) || "未填写昵称"} 请求${request.type === "reclaim" ? "接管" : "坐下"} ${targetPlayer ? labels.getPlayerIdentityLabel(targetPlayer, targetIndex) : "未知座位"}`
        };
      });
  }

  function render() {
    if (!backdrop || !panel || !tableManagerOpen || !tableDraft) return;

    const { room, handStatus } = getState();
    backdrop.hidden = false;
    const canEdit = canEditTableNow();
    const isActionLocked = isSharedPromptActionLocked();
    const isAdmin = identity.canCurrentClientManageRoom();
    let addButtonLabel = "添加玩家";
    if (tableDraft.length >= maxPlayers) {
      addButtonLabel = `最多 ${maxPlayers} 人`;
    } else if (!canEdit) {
      addButtonLabel = "当前阶段不可加人";
    }

    renderTableManagerView({
      panel,
      context: {
        isRoomMode: isRoomMode(),
        description: isRoomMode()
          ? "玩家在这里查看身份与请求；房主/协管可批准入座，并在开局前或两手牌之间调整牌桌。"
          : "调整座次、筹码和离桌/回桌状态；保存后只影响下一手。",
        summaryText: canEdit
          ? getDraftSummary()
          : "身份绑定可随时调整；筹码、座次、删除玩家只在开局前或两手牌之间开放。",
        canEdit,
        canManageRoom: isAdmin,
        isActionLocked,
        tableDraft,
        maxPlayers,
        adminPlayerIds: room.adminPlayerIds,
        normalizeDraftPlayer,
        addButtonLabel,
        addDisabled: isActionLocked || !canEdit || tableDraft.length >= maxPlayers,
        saveDisabled: isActionLocked || !canEdit,
        saveAndStartDisabled: isActionLocked ||
          !canEdit ||
          handStatus !== "settled" ||
          getEligiblePlayerIndices(tableDraft.map(normalizeDraftPlayer)).length < 2
      },
      identity: createIdentityModel(),
      requests: createRequestModels(),
      callbacks: {
        onClose: close,
        onAddPlayer: addDraftPlayer,
        onSave: saveDraft,
        onReleaseCurrentPlayer: actions.releaseCurrentPlayerIdentity,
        onCopyInvite: actions.copyInviteLink,
        onSaveDisplayName: async value => {
          const savedName = await actions.saveCurrentDisplayName(value);
          if (savedName) actions.setSyncStatus("昵称已保存", "ok");
        },
        onShowPendingRequests: count => {
          showAppAlert(`当前有 ${count} 个待处理请求。请在下方列表批准或拒绝。`);
        },
        onApproveSeatRequest: actions.approveSeatRequest,
        onDeclineSeatRequest: actions.declineSeatRequest,
        onMoveDraftPlayer: moveDraftPlayerByDirection,
        onDraftNameInput: (index, value) => {
          tableDraft[index].name = value;
        },
        onSetDraftChips: setDraftChipsByValue,
        onAdjustDraftChips: adjustDraftChipsByDelta,
        onSetDraftStatus: setDraftSeatStatus,
        onReturnSeat: returnDraftSeat,
        onDeleteDraftPlayer: deleteDraftSeat,
        onTogglePlayerClaim: async playerId => {
          await actions.togglePlayerClaim(playerId);
          render();
        },
        onTogglePlayerAdmin: async (playerId, shouldGrant) => {
          await actions.togglePlayerAdmin(playerId, shouldGrant);
          renderIfOpen();
        }
      },
      formatters: {
        ...formatters,
        getPreviewDealerIndex: getPreviewDealerIndexForDraft
      }
    });
  }

  function addDraftPlayer() {
    if (tableDraft.length >= maxPlayers) {
      showAppAlert(`最多支持 ${maxPlayers} 名玩家`);
      render();
      return;
    }

    appendDraftPlayer(tableDraft, {
      createPlayerId: actions.createPlayerId,
      initialChips: getInitialChips(),
      maxPlayers
    });
    render();
  }

  function returnDraftSeat(index) {
    returnDraftPlayerToTable(tableDraft, index, {
      fallbackChips: getInitialChips()
    });
    render();
  }

  function moveDraftPlayerByDirection(index, direction) {
    moveDraftPlayer(tableDraft, index, direction);
    render();
  }

  async function deleteDraftSeat(index) {
    if (!canEditTableNow() || tableDraft.length <= 2) return;
    const target = tableDraft[index];
    const confirmed = await showAppConfirm(`删除 ${labels.getPlayerIdentityLabel(target, index, tableDraft)}？这只会在保存后生效。`, {
      title: "确认删除玩家",
      confirmLabel: "删除",
      danger: true
    });
    if (!confirmed) return;
    deleteDraftPlayer(tableDraft, index);
    actions.removeAdminPlayerId(target?.id || "");
    render();
  }

  function adjustDraftChipsByDelta(index, delta) {
    adjustDraftChips(tableDraft, index, delta);
    render();
  }

  function setDraftChipsByValue(index, value) {
    setDraftChips(tableDraft, index, value);
    render();
  }

  function setDraftSeatStatus(index, status) {
    setDraftStatus(tableDraft, index, status, {
      fallbackChips: getInitialChips()
    });
    render();
  }

  async function saveDraft({ startNextHand = false } = {}) {
    if (!canEditTableNow()) {
      showAppAlert("只有房主或协管可以保存牌桌管理设置。");
      return;
    }
    if (!tableDraft) {
      showAppAlert("当前不能保存牌桌管理设置");
      return;
    }

    const nextPlayers = normalizeTableDraftPlayers(tableDraft);
    if (nextPlayers.length > maxPlayers) {
      showAppAlert(`最多支持 ${maxPlayers} 名玩家`);
      render();
      return;
    }

    if (startNextHand && getEligiblePlayerIndices(nextPlayers).length < 2) {
      showAppAlert("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
      render();
      return;
    }

    const result = await actions.commitTableDraft({
      nextPlayers,
      startNextHand,
      baseHandId: tableDraftBaseHandId,
      baseStateVersion: tableDraftBaseStateVersion,
      summaryText: getDraftSummary()
    });

    if (!result?.ok) {
      renderIfOpen();
      return;
    }

    const nextHandId = result.startNextHandExpectedHandId;
    close();
    if (nextHandId !== undefined && nextHandId !== null) {
      await actions.approveNextHandStart(nextHandId);
    }
  }

  return {
    open,
    close,
    render,
    renderIfOpen,
    syncIdentityFromPlayers,
    isOpen: () => tableManagerOpen,
    canEdit: canEditTableNow,
    getDraftSummary
  };
}
