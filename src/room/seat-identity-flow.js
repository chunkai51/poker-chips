import { showAppAlert, showAppConfirm, openTableActionDialog } from "../ui/dialogs.js";
import { createButton } from "../ui/ui-dom.js";
import {
  applyLocalPlayerClaimState,
  buildApproveSeatRequestRoomUpdate,
  buildClaimPlayerRoomUpdate,
  buildDeclineSeatRequestRoomUpdate,
  buildReleasePlayerRoomUpdate,
  createSeatOwnershipRequest,
  getClaimAuthForPlayer as getClaimAuthForPlayerData,
  getSetupClaimLabel as getSetupClaimLabelData,
  isClaimedByOtherDevice as isClaimedByOtherDeviceData
} from "./room-claims-controller.js";
import {
  getClientShortId as formatClientShortId,
  getPreferredDisplayName as readPreferredDisplayName,
  normalizeJoinRequests,
  rememberPreferredDisplayName as storePreferredDisplayName
} from "./room-entry.js";
import {
  createAccessCode,
  hashAccessCode,
  normalizeMembers,
  normalizePlayerOwnerId,
  touchMember
} from "./identity.js";
import {
  transactRoom,
  updateJoinRequest
} from "./room-sync.js";

export function createSeatIdentityFlow({
  getState,
  modes,
  permissions,
  labels,
  access,
  remote,
  applyLocalClaimResult,
  setLocalJoinRequest,
  refreshUi
}) {
  function getPlayerById(playerId) {
    return getState().players.find(player => player.id === playerId) || null;
  }

  function getPreferredDisplayName(roomId = getState().room.roomId) {
    return readPreferredDisplayName(roomId);
  }

  function rememberPreferredDisplayName(name, roomId = getState().room.roomId) {
    storePreferredDisplayName(name, roomId);
  }

  function normalizeDisplayName(name = "") {
    return String(name || "").trim().slice(0, 24);
  }

  function getClientShortId(value = getState().clientId) {
    return formatClientShortId(value);
  }

  function getCurrentMemberDisplayName(actorClientId = getState().clientId) {
    return normalizeDisplayName(normalizeMembers(getState().room.members)[actorClientId]?.displayName);
  }

  function getCurrentDisplayName() {
    return normalizeDisplayName(refreshUi.getAliasInputValue() || getPreferredDisplayName() || getCurrentMemberDisplayName());
  }

  function getGuestDisplayName(actorClientId = getState().clientId) {
    return `访客 ${getClientShortId(actorClientId)}`;
  }

  async function saveCurrentDisplayName(rawName, { announce = true } = {}) {
    const safeName = normalizeDisplayName(rawName);
    if (!safeName) {
      if (announce) showAppAlert("请输入昵称。");
      return "";
    }

    rememberPreferredDisplayName(safeName);
    refreshUi.setAliasInputValue(safeName);
    const { room } = getState();
    if (modes.isRoomMode() && room.roomId) {
      const saved = await remote.updateRoomMemberPresence({ displayName: safeName });
      if (!saved && announce) {
        showAppAlert("昵称已保存在本机，但暂时没有同步到房间。请检查网络后重试。");
      }
    }
    refreshUi.renderIdentityControls();
    refreshUi.renderTableManagerIfOpen();
    return safeName;
  }

  function getJoinRequestForClient(actorClientId = getState().clientId) {
    return normalizeJoinRequests(getState().room.joinRequests)[normalizePlayerOwnerId(actorClientId)] || null;
  }

  function getJoinRequestsForPlayer(playerId) {
    return Object.values(normalizeJoinRequests(getState().room.joinRequests))
      .filter(request => request.playerId === playerId);
  }

  function getPendingJoinRequestCount() {
    return Object.keys(normalizeJoinRequests(getState().room.joinRequests)).length;
  }

  function touchMemberWithProfile(existingMembers = getState().room.members, actorClientId = getState().clientId, overrides = {}) {
    const members = touchMember(existingMembers, actorClientId);
    const currentMember = members[actorClientId] || {};
    const displayName = String(overrides.displayName || currentMember.displayName || getPreferredDisplayName()).trim().slice(0, 24);
    members[actorClientId] = {
      ...currentMember,
      ...overrides,
      clientId: actorClientId,
      displayName,
      lastSeenAt: Date.now()
    };
    return members;
  }

  function isClaimedByOtherDevice(player) {
    return isClaimedByOtherDeviceData(player, getState().clientId);
  }

  function getSetupClaimLabel(player) {
    return getSetupClaimLabelData({
      player,
      roomMode: modes.isRoomMode(),
      currentRequest: getJoinRequestForClient(),
      isCurrentDevicePlayer: permissions.isCurrentDevicePlayer(player),
      claimedByOtherDevice: isClaimedByOtherDevice(player),
      canManageRoom: permissions.canCurrentClientManageRoom()
    });
  }

  function applyLocalPlayerClaim(playerId, shouldClaim) {
    const { players, room, clientId, handStatus } = getState();
    const result = applyLocalPlayerClaimState({
      players,
      members: room.members,
      clientId,
      playerId,
      shouldClaim,
      handStatus
    });
    if (!result.ok) return false;
    applyLocalClaimResult(result);
    return true;
  }

  function getClaimAuthForPlayer(player, code = "", forceAdmin = false) {
    return getClaimAuthForPlayerData({
      player,
      code,
      rememberedCode: access.getRememberedPlayerCode(player?.id),
      forceAdmin,
      canManageRoom: permissions.canCurrentClientManageRoom(),
      isPlayerCodeValid: access.isPlayerCodeValid
    });
  }

  async function claimPlayerIdentity(playerId, { code = "", forceAdmin = false, announceCode = true } = {}) {
    if (!modes.isRoomMode()) return;
    const player = getPlayerById(playerId);
    if (!player) return;

    const { room, clientId } = getState();
    if (!room.roomId) {
      applyLocalPlayerClaim(playerId, true);
      refreshUi.renderSetupPlayerInputs();
      refreshUi.updatePlayerBoxes();
      refreshUi.renderTableViewToolbar();
      return;
    }

    const auth = getClaimAuthForPlayer(player, code, forceAdmin);
    if (!auth.allowed) {
      showAppAlert("请输入该玩家的玩家码，或由管理员重置/接管。");
      return;
    }
    const generatedCode = auth.firstClaim && !auth.canForce ? createAccessCode() : "";
    const generatedHash = generatedCode
      ? hashAccessCode(generatedCode, access.getPlayerCodeSalt(playerId))
      : "";

    remote.setMutationInProgress(true);
    try {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        return buildClaimPlayerRoomUpdate({
          currentRoom,
          room,
          playerId,
          clientId,
          auth,
          forceAdmin,
          generatedHash,
          currentDisplayName: getPreferredDisplayName(),
          canClientManageRoom: permissions.canClientManageRoomData,
          isPlayerCodeValid: access.isPlayerCodeValid,
          inferHandStatus: remote.inferHandStatus,
          getRoomHostId: remote.getRoomHostId,
          normalizeRoomMode: remote.normalizeRoomMode,
          touchMember
        });
      }, { applyLocally: false });

      if (!result.committed) {
        showAppAlert("绑定没有成功，请检查玩家码或等待同步后重试。");
        const refreshed = await remote.refreshFromRemote();
        if (!refreshed) remote.setSyncReady(false);
        return;
      }

      if (generatedCode) {
        access.rememberPlayerCode(playerId, generatedCode);
        if (announceCode) {
          showAppAlert(`${labels.getPlayerIdentityLabel(player)} 已绑定到当前设备。\n玩家码：${generatedCode}\n请保存，换设备时可用它重新接管。`, "玩家码已生成");
        }
      } else if (auth.code) {
        access.rememberPlayerCode(playerId, auth.code);
      }
      applyLocalPlayerClaim(playerId, true);
      remote.setSyncStatus("已同步", "ok");
    } catch (_) {
      showAppAlert("绑定同步失败，请稍后再试。");
    } finally {
      remote.setMutationInProgress(false);
      refreshUi.renderSetupPlayerInputs();
      refreshUi.updatePlayerBoxes();
      refreshUi.renderTableViewToolbar();
    }
  }

  async function releaseCurrentPlayerIdentity() {
    const { room, clientId } = getState();
    if (!modes.isRoomMode() || !room.roomId) return;
    const currentPlayer = permissions.getCurrentDevicePlayer();
    if (!currentPlayer) return;
    remote.setMutationInProgress(true);
    try {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        return buildReleasePlayerRoomUpdate({
          currentRoom,
          room,
          clientId,
          touchMember
        });
      }, { applyLocally: false });
      if (!result.committed) {
        showAppAlert("退出绑定没有成功，请等待同步后重试。");
        await remote.refreshFromRemote();
        return;
      }
      applyLocalPlayerClaim(currentPlayer.id, false);
      remote.setSyncStatus("已同步", "ok");
    } catch (_) {
      showAppAlert("退出绑定同步失败，请稍后再试。");
    } finally {
      remote.setMutationInProgress(false);
      refreshUi.renderSetupPlayerInputs();
      refreshUi.updatePlayerBoxes();
      refreshUi.renderTableViewToolbar();
    }
  }

  async function togglePlayerClaim(playerId) {
    const player = getPlayerById(playerId);
    if (!player) return;
    if (permissions.isCurrentDevicePlayer(player)) {
      await releaseCurrentPlayerIdentity();
      return;
    }
    if (isClaimedByOtherDevice(player)) {
      const canManage = permissions.canCurrentClientManageRoom();
      const confirmed = await showAppConfirm(`${labels.getPlayerIdentityLabel(player)} 已绑定到另一台设备。${canManage ? "确认要把这个座位接管到当前设备吗？" : "要向房主/协管提交接管请求吗？"}`, {
        title: "确认接管座位",
        confirmLabel: canManage ? "确认接管" : "提交请求",
        danger: canManage
      });
      if (!confirmed) return;
    }
    if (permissions.canCurrentClientManageRoom()) {
      await claimPlayerIdentity(playerId, { forceAdmin: true, announceCode: false });
      return;
    }
    await requestSeatOwnership(playerId);
  }

  function openDisplayNameRequestDialog({ playerId, title = "设置昵称后请求入座" } = {}) {
    const player = getPlayerById(playerId);
    if (!player) return;

    openTableActionDialog({
      title,
      description: `你将以这个昵称请求绑定 ${labels.getPlayerIdentityLabel(player)}。昵称只用于显示，不影响设备身份。`,
      className: "identity-name-dialog",
      buildContent(body, closeDialog) {
        const form = document.createElement("form");
        form.className = "identity-name-dialog-form";

        const label = document.createElement("label");
        label.textContent = "你的昵称";
        const input = document.createElement("input");
        input.type = "text";
        input.maxLength = 24;
        input.placeholder = getGuestDisplayName();
        input.value = getCurrentDisplayName();
        input.setAttribute("aria-label", "你的昵称");
        label.appendChild(input);
        form.appendChild(label);

        const error = document.createElement("span");
        error.className = "identity-name-dialog-error";
        form.appendChild(error);

        const dialogActions = document.createElement("div");
        dialogActions.className = "table-center-action-buttons";
        dialogActions.appendChild(createButton("取消", closeDialog, false, "prompt-secondary"));
        dialogActions.appendChild(createButton("保存并请求", async () => {
          const displayName = normalizeDisplayName(input.value);
          if (!displayName) {
            error.textContent = "请输入昵称后再请求入座。";
            input.focus();
            return;
          }
          closeDialog();
          const savedName = await saveCurrentDisplayName(displayName, { announce: false });
          if (savedName) {
            await submitSeatOwnershipRequest(playerId, savedName);
          }
        }, false, "prompt-primary"));
        form.appendChild(dialogActions);

        form.addEventListener("submit", event => {
          event.preventDefault();
          dialogActions.querySelector(".prompt-primary")?.click();
        });

        body.appendChild(form);
        requestAnimationFrame(() => input.focus());
      }
    });
  }

  async function requestSeatOwnership(playerId) {
    const { room } = getState();
    if (!modes.isRoomMode() || !room.roomId) return;
    const player = getPlayerById(playerId);
    if (!player) return;
    const displayName = getCurrentDisplayName();
    if (!displayName) {
      openDisplayNameRequestDialog({ playerId });
      return;
    }
    await submitSeatOwnershipRequest(playerId, displayName);
  }

  async function submitSeatOwnershipRequest(playerId, displayName) {
    const { room, clientId } = getState();
    if (!modes.isRoomMode() || !room.roomId) return;
    const player = getPlayerById(playerId);
    if (!player) return;
    const safeDisplayName = normalizeDisplayName(displayName);
    if (!safeDisplayName) {
      openDisplayNameRequestDialog({ playerId });
      return;
    }
    rememberPreferredDisplayName(safeDisplayName);
    const request = createSeatOwnershipRequest({
      clientId,
      playerId,
      displayName: safeDisplayName,
      claimedByOtherDevice: isClaimedByOtherDevice(player),
      inviteToken: room.inviteToken || ""
    });
    remote.setMutationInProgress(true);
    try {
      await updateJoinRequest(room.roomId, clientId, request);
      setLocalJoinRequest(clientId, request);
      await remote.updateRoomMemberPresence({ displayName: safeDisplayName });
      showAppAlert("请求已发送。房主或协管批准后，这个座位会绑定到当前设备。", "等待批准");
      remote.setSyncStatus("等待批准", "ok");
    } catch (_) {
      showAppAlert("请求发送失败，请检查房间连接后重试。");
    } finally {
      remote.setMutationInProgress(false);
      refreshUi.renderSetupPlayerInputs();
      refreshUi.updatePlayerBoxes();
      refreshUi.renderTableManagerIfOpen();
    }
  }

  async function approveSeatRequest(requestClientId) {
    const { room, players, clientId } = getState();
    if (!permissions.canCurrentClientManageRoom() || !room.roomId) return;
    const request = normalizeJoinRequests(room.joinRequests)[requestClientId];
    if (!request) return;
    const target = players.find(player => player.id === request.playerId);
    if (!target) return;

    remote.setMutationInProgress(true);
    try {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        return buildApproveSeatRequestRoomUpdate({
          currentRoom,
          room,
          clientId,
          requestClientId,
          expectedPlayerId: request.playerId,
          canClientManageRoom: permissions.canClientManageRoomData,
          inferHandStatus: remote.inferHandStatus,
          touchMember
        });
      }, { applyLocally: false });
      if (!result.committed) {
        showAppAlert("批准请求失败，房间状态可能已变化。");
        await remote.refreshFromRemote();
        return;
      }
      await remote.refreshFromRemote();
    } catch (_) {
      showAppAlert("批准请求失败，请稍后再试。");
    } finally {
      remote.setMutationInProgress(false);
      refreshUi.renderTableManagerIfOpen();
    }
  }

  async function declineSeatRequest(requestClientId) {
    const { room, clientId } = getState();
    if (!permissions.canCurrentClientManageRoom() || !room.roomId) return;
    const normalizedRequestClientId = normalizePlayerOwnerId(requestClientId);
    if (!normalizedRequestClientId) return;
    remote.setMutationInProgress(true);
    try {
      const result = await transactRoom(room.roomId, (currentRoom) => {
        return buildDeclineSeatRequestRoomUpdate({
          currentRoom,
          room,
          clientId,
          requestClientId: normalizedRequestClientId,
          canClientManageRoom: permissions.canClientManageRoomData,
          touchMember
        });
      }, { applyLocally: false });
      if (!result.committed) {
        showAppAlert("拒绝请求失败，房间状态可能已变化。");
        await remote.refreshFromRemote();
        return;
      }
      await remote.refreshFromRemote();
      remote.setSyncStatus("已同步", "ok");
    } catch (_) {
      showAppAlert("拒绝请求失败，请稍后再试。");
    } finally {
      remote.setMutationInProgress(false);
      refreshUi.renderTableManagerIfOpen();
    }
  }

  return {
    getPreferredDisplayName,
    rememberPreferredDisplayName,
    normalizeDisplayName,
    getCurrentMemberDisplayName,
    getCurrentDisplayName,
    getGuestDisplayName,
    getClientShortId,
    saveCurrentDisplayName,
    getJoinRequestForClient,
    getJoinRequestsForPlayer,
    getPendingJoinRequestCount,
    touchMemberWithProfile,
    isClaimedByOtherDevice,
    getSetupClaimLabel,
    applyLocalPlayerClaim,
    getClaimAuthForPlayer,
    claimPlayerIdentity,
    releaseCurrentPlayerIdentity,
    togglePlayerClaim,
    openDisplayNameRequestDialog,
    requestSeatOwnership,
    submitSeatOwnershipRequest,
    approveSeatRequest,
    declineSeatRequest
  };
}
