// src/table/table-save-flow.js
// Persistence and remote conflict guards for table-management changes.

import { getSeatStatusLabel } from "../core/game-rules.js";
import { normalizeAdminPlayerIds, touchMember } from "../room/identity.js";
import { buildTogglePlayerAdminRoomUpdate } from "../room/room-claims-controller.js";

export function createTableSaveFlow({
  maxPlayers = 10,
  getState,
  mutations = {},
  permissions = {},
  rules = {},
  remote = {},
  setup = {},
  ui = {},
  helpers = {}
} = {}) {
  function getTableState() {
    return {
      players: [],
      room: {},
      clientId: "",
      handStatus: "setup",
      handId: 0,
      stateVersion: 0,
      ...(getState ? getState() : {})
    };
  }

  function canEditTableNow() {
    const { handStatus } = getTableState();
    if (!permissions.canCurrentClientManageRoom?.()) return false;
    return handStatus === "setup" || handStatus === "settled";
  }

  function filterAdminIds(room, players) {
    return normalizeAdminPlayerIds(room.adminPlayerIds)
      .filter(playerId => players.some(player => player.id === playerId));
  }

  function applyPlayers(nextPlayers) {
    mutations.setPlayers?.(nextPlayers);
    const state = getTableState();
    state.room.players = nextPlayers;
    mutations.setRoom?.(state.room);
  }

  function removeAdminPlayerId(playerId) {
    const state = getTableState();
    state.room.adminPlayerIds = normalizeAdminPlayerIds(state.room.adminPlayerIds)
      .filter(id => id !== playerId);
    mutations.setRoom?.(state.room);
  }

  async function togglePlayerAdmin(playerId, shouldGrant) {
    const state = getTableState();
    if (!permissions.canCurrentClientManageRoom?.() || !state.room.roomId) return;
    mutations.setMutationInProgress?.(true);
    try {
      const result = await remote.transactRoom?.(state.room.roomId, (currentRoom) => {
        return buildTogglePlayerAdminRoomUpdate({
          currentRoom,
          room: getTableState().room,
          clientId: getTableState().clientId,
          playerId,
          shouldGrant,
          canClientManageRoom: permissions.canClientManageRoomData,
          touchMember
        });
      }, { applyLocally: false });
      if (!result.committed) {
        ui.showAppAlert?.("协管权限更新没有成功，请等待同步后重试。");
        await remote.refreshFromRemote?.();
        return;
      }
      await remote.refreshFromRemote?.();
    } catch (_) {
      ui.showAppAlert?.("协管权限更新失败，请稍后再试。");
    } finally {
      mutations.setMutationInProgress?.(false);
      ui.renderTableManagerIfOpen?.();
    }
  }

  async function commitTableDraft({
    nextPlayers: draftPlayers,
    startNextHand = false,
    baseHandId,
    baseStateVersion,
    summaryText
  } = {}) {
    const state = getTableState();
    if (!canEditTableNow()) {
      ui.showAppAlert?.("只有房主或协管可以保存牌桌管理设置。");
      return { ok: false };
    }

    let nextPlayers = helpers.mergePlayerIdentityFields?.(draftPlayers, state.players) || draftPlayers;
    if (nextPlayers.length > maxPlayers) {
      ui.showAppAlert?.(`最多支持 ${maxPlayers} 名玩家`);
      return { ok: false };
    }

    if (startNextHand && rules.getEligiblePlayerIndices?.(nextPlayers).length < 2) {
      ui.showAppAlert?.("至少需要 2 名已入座且有筹码的玩家才能开始下一局");
      return { ok: false };
    }

    if (state.handStatus === "setup") {
      nextPlayers = nextPlayers.map((player, index) => ({
        ...player,
        folded: false,
        dealer: index === 0,
        bet: 0,
        totalBet: 0,
        allIn: false,
        acted: false,
        position: ""
      }));
      applyPlayers(nextPlayers);
      const latest = getTableState();
      latest.room.adminPlayerIds = filterAdminIds(latest.room, nextPlayers);
      mutations.setRoom?.(latest.room);
      setup.renderPlayers?.();
      setup.updateActionState?.();
      ui.updatePlayerBoxes?.();
      await setup.sync?.();
      return { ok: true };
    }

    const expectedHandId = baseHandId;
    const expectedStateVersion = baseStateVersion;
    if (expectedHandId !== state.handId || expectedStateVersion !== state.stateVersion) {
      ui.showAppAlert?.("牌桌已被其他设备更新，请关闭后重新打开牌桌管理。");
      ui.closeTableManager?.();
      return { ok: false };
    }

    mutations.setMutationInProgress?.(true);
    mutations.setBatchingStateUpdate?.(true);

    nextPlayers.forEach(player => {
      player.position = getSeatStatusLabel(player.seatStatus);
    });
    applyPlayers(nextPlayers);
    const latest = getTableState();
    latest.room.adminPlayerIds = filterAdminIds(latest.room, nextPlayers);
    mutations.setRoom?.(latest.room);
    mutations.setNextHandApprovals?.({});
    ui.updatePlayerBoxes?.();
    ui.updateGameLog?.(`牌桌已更新：${summaryText}`);

    mutations.setBatchingStateUpdate?.(false);
    const saved = await remote.updateFirebaseState?.({
      expectedHandId,
      allowedStatuses: ["settled"],
      expectedStateVersion,
      remoteGuard: (currentRoom) => permissions.canClientManageRoomData?.(getTableState().clientId, currentRoom)
    });
    mutations.setMutationInProgress?.(false);

    if (!saved) {
      ui.showAppAlert?.("牌桌管理没有保存成功，已恢复到最新远端状态");
      return { ok: false };
    }

    return {
      ok: true,
      startNextHandExpectedHandId: startNextHand ? expectedHandId : null
    };
  }

  return {
    canEditTableNow,
    removeAdminPlayerId,
    togglePlayerAdmin,
    commitTableDraft
  };
}
