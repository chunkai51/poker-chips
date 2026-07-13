import { getAppElements } from "./app/app-elements.js";
import { createAppPolicy } from "./app/app-policy.js";
import { createAppState } from "./app/app-state.js";
import { createAppUi } from "./app/app-ui.js";
import { createGameRuntime } from "./app/game-runtime.js";
import { createRoomRuntime } from "./app/room-runtime.js";
import { createTableRuntime } from "./app/table-runtime.js";
import { initChipRiffle } from "./riffle/riffle.js";
import { initGuidePanels } from "./ui/guide.js";

const store = createAppState();
const elements = getAppElements();
const policy = createAppPolicy({ state: store.state });
const ui = createAppUi({ state: store.state, elements });

const roomRuntime = createRoomRuntime({ store, elements, policy, ui });
const gameRuntime = createGameRuntime({ store, elements, policy, ui, roomRuntime });
const tableRuntime = createTableRuntime({
  store,
  elements,
  policy,
  ui,
  roomRuntime,
  gameRuntime
});

initGuidePanels();
initChipRiffle({ trigger: elements.riffleTrigger });
tableRuntime.init();
gameRuntime.init();
roomRuntime.init();

// Intentional browser-console hooks for hand-flow debugging.
window.playerAction = gameRuntime.playerAction;
window.resetHand = gameRuntime.resetHand;
