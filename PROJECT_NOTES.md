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
       -> imports collapsible player manual rendering from src/guide.js
       -> imports chip riffle popover behavior from src/riffle.js
            -> imports sampled chip audio from src/riffle-sound.js

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
- Player manual mount points after setup actions and after the log panel

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
- Chip Riffle glass popover, skin button, chip side patterns, and chip color themes
- Mobile breakpoints at `760px` and `420px`

The current UI theme uses deep emerald, antique gold, ivory, and chip red. Avoid replacing it with broad one-color gradients or generic dashboard styling unless the user explicitly asks for a redesign.

Desktop and mobile share the same DOM. The layout switches mainly through CSS breakpoints:

- Desktop renders the player area as a horizontal oval poker table with evenly distributed seat labels, plus active controls in `#hand-actions` above the table.
- Mobile uses the same seat-label DOM on a taller vertical oval table and keeps active controls in `#hand-actions` above the table.
- The player cap is 10, matching a full-ring Texas Hold'em table and keeping future seat/oval-table layouts bounded.

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

### `src/guide.js`

Owns the generated player manual shown in collapsible panels on both the setup screen and game screen. It keeps usage guidance, beginner-friendly Texas Hold'em rules, and hand rankings in one structured source so the two UI placements stay synchronized.

### `poker-game.js`

Compatibility entrypoint only. It imports `./src/main.js`. Prefer changing `src/main.js` unless a legacy integration specifically loads `poker-game.js`.

### `assets/`

Contains generated site icon assets and sampled chip riffle audio:

- `assets/poker-chip-icon.png`: 512x512 app/brand icon
- `assets/favicon.png`: 64x64 favicon
- `assets/audio/riffle/*.mp3`: CC0 poker-chip samples from Kenney Casino Audio and BigSoundBank
- `assets/audio/riffle/LICENSES.md`: source and license notes for bundled audio

### `src/riffle.js` and `src/riffle-sound.js`

`src/riffle.js` owns the optional Chip Riffle popover opened from the header chip icon. It is intentionally isolated from the core game flow so the animation can run without blocking Firebase updates or normal hand actions.

Riffle behavior is modeled as real chip identity plus current stack order:

- `stackOrder` is the current single-stack order from bottom to top.
- Each split takes the current lower half as the left pile and the current upper half as the right pile.
- A successful riffle commits a deterministic interleave: `[left0, right0, left1, right1, ...]`.
- Chip colors and symbols are tied to chip identity (`data-chip-set`), not to the current left/right pile. This is important for dual-color skins: repeated riffles should visibly mix the piles instead of sorting chips back by color.
- The current 12-chip, 6/6 perfect riffle returns to the initial color grouping after 10 successful riffles.

The popover has a skin switcher. Skin selection is saved in `localStorage` under `pokerChipsRiffleSkin`; stack position is reset whenever the popover opens. Keep the existing skin id `mint-white` for local-storage compatibility even though the visible label is now orange/green.

Chip side decoration is CSS-only. The default/dual-color skins use repeated SVG crown marks; the orange/green skin uses a decorative letter `C`. These are embedded as CSS data URIs in `styles.css` so no extra assets or DOM nodes are required. Keep the crown/letter repeat aligned with the chip width: the 126px chip side currently uses two 63px pattern cells, yielding exactly two visible marks per chip.

`src/riffle-sound.js` owns the Web Audio sampler. It preloads only the MP3 files referenced by `SAMPLE_GROUPS`, decodes them after the first user gesture, and triggers short samples for split, riffle progress, reverse movement, scrape, and settle sounds. The current samples come from Kenney Casino Audio and BigSoundBank Poker Chips; source pages and licenses are documented in `assets/audio/riffle/LICENSES.md`. Keep audio assets small and mobile-safe; MP3 is used here for better Safari/iOS compatibility than OGG.

## State Model

Primary module-level variables in `src/main.js`:

- `players`: array of player objects
- `currentPlayerIndex`: index of the active player, or `-1`
- `pot`: total current pot
- `currentBet`: highest bet in the current betting round
- `lastRaiseSize`: most recent full bet/raise increment in the current betting round; short all-in raises do not update it
- `currentRound`: numeric street index
- `rounds`: street labels
- `bigBlind` / `smallBlind`
- `gameOver`
- `gameStarted`
- `awaitingShowdown`
- `pendingPots`
- `selectedWinnersByPot`
- `pendingDealPrompt`
- `settlementPreview`
- `tableDraft`
- `tableManagerOpen`
- `handId`
- `handStatus`: one of `setup`, `playing`, `waitingDeal`, `showdown`, `settlementPreview`, `settled`
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
    lastRaiseSize,
    currentPlayerIndex,
    logs,
    inProgress,
    gameOver,
    awaitingShowdown,
    pendingPots,
    selectedWinnersByPot,
    pendingDealPrompt,
    settlementPreview,
    handId,
    handStatus,
    stateVersion,
    updatedBy
  }
}
```

Player objects now include seat-management fields:

- `seatIndex`: normalized seat order index. The array order is still the source of truth for seat order.
- `seatStatus`: one of `seated`, `sittingOut`, `busted`, `left`.
- `dealer`: marks the previous/current Button seat. Next-hand rotation skips non-eligible seats.

Only `seatStatus === "seated" && chips > 0` is eligible for a new hand. Players can have `chips === 0` during an all-in hand; they are not marked `busted` until settlement finishes.

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
   - Raise `amount` is the target street bet (“加到”), not just this click's committed chips.
   - Minimum raise target is `currentBet + lastRaiseSize` when facing a bet, or at least one big blind for an opening bet.
   - Short all-in raises above `currentBet` are allowed, but they do not update `lastRaiseSize` or reopen raising for players who already acted.
   - Advances to next player or next street.
   - Fold asks for local confirmation before writing state.
5. End conditions:
   - Single active player wins immediately.
   - All remaining players are all-in or betting is complete by river.
   - Otherwise advance street.
6. Street transition:
   - Betting completion before the river creates `pendingDealPrompt`.
   - `handStatus` becomes `waitingDeal`.
   - All clients see the same deal prompt; one confirmed click advances into the next street by guarded transaction.
7. Showdown:
   - `beginShowdown()` builds side pots.
   - UI asks user to choose winner(s) per pot.
   - `confirmShowdown()` now creates `settlementPreview` rather than distributing immediately.
   - `confirmSettlementPreview()` applies payouts and marks the hand settled.
   - `cancelSettlementPreview()` returns all clients to winner selection.
8. Next hand:
   - `resetHand()` requires at least two eligible players.
   - Dealer, small blind, big blind, and action order skip `busted`, `sittingOut`, and `left` seats.
   - Heads-up rules are handled when exactly two eligible players remain.
9. Table management:
   - Available only after settlement.
   - Edits are held in `tableDraft` and synchronized only when saved.
   - Supports seat reorder, chip adjustment, sitting out, leaving, returning, and adding a player.
   - “保存并开始下一局” first saves the table with a guarded write, then calls `resetHand()`.

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
- Oval poker-table player layout with compact seat labels and center table status
- App icon and favicon
- Chip Riffle popover with real-order chip animation, single/dual-color skins, CSS chip symbols, and sampled chip sound effects
- Collapsible player manual on setup and game screens with usage guide, Texas Hold'em rules, and hand rankings
- Player creation/removal before game start
- Maximum 10 players in setup and post-settlement table management
- Initial chips and blind configuration
- Dealer, small blind, and big blind assignment
- Betting actions: Check, Call, Raise, Fold
- Raise panel with min / half-pot / two-thirds-pot / pot / all-in presets, step nudges, manual target input, and live commit validation
- Current-action panel above the table on desktop and mobile
- Minimum-raise tracking through `lastRaiseSize`; short all-in raises do not reopen betting to already-acted players
- Call amount shown in player cards and the active Call button
- Local Fold confirmation
- Basic All In handling
- Automatic betting completion with synchronized deal prompts between streets
- Pot and per-player bet tracking
- Operation log
- Showdown panel
- Synchronized settlement preview with confirm/cancel before payouts
- Post-settlement table manager for seat order, chip edits, sit-out/leave/return, and add-player
- Busted players: zero-chip seated players become `busted` after settlement and are skipped next hand until topped up
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
- Desktop and mobile show action buttons in the standalone current-action panel above the oval table.
- Seat labels stay evenly distributed around the oval for 2-10 players.
- Adding players is capped at 10 in setup and table management.
- Call button shows the needed call amount when calling is available.
- Raise opens a panel instead of focusing a bare input.
- Raise presets update the “加到” input and live “本次投入” preview.
- Invalid raises stay blocked: below minimum, above stack, non-raise, and short all-in spots that do not reopen action.
- Fold asks for confirmation before writing the action.
- Completing a betting round shows a shared deal prompt and blocks player actions until confirmed.
- Raise panel fits inside the active card on desktop, mobile portrait, and short landscape.
- Showdown panel displays winner choices.
- Generating settlement preview shows the payout plan on all clients.
- Canceling settlement preview returns to winner selection; confirming settles once.
- Zero-chip losers are marked “待补码” after settlement.
- “牌桌管理” can adjust chips and return a busted player before the next hand.
- Fewer than two eligible players disables “开始下一局”.
- Moving seats changes the next-hand Button/blind preview and the next hand follows that seat order.
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
