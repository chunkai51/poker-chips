// src/room/room-session-flow.js
// Room entry, listener lifecycle, invite links, and remote room presence.

import {
  listenRoom,
  readRoom,
  readRoomGameState,
  roomExists,
  updateRoomMember
} from "./room-sync.js";
import {
  createHostRoom,
  createJoinedRoom,
  createLocalModeRoom
} from "./room-lobby-controller.js";
import {
  createInviteToken,
  generateRoomId,
  getInviteUrl as buildInviteUrl,
  getRoomLinkParams as parseRoomLinkParams,
  normalizeInviteToken,
  normalizeRoomId
} from "./room-entry.js";
import { ROOM_MODES, normalizeMembers } from "./identity.js";

export function createRoomSessionFlow({
  elements = {},
  getState,
  mutations = {},
  modes = {},
  identity = {},
  setup = {},
  remote = {},
  ui = {},
  helpers = {}
} = {}) {
  let unsubscribeRoom = null;
  let listenedRoomId = "";

  function getSessionState() {
    return {
      room: {},
      clientId: "",
      gameStarted: false,
      ...(getState ? getState() : {})
    };
  }

  function setRoom(nextRoom) {
    mutations.setRoom?.(nextRoom);
    return nextRoom;
  }

  function getInviteUrl(roomId = getSessionState().room.roomId, inviteToken = getSessionState().room.inviteToken) {
    return buildInviteUrl(window.location.href, roomId, inviteToken);
  }

  function getRoomLinkParams() {
    return parseRoomLinkParams(window.location.search);
  }

  function stopListener() {
    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }
    listenedRoomId = "";
  }

  function enterLocalMode() {
    const { room, clientId, gameStarted } = getSessionState();
    if (gameStarted && !modes.isLocalMode?.()) {
      ui.showAppAlert?.("牌局进行中不能切换到本地模式。");
      return;
    }
    stopListener();
    setRoom(createLocalModeRoom({
      room,
      clientId,
      createMembersMap: helpers.createMembersMap
    }));
    if (elements.roomIdInput) elements.roomIdInput.value = "";
    mutations.setSyncReady?.(true);
    ui.loadTableViewRotation?.();
    ui.setSyncStatus?.("本地模式");
    ui.renderIdentityControls?.();
    setup.renderPlayers?.();
    ui.updatePlayerBoxes?.();
  }

  function enterRoomMode() {
    const { room, gameStarted, syncReady } = getSessionState();
    if (gameStarted && !modes.isRoomMode?.()) {
      ui.showAppAlert?.("牌局进行中不能切换房间模式。");
      return;
    }
    room.mode = ROOM_MODES.room;
    setRoom(room);
    mutations.setSyncReady?.(Boolean(room.roomId && syncReady));
    ui.loadTableViewRotation?.();
    ui.setSyncStatus?.(room.roomId ? "等待同步" : "多人房间未连接");
    ui.renderIdentityControls?.();
    setup.renderPlayers?.();
    ui.updatePlayerBoxes?.();
  }

  async function remoteRoomExists(roomId = getSessionState().room.roomId) {
    const normalizedRoomId = normalizeRoomId(roomId);
    if (!normalizedRoomId) return false;

    try {
      return roomExists(normalizedRoomId);
    } catch (_) {
      ui.setSyncStatus?.("连接异常，请检查网络后刷新", "error");
      return null;
    }
  }

  async function getRemoteGameState() {
    const { room } = getSessionState();
    try {
      return readRoomGameState(room.roomId);
    } catch (_) {
      return null;
    }
  }

  async function refreshFromRemote() {
    const { room } = getSessionState();
    if (!room.roomId) return false;

    try {
      const data = await readRoom(room.roomId);
      if (!data || !data.gameState) return false;
      mutations.setSyncReady?.(true);
      remote.applyRoomData?.(data);
      return true;
    } catch (_) {
      mutations.setSyncReady?.(false);
      return false;
    }
  }

  async function updateMemberPresence(extra = {}) {
    const { room, clientId } = getSessionState();
    if (!modes.isRoomMode?.() || !room.roomId) return false;
    const member = identity.touchMemberWithProfile?.(room.members, clientId, extra)?.[clientId];
    room.members = {
      ...normalizeMembers(room.members),
      [clientId]: member
    };
    setRoom(room);
    try {
      await updateRoomMember(room.roomId, clientId, member);
      return true;
    } catch (_) {
      return false;
    }
  }

  function listenFirebaseUpdates() {
    const { room } = getSessionState();
    if (!room.roomId || listenedRoomId === room.roomId) return;

    if (unsubscribeRoom) {
      unsubscribeRoom();
      unsubscribeRoom = null;
    }

    listenedRoomId = room.roomId;
    mutations.setSyncReady?.(false);
    ui.setSyncStatus?.("同步中...");
    unsubscribeRoom = listenRoom(room.roomId, {
      onData: (data) => {
        mutations.setSyncReady?.(true);
        remote.applyRoomData?.(data);
        ui.setSyncStatus?.("已同步", "ok");
      },
      onMissing: () => {
        mutations.setSyncReady?.(false);
        ui.refreshInteractiveControls?.();
      },
      onError: (error) => {
        mutations.setSyncReady?.(false);
        const permissionDenied = String(error?.message || error).includes("permission");
        ui.setSyncStatus?.(permissionDenied ? "同步失败：权限不足" : "同步失败", "error");
        ui.refreshInteractiveControls?.();
      }
    });
  }

  function createRoom({ announce = true } = {}) {
    const { room, clientId } = getSessionState();
    const nextRoomId = room.roomId || generateRoomId();
    const nextRoom = createHostRoom({
      room,
      roomId: nextRoomId,
      clientId,
      inviteToken: createInviteToken(),
      createMembersMap: helpers.createMembersMap,
      touchMemberWithProfile: identity.touchMemberWithProfile
    });
    setRoom(nextRoom);
    mutations.setSyncReady?.(true);
    mutations.setHandId?.(0);
    mutations.setHandStatus?.("setup");
    ui.loadTableViewRotation?.();
    listenFirebaseUpdates();
    ui.renderIdentityControls?.();

    const inviteUrl = getInviteUrl(nextRoom.roomId, nextRoom.inviteToken);
    if (inviteUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("room", nextRoom.roomId);
      url.searchParams.set("invite", nextRoom.inviteToken);
      window.history.replaceState({}, "", url.toString());
    }
    if (announce) {
      ui.showAppAlert?.(`房间 ${nextRoom.roomId} 已创建。\n分享邀请链接后，玩家可设置昵称，并请求坐下。`, "房间已创建");
    }
  }

  async function createRoomIfAvailable({ announce = true } = {}) {
    const { room } = getSessionState();
    const requestedRoomId = normalizeRoomId(elements.roomIdInput?.value || room.roomId);
    const nextRoomId = requestedRoomId || generateRoomId();
    const exists = await remoteRoomExists(nextRoomId);
    if (exists === null) {
      ui.showAppAlert?.("无法检查房间是否存在，请检查网络后刷新重试。");
      return false;
    }
    if (exists) {
      if (elements.roomIdInput) elements.roomIdInput.value = nextRoomId;
      ui.setSyncStatus?.("房间已存在", "error");
      ui.showAppAlert?.(`房间 ${nextRoomId} 已存在，请直接加入，或更换一个房间 ID 后再创建。`, "房间已存在");
      return false;
    }

    const nextRoom = getSessionState().room;
    nextRoom.roomId = nextRoomId;
    setRoom(nextRoom);
    createRoom({ announce: false });
    if (elements.roomIdInput) elements.roomIdInput.value = getSessionState().room.roomId;
    const saved = await setup.sync?.({ createOnly: true });
    if (!saved) {
      ui.setSyncStatus?.("房间创建失败", "error");
      ui.showAppAlert?.("房间创建失败，可能已被其他人抢先创建，或当前连接异常。请换一个房间 ID 或刷新后重试。", "创建失败");
      return false;
    }

    ui.setSyncStatus?.("房间已创建", "ok");
    if (announce) {
      ui.showAppAlert?.(`房间 ${getSessionState().room.roomId} 已创建。\n分享邀请链接后，玩家可设置昵称，并请求坐下。`, "房间已创建");
    }
    return true;
  }

  function joinRoom(roomId, { inviteToken = "" } = {}) {
    const { room, clientId } = getSessionState();
    const normalizedRoomId = normalizeRoomId(roomId);
    if (!normalizedRoomId) return;
    const normalizedInviteToken = normalizeInviteToken(inviteToken);

    const result = createJoinedRoom({
      room,
      clientId,
      roomId: normalizedRoomId,
      inviteToken: normalizedInviteToken,
      createMembersMap: helpers.createMembersMap,
      touchMemberWithProfile: identity.touchMemberWithProfile
    });
    setRoom(result.room);
    if (result.switchingRoom) mutations.setSyncReady?.(false);
    if (elements.roomIdInput) elements.roomIdInput.value = normalizedRoomId;
    ui.loadTableViewRotation?.();
    listenFirebaseUpdates();
    ui.renderIdentityControls?.();
    updateMemberPresence();
  }

  function syncRoomFromInput() {
    const id = normalizeRoomId(elements.roomIdInput?.value);
    if (!id) return;
    joinRoom(id);
  }

  async function copyInviteLink() {
    const { room } = getSessionState();
    if (!modes.isRoomMode?.() || !room.roomId) {
      ui.showAppAlert?.("请先创建或加入房间。");
      return;
    }
    const inviteUrl = getInviteUrl();
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      ui.showAppAlert?.("邀请链接已复制。朋友打开后可设置昵称，并请求坐下。", "已复制邀请");
    } catch (_) {
      ui.showAppAlert?.(inviteUrl, "邀请链接");
    }
  }

  function applyRoomLinkFromUrl() {
    const params = getRoomLinkParams();
    if (!params.roomId) return;
    enterRoomMode();
    if (elements.roomIdInput) elements.roomIdInput.value = params.roomId;
    joinRoom(params.roomId, { inviteToken: params.inviteToken });
  }

  function bindEntryControls() {
    elements.localModeBtn?.addEventListener("click", enterLocalMode);
    elements.roomModeBtn?.addEventListener("click", enterRoomMode);
    elements.createRoomBtn?.addEventListener("click", async () => {
      if (getSessionState().gameStarted) return;
      identity.rememberPreferredDisplayName?.(elements.playerAliasInput?.value || identity.getPreferredDisplayName?.());
      await createRoomIfAvailable();
    });
    elements.joinRoomBtn?.addEventListener("click", () => {
      const id = normalizeRoomId(elements.roomIdInput?.value);
      if (!id) {
        ui.showAppAlert?.("请输入房间ID");
        return;
      }
      identity.rememberPreferredDisplayName?.(elements.playerAliasInput?.value || identity.getPreferredDisplayName?.());
      joinRoom(id);
    });
    elements.copyInviteBtn?.addEventListener("click", copyInviteLink);
  }

  return {
    bindEntryControls,
    stopListener,
    enterLocalMode,
    enterRoomMode,
    remoteRoomExists,
    getRemoteGameState,
    refreshFromRemote,
    updateMemberPresence,
    listenFirebaseUpdates,
    createRoom,
    createRoomIfAvailable,
    joinRoom,
    syncRoomFromInput,
    copyInviteLink,
    applyRoomLinkFromUrl,
    getInviteUrl,
    getRoomLinkParams
  };
}
