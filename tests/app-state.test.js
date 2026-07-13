import assert from "node:assert/strict";
import test from "node:test";

import { createAppState } from "../src/app/app-state.js";

test("app state keeps room players aligned with authoritative players", () => {
  const store = createAppState();
  const firstPlayers = [{ id: "player-1" }];
  const replacementRoom = {
    ...store.state.room,
    players: []
  };

  store.patch({ players: firstPlayers, room: replacementRoom });

  assert.equal(store.state.room, replacementRoom);
  assert.equal(store.state.players, firstPlayers);
  assert.equal(store.state.room.players, firstPlayers);

  const nextPlayers = [{ id: "player-2" }];
  store.setPlayers(nextPlayers);

  assert.equal(store.state.players, nextPlayers);
  assert.equal(store.state.room.players, nextPlayers);
});
