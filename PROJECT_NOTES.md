# Project Notes for Coding Agents

This file is for future coding agents working on this repository. It summarizes the current architecture, module responsibilities, progress, risks, and useful verification commands.

## Project Summary

Poker Chips is a static browser app for tracking chips during offline Texas Hold'em games. It is intended for groups that have physical cards but no physical chips. The app manages players, blinds, betting actions, pot size, side-pot settlement, hand reset, and optional room synchronization through Firebase Realtime Database.

The app is intentionally lightweight:

- No build step
- No framework
- No package manager metadata
- Native browser ES modules
- Firebase SDK loaded from the official CDN in `src/firebase.js`

## Current Architecture

```text
index.html
  -> loads styles.css
  -> loads src/main.js as a module
       -> imports Firebase helpers from src/firebase.js

poker-game.js
  -> compatibility entrypoint that imports src/main.js
```

### `index.html`

Owns the static DOM shell:

- Top sync bar
- Setup panel
- Game panel
- Game info placeholders
- Player card container
- Showdown panel container
- Log panel container

Important: many elements are selected by `id` in `src/main.js`. Preserve these IDs unless you update all JS references:

- `setup`
- `game`
- `player-names`
- `start-game`
- `add-player`
- `initial-chips`
- `big-blind`
- `room-id`
- `manual-sync`
- `game-log`
- `hand-actions`
- `log-summary`
- `showdown-panel`
- `sync-status`
- `current-round`
- `pot-amount`
- `player-boxes`

### `styles.css`

Owns the full visual system:

- Deep green felt-like background
- Top bar and room sync controls
- Setup panel
- Game status cards
- Player cards
- Action buttons
- Showdown and side-pot panels
- Log panel
- Mobile breakpoints at `760px` and `420px`

The current UI theme uses deep emerald, antique gold, ivory, and chip red. Avoid replacing it with broad one-color gradients or generic dashboard styling unless the user explicitly asks for a redesign.

### `src/firebase.js`

Initializes Firebase and exports the small API surface used by the app:

- `db`
- `ref`
- `update`
- `onValue`
- `get`
- `runTransaction`

The Firebase config is client-side config. It is not treated like a private secret in normal Firebase web apps, but real deployments still need Realtime Database Security Rules.

### `src/main.js`

Contains most of the app:

- Module-level game state
- Player setup
- Betting actions
- Round advancement
- Side-pot construction
- Showdown settlement
- Next-hand reset
- Firebase sync and conflict guards
- DOM rendering

There is no separate state store, reducer, rule engine, or test harness yet.

### `poker-game.js`

Compatibility entrypoint only. It imports `./src/main.js`. Prefer changing `src/main.js` unless a legacy integration specifically loads `poker-game.js`.

### `assets/`

Contains generated site icon assets:

- `assets/poker-chip-icon.png`: 512x512 app/brand icon
- `assets/favicon.png`: 64x64 favicon

## State Model

Primary module-level variables in `src/main.js`:

- `players`: array of player objects
- `currentPlayerIndex`: index of the active player, or `-1`
- `pot`: total current pot
- `currentBet`: highest bet in the current betting round
- `currentRound`: numeric street index
- `rounds`: street labels
- `bigBlind` / `smallBlind`
- `gameOver`
- `gameStarted`
- `awaitingShowdown`
- `pendingPots`
- `selectedWinnersByPot`
- `handId`
- `handStatus`: one of `setup`, `playing`, `showdown`, `settled`
- `stateVersion`: optimistic concurrency guard for remote writes
- `mutationInProgress`, `syncReady`, `syncWriteInProgress`, `batchingStateUpdate`

Room data is mirrored into:

```js
room = {
  roomId,
  operator,
  players,
  gameState: {
    currentRound,
    pot,
    currentBet,
    currentPlayerIndex,
    logs,
    inProgress,
    gameOver,
    awaitingShowdown,
    pendingPots,
    handId,
    handStatus,
    stateVersion,
    updatedBy
  }
}
```

## Core Flow

1. Add players in the setup panel.
2. Start game:
   - Generate or join room.
   - Read player names/chips.
   - Initialize hand state.
   - Call `startRound()`.
3. `startRound()`:
   - Resets per-street bets.
   - Assigns positions.
   - Posts blinds before the flop.
   - Finds first actionable player.
   - Writes state to Firebase.
4. Player action:
   - `playerAction(action, index, amount)`
   - Validates current player and remote state.
   - Applies check/call/raise/fold.
   - Advances to next player or next street.
5. End conditions:
   - Single active player wins immediately.
   - All remaining players are all-in or betting is complete by river.
   - Otherwise advance street.
6. Showdown:
   - `beginShowdown()` builds side pots.
   - UI asks user to choose winner(s) per pot.
   - `confirmShowdown()` distributes chips and marks hand settled.
7. Next hand:
   - `resetHand()` rotates dealer, resets hand state, and starts a new preflop round.

## Firebase Sync and Concurrency

Realtime sync is room-based under:

```text
rooms/{roomId}
```

The app uses:

- `onValue()` for live remote updates
- `update()` for normal room writes
- `runTransaction()` for guarded writes during player actions, showdown settlement, and reset

Conflict guards use:

- `handId`
- `handStatus`
- `stateVersion`
- `currentPlayerIndex` for player actions

When a guarded write fails, the app refreshes from remote and shows an alert/status message.

Be careful when changing sync behavior. It is easy to create duplicate actions or stale-hand writes if `stateVersion`, `handId`, or `handStatus` are not preserved consistently.

## Current Progress

Implemented:

- Static app shell
- Responsive premium poker-themed UI
- App icon and favicon
- Player creation/removal before game start
- Initial chips and blind configuration
- Dealer, small blind, and big blind assignment
- Betting actions: Check, Call, Raise, Fold
- Basic All In handling
- Automatic street progression
- Pot and per-player bet tracking
- Operation log
- Showdown panel
- Side-pot construction and multi-winner distribution
- Next-hand reset and dealer rotation
- Firebase room sync with optimistic conflict checks

Needs more validation:

- Complex All In and side-pot scenarios with 3+ players
- Multiple clients acting at nearly the same time
- Firebase permission-denied and offline cases
- Recovery from partially created or stale rooms
- Long sessions with many hands/log entries

Not implemented:

- Hand history persistence beyond current room state
- Card dealing or hand-rank evaluation
- Automated tests
- Build pipeline
- Lint/format tooling
- Authentication
- Database security rules in this repository

## Development Notes

This project can be edited directly. There is no bundler.

Run a local server:

```bash
python3 -m http.server 8000
```

Open:

```text
http://localhost:8000/
```

Syntax checks:

```bash
node --check src/main.js
node --check src/firebase.js
git diff --check
```

Browser validation checklist:

- Setup screen renders on desktop and mobile.
- Adding two players enables “开始游戏”.
- Starting a game creates or joins a room.
- Player cards fit without horizontal overflow at about 390px width.
- Active player is visually obvious.
- Raise input expands without shifting outside the card.
- Showdown panel displays winner choices.
- “开始下一局” appears only after settlement.
- Sync status updates for success and failure states.

## Safe Change Guidelines

- Preserve DOM IDs used by `src/main.js`.
- Keep game-rule changes small and manually test several betting flows.
- If changing player object shape, update:
  - local creation
  - `normalizeIncomingPlayer()`
  - Firebase write/read paths
  - `updatePlayerBoxes()`
- If changing side-pot behavior, add manual test notes or automated tests first.
- If changing Firebase sync, keep guarded writes around action/settlement/reset flows.
- Avoid adding a framework unless the user asks for a larger refactor.
- Keep generated/browser test artifacts out of git. `.playwright-cli/` is ignored.

## Suggested Next Steps

1. Extract pure game rules from `src/main.js` into a testable module.
2. Add unit tests for all-in, side-pot, and split-pot cases.
3. Add a small manual QA script for common two-player and three-player flows.
4. Add Firebase rules documentation.
5. Consider room lifecycle controls: leave room, reset room, archive hand log.
