import assert from "node:assert/strict";
import test from "node:test";

import { createSetupLobbyFlow } from "../src/room/setup-lobby-flow.js";

test("lobby controls are re-enabled after a setup sync finishes", async () => {
  const state = {
    players: [{ id: "player-1", name: "Alice", chips: 1000 }],
    room: { roomId: "test-room", gameState: {}, members: {} },
    clientId: "client-1",
    bigBlind: 20,
    handId: 0,
    handStatus: "setup",
    stateVersion: 0,
    gameStarted: false,
    authReady: true,
    syncWriteInProgress: false
  };
  const addPlayerBtn = { disabled: false, textContent: "" };
  let flow;

  flow = createSetupLobbyFlow({
    elements: {
      addPlayerBtn,
      initialChipsInput: { value: "1000", disabled: false },
      bigBlindInput: { disabled: false }
    },
    getState: () => state,
    mutations: {
      setPlayers: players => {
        state.players = players;
      },
      setRoom: room => {
        state.room = room;
      },
      setStateVersion: version => {
        state.stateVersion = version;
      },
      setSyncWriteInProgress: inProgress => {
        state.syncWriteInProgress = Boolean(inProgress);
      }
    },
    modes: {
      isRoomMode: () => true
    },
    permissions: {
      canCurrentClientManageRoom: () => true,
      canCurrentClientEditRoomSettings: () => true
    },
    identity: {
      touchMemberWithProfile: members => members
    },
    remote: {
      transactRoom: async () => {
        flow.updateActionState();
        assert.equal(addPlayerBtn.disabled, true);
        return { committed: true };
      }
    }
  });

  await flow.sync();

  assert.equal(state.syncWriteInProgress, false);
  assert.equal(addPlayerBtn.disabled, false);
  assert.equal(addPlayerBtn.textContent, "添加玩家");
});
