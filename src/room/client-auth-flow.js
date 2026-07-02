// src/room/client-auth-flow.js
// Firebase Anonymous Auth handoff from local fallback client id to authenticated uid.

import {
  auth,
  onAuthStateChanged,
  signInAnonymously
} from "../services/firebase.js";
import {
  normalizeMembers,
  normalizePlayerOwnerId
} from "./identity.js";

function rekeyRoomMember({ room = {}, players = [], previousClientId = "", nextClientId = "" } = {}) {
  if (!previousClientId || !nextClientId || previousClientId === nextClientId) {
    return { room, players };
  }
  const members = normalizeMembers(room.members);
  const previousMember = members[previousClientId] || {};
  delete members[previousClientId];
  members[nextClientId] = {
    ...previousMember,
    clientId: nextClientId,
    lastSeenAt: Date.now()
  };
  const nextPlayers = players.map(player => {
    if (normalizePlayerOwnerId(player.ownerClientId) !== previousClientId) return player;
    return {
      ...player,
      ownerClientId: nextClientId
    };
  });
  return {
    players: nextPlayers,
    room: {
      ...room,
      members,
      players: nextPlayers,
      operator: room.operator === previousClientId ? nextClientId : room.operator,
      hostClientId: room.hostClientId === previousClientId ? nextClientId : room.hostClientId
    }
  };
}

export function createClientAuthFlow({
  getState,
  mutations = {},
  modes = {},
  identity = {},
  remote = {},
  ui = {}
} = {}) {
  function applyAuthenticatedClientId(nextClientId) {
    const state = getState?.() || {};
    const normalizedClientId = normalizePlayerOwnerId(nextClientId);
    if (!normalizedClientId || normalizedClientId === state.clientId) return false;

    const rekeyed = rekeyRoomMember({
      room: state.room,
      players: state.players,
      previousClientId: state.clientId,
      nextClientId: normalizedClientId
    });
    let nextRoom = {
      ...rekeyed.room,
      members: identity.touchMemberWithProfile?.(rekeyed.room.members, normalizedClientId) || rekeyed.room.members
    };
    if (modes.isLocalMode?.()) {
      nextRoom = {
        ...nextRoom,
        operator: normalizedClientId,
        hostClientId: normalizedClientId
      };
    }

    mutations.applyAuthenticatedClientState?.({
      clientId: normalizedClientId,
      room: nextRoom,
      players: rekeyed.players
    });
    ui.refreshInteractiveControls?.();
    if (modes.isRoomMode?.() && nextRoom.roomId) {
      remote.updateMemberPresence?.();
    }
    return true;
  }

  function startAnonymousIdentity() {
    if (!auth) {
      mutations.setAuthState?.({ authReady: true, authUnavailable: true });
      return;
    }
    onAuthStateChanged(auth, (user) => {
      mutations.setAuthState?.({ authReady: true });
      if (user?.uid) {
        mutations.setAuthState?.({ authUnavailable: false });
        applyAuthenticatedClientId(user.uid);
        if (modes.isRoomMode?.() && getState?.().room?.roomId) {
          remote.stopListener?.();
          remote.listenFirebaseUpdates?.();
          remote.updateMemberPresence?.();
        }
        ui.setSyncStatus?.(modes.isRoomMode?.() && getState?.().room?.roomId ? "已连接身份" : "身份已就绪", "ok");
      }
      ui.renderIdentityControls?.();
    });
    signInAnonymously(auth).catch(() => {
      mutations.setAuthState?.({ authReady: true, authUnavailable: true });
      const state = getState?.() || {};
      ui.setSyncStatus?.(
        modes.isRoomMode?.() && state.room?.roomId
          ? "身份连接异常，房间同步以实际状态为准"
          : modes.isRoomMode?.()
            ? "多人房间未连接"
            : "本地模式"
      );
      ui.renderIdentityControls?.();
    });
  }

  return {
    applyAuthenticatedClientId,
    startAnonymousIdentity
  };
}
