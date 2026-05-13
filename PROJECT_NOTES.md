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
       -> imports Firebase Auth/Database helpers from src/firebase.js
       -> imports legacy access-code helpers from src/access-codes.js
       -> imports player seat DOM builders from src/player-seat-ui.js
       -> imports raise action panel DOM builders from src/raise-ui.js
       -> imports room database adapter helpers from src/room-sync.js
       -> imports room entry/link/request helpers from src/room-entry.js
       -> imports room lobby state helpers from src/room-lobby-controller.js
       -> imports room permission helpers from src/room-permissions.js
       -> imports room/game-state normalizers from src/room-state.js
       -> imports settlement calculation helpers from src/settlement-engine.js
       -> imports client/room identity helpers from src/identity.js
       -> imports player model helpers from src/player-model.js
       -> imports pure table and betting rules from src/game-rules.js
       -> imports visual table coordinates from src/table-layout.js
       -> imports local table-view preferences from src/table-view-preferences.js
       -> imports table center DOM builders from src/table-center-ui.js
       -> imports table manager draft helpers from src/table-manager-controller.js
       -> imports table manager DOM builders from src/table-manager-ui.js
       -> imports shared dialog and DOM factories from src/dialogs.js and src/ui-dom.js
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
- `local-mode`
- `room-mode`
- `create-room`
- `join-room`
- `device-identity`
- `game-log`
- `hand-actions`
- `table-view-toolbar`
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

- `auth`
- `db`
- `ref`
- `update`
- `onValue`
- `get`
- `runTransaction`
- `onAuthStateChanged`
- `signInAnonymously`

The Firebase config is client-side config. It is not treated like a private secret in normal Firebase web apps, but real deployments still need Firebase Auth, Realtime Database Security Rules, App Check, and eventually Cloud Functions command validation.

### `src/room-sync.js`

Thin Realtime Database adapter for room-level network access:

- Room existence checks
- Full room reads and game-state reads
- Room listener setup
- Room-level transactions
- Member presence and join-request partial updates

Keep Firebase `ref/get/update/onValue/runTransaction` usage here instead of spreading low-level database calls across UI and game-flow code. Business transaction bodies still live in `src/main.js` for now; a later split can move command-specific mutations behind a cleaner room command layer.

### `src/room-entry.js`

Owns room-entry and invitation helpers:

- Room id and invite-token normalization
- Random room id and invite-token generation
- Invite-link and URL search-parameter parsing helpers
- Local display-name persistence
- Join/reclaim request normalization

This module may touch browser storage and URL parsing, but it should not render DOM, write Firebase, or decide game permissions.

### `src/room-lobby-controller.js`

Owns DOM-free lobby-state helpers:

- Local-mode room data reset
- Host room data initialization
- Joined-room data initialization
- Setup/lobby game-state payload creation
- Room transaction payload construction for lobby sync

This module should receive dependencies explicitly through parameters, such as `createMembersMap`, `touchMemberWithProfile`, `canClientManageRoom`, `mergePlayerIdentityFields`, and normalizers. It should not read module-level app state, render DOM, start listeners, or call Firebase directly.

### `src/access-codes.js`

Owns legacy recovery-code helpers:

- Admin-code and player-code local-storage keys
- Remembered admin/player code persistence
- Admin/player code salts
- Admin/player code validation against stored hashes

The normal UX now uses invite-link + seat request approval, but these helpers remain for old rooms and recovery paths. Keep this module free of DOM rendering, Firebase writes, and room permission decisions.

### `src/room-state.js`

Owns DOM-free room/game-state payload helpers:

- Player payload normalization
- Side-pot payload normalization
- Winner-selection serialization and normalization
- Settlement-preview normalization

This module is intentionally about data shape only. It should not render UI, write Firebase, or decide permissions.

### `src/settlement-engine.js`

Owns DOM-free settlement calculations:

- Side-pot construction from player total commitments and folded state
- Adjacent side-pot merging when contenders are identical
- Winner plan creation from selected winners
- Split-pot payout calculation
- Settlement-preview and report-line construction

Keep this module pure and testable. It should not mutate `players`, show dialogs, render UI, or write Firebase.

### `src/room-permissions.js`

Owns DOM-free room permission helpers:

- Host lookup
- Admin/manager checks
- Room-manager proxy lookup for unclaimed seats
- Player-control checks
- Current-device player lookup helpers

`src/main.js` keeps thin wrappers because it still owns `clientId`, current `room`, remembered admin-code checks, and local fallback state.

### `src/player-seat-ui.js`

Owns DOM builders for player seats around the visual poker table:

- Player capsule shell and state classes
- Seat coordinate CSS variables
- Position markers such as D, SB, BB, and D/SB
- Bet/status badges
- Seat detail popover
- Optional claim/reclaim button inside the popover

`src/main.js` still computes labels, permissions, active seat state, and claim callbacks. Keep this module focused on rendering the seat UI from prepared values.

### `src/player-model.js`

Owns DOM-free player data helpers:

- Player id generation
- Setup-player creation and normalization
- Display-name extraction
- Auto-generated seat-name detection
- Duplicate-name aware player labels

Keep this module about player object shape and labels. It should not decide room permissions, render player seats, write Firebase, or mutate the global `players` array.

### `src/raise-ui.js`

Owns the Raise action panel DOM:

- Rule summary chips
- Preset raise targets
- Numeric raise target field
- Nudge buttons
- Live validation preview
- Confirm button text/disabled state

`src/main.js` still computes legal raise targets and supplies the validation callback. Keep betting rules in `src/game-rules.js` / `src/main.js`, not in this UI module.

### `src/approvals.js`

Owns DOM-free approval progress helpers used by room-mode settlement confirmation and next-hand readiness:

- Normalizes approval maps keyed by client id.
- Computes approved/required counts and completion state.
- Keep label rendering in `src/main.js`; this module should stay pure enough to reuse from a future backend command validator.

### `src/deal-prompts.js`

Owns DOM-free synchronized dealer prompt metadata:

- Opening hand prompt: deal two hole cards after blinds are posted.
- Flop / turn / river prompts.
- Incoming prompt normalization for Firebase room state.

The module intentionally does not decide who may confirm a prompt; that remains in room/identity flow code for now.

### `src/identity.js`

Owns the compatibility identity layer for the multiplayer-by-player roadmap:

- Persistent local `clientId` fallback in `localStorage`; `src/main.js` replaces it with Firebase Anonymous Auth `uid` when available
- Room modes: `local` and `room`
- Room host id normalization for legacy rooms and creator fallback
- Room member map normalization, claimed-player ids, display names, admin-session flags, and last-seen updates
- Optional `ownerClientId` normalization for player objects
- Access-code helpers kept for backward compatibility, but the primary UX is now invite-link + request approval
- Permission helper stubs such as `canClientControlPlayer()` and `isRoomHost()`

Important: this layer is still partly frontend-enforced. The app now uses Anonymous Auth when available, but complete malicious-client resistance depends on finishing Security Rules and moving critical game mutations behind Cloud Functions command processing. Unbound players (`ownerClientId === ""`) are controlled by the room manager proxy so rooms do not become stuck.

### `src/game-rules.js`

Owns pure, DOM-free poker table rules:

- Seat status labels and normalization
- Eligibility for the next hand
- Next eligible seat lookup
- Button / small blind / big blind / first-action layout, including heads-up handling
- Action eligibility
- Call amount
- Raise minimums, max target, pot-sized presets, and validation

Keep this module side-effect-free. It should be the first place to add unit tests for betting, all-in, side-pot-adjacent, and seat-rotation behavior.

### `src/ui-dom.js`

Owns tiny shared DOM factories:

- `createParagraph()` for safe text-only paragraph creation
- `createButton()` for standard button creation with disabled/class/click wiring

Keep this module generic. It should not know about poker rules, room state, Firebase, or app-specific permission logic.

### `src/dialogs.js`

Owns shared modal shells:

- App-level alert/confirm dialog replacements for browser `alert()` / `confirm()`
- Table action dialog shell used by raise, showdown, settlement, and similar focused actions

Business flows still live in `src/main.js`; this module only creates the reusable dialog frame and delegates content construction through callbacks.

### `src/table-layout.js`

Owns the visual seat-slot coordinates for the poker table:

- `TABLE_SEAT_LAYOUTS`: editable desktop/mobile seat points for 1-10 players
- `normalizeRotationOffset()`: pure rotation wraparound helper
- `getVisualSeatCoordinates()`: maps a player index to a visual slot, including local-only table rotation and "my player at bottom" anchoring

This is the preferred file for hand-tuning player label placement. Keep it DOM-free so layout experiments are easy to review and eventually test.

### `src/table-view-preferences.js`

Owns local-only table-view preferences:

- Local rotation storage key
- Rotation offset load/save helpers

These preferences are intentionally not written to Firebase. Each browser/device can rotate the visual table independently.

### `src/table-center-ui.js`

Owns DOM builders for table-center UI:

- Center status shell with pot and hand meta
- Operation headers
- Animated waiting notices
- Showdown winner-selection dialog body
- Settlement-preview dialog body

`src/main.js` still decides which state is active, which actions are allowed, and what callbacks run. Keep this module UI-focused and callback-driven.

### `src/table-manager-controller.js`

Owns draft-state logic for the table management workflow:

- Creates the editable table draft from current players
- Normalizes draft players back into player payloads
- Adds, deletes, reorders, and returns seats
- Adjusts chip counts and seat status
- Builds the next-hand preview summary

It does not save to Firebase and does not render DOM. Persistence, permissions, and conflict guards remain in `src/main.js` for now.

### `src/table-manager-ui.js`

Owns DOM builders for the seat and identity management panel:

- Panel header and footer
- Current identity summary
- Seat-request list
- Player rows with seat order, chip editing, seat status, and identity controls

`src/main.js` prepares the context, permission booleans, formatter functions, and mutation callbacks. This module should stay UI-focused and avoid direct Firebase writes or room-state ownership.

### `src/main.js`

Still orchestrates most of the app:

- Module-level game state
- Player setup
- Betting actions
- Round advancement
- Side-pot construction
- Showdown settlement
- Next-hand reset
- Firebase sync and conflict guards
- DOM rendering

It now delegates room database access to `src/room-sync.js`, room-entry helpers to `src/room-entry.js`, room lobby data helpers to `src/room-lobby-controller.js`, legacy access-code helpers to `src/access-codes.js`, room payload normalization to `src/room-state.js`, room permission checks to `src/room-permissions.js`, identity normalization to `src/identity.js`, player object helpers to `src/player-model.js`, approval progress to `src/approvals.js`, dealer prompt metadata to `src/deal-prompts.js`, settlement calculations to `src/settlement-engine.js`, player-seat DOM rendering to `src/player-seat-ui.js`, raise panel DOM rendering to `src/raise-ui.js`, visual seat coordinates to `src/table-layout.js`, local table-view preferences to `src/table-view-preferences.js`, table-center DOM rendering to `src/table-center-ui.js`, table-manager draft logic to `src/table-manager-controller.js`, table-manager DOM rendering to `src/table-manager-ui.js`, shared dialog shells to `src/dialogs.js`, small DOM factories to `src/ui-dom.js`, and core table/betting calculations to `src/game-rules.js`. There is still no separate state store, reducer, or test harness.

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
  mode,
  operator,
  hostClientId,
  inviteToken,
  adminKeyHash,
  adminPlayerIds,
  joinRequests,
  members,
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

Room identity fields:

- `mode`: `local` or `room`. Local mode keeps single-device/shared-control behavior.
- `operator`: legacy room creator/operator field, kept for compatibility.
- `hostClientId`: normalized room host id. Existing rooms fall back to `operator`.
- `inviteToken`: long random token included in copied invitation links. It is a UX gate today and a future rules input, not a standalone secret once room reads are broad.
- `adminKeyHash`: legacy salted room management-code hash. Kept for compatibility; no longer shown in the normal room flow.
- `adminPlayerIds`: player ids that carry cohost rights when the player is bound by a device.
- `joinRequests`: map keyed by requester `clientId`, used for seat join/reclaim approvals.
- `members`: map keyed by `clientId`, used for presence, display name, claimed-player id, and the current device's admin-session flag.
- Table view rotation is intentionally local-only. The offset is stored in `localStorage` under `pokerChipsTableViewRotation:{roomId}` and is never written to Firebase.
- `gameState.nextHandApprovals`: room-mode readiness map for starting the next hand.
- `gameState.settlementPreview.approvals`: room-mode confirmation map for applying the settlement preview.

Player objects now include seat-management fields:

- `seatIndex`: normalized seat order index. The array order is still the source of truth for seat order.
- `seatStatus`: one of `seated`, `sittingOut`, `busted`, `left`.
- `dealer`: marks the previous/current Button seat. Next-hand rotation skips non-eligible seats.
- `ownerClientId`: current Firebase Auth uid or local fallback client id binding. Empty string means unbound and controlled by the room manager proxy.
- `playerKeyHash`: legacy salted player recovery-code hash. Kept for compatibility, but the normal flow uses join/reclaim requests approved by host/cohost.

Only `seatStatus === "seated" && chips > 0` is eligible for a new hand. Players can have `chips === 0` during an all-in hand; they are not marked `busted` until settlement finishes.

## Core Flow

1. Add players in the setup panel.
2. Start game:
   - Choose local mode or room mode.
   - In room mode, enter a display name, create a room, and copy the invite link. Joining from `?room=...&invite=...` fills the room automatically.
   - In room mode, ordinary devices request a seat or request a reclaim. Host/cohost approval binds that device to the player without interrupting the hand.
   - In room mode, only host/cohost devices can add/remove players, edit setup stacks, approve seat requests, and start the first hand.
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
   - In room mode, only the player owner can act; if a player is unbound, the room manager proxy is treated as that player's controller.
5. End conditions:
   - Single active player wins immediately.
   - All remaining players are all-in or betting is complete by river.
   - Otherwise advance street.
6. Street transition:
   - Betting completion before the river creates `pendingDealPrompt`.
   - `handStatus` becomes `waitingDeal`.
   - All clients see the same deal prompt. Only the Dealer owner can confirm; if the Dealer is unbound, the room manager proxy can confirm.
7. Showdown:
   - `beginShowdown()` builds side pots.
   - UI asks user to choose winner(s) per pot.
   - `confirmShowdown()` now creates `settlementPreview` rather than distributing immediately.
   - In room mode, `confirmSettlementPreview()` records the current device's approval. Payouts are applied only after all required approvers have confirmed.
   - `cancelSettlementPreview()` returns all clients to winner selection.
8. Next hand:
   - `resetHand()` requires at least two eligible players.
   - In room mode, `approveNextHandStart()` records readiness and only calls `resetHand()` after all next-hand approvers have confirmed.
   - Seat binding changes while settled clear `nextHandApprovals`, because they change who must approve the next hand.
   - Dealer, small blind, big blind, and action order skip `busted`, `sittingOut`, and `left` seats.
   - Heads-up rules are handled when exactly two eligible players remain.
9. Table management:
   - The dialog can be opened during a hand in room mode for seat/reclaim request approval.
   - Table edits are enabled only before the first hand or after settlement, and only for host/cohost devices.
   - Identity binding now uses request approval. Legacy player/admin-code helpers remain in code but are hidden from the normal UI.
   - Table edits are held in `tableDraft` and synchronized only when saved.
   - Supports seat reorder, chip adjustment, sitting out, leaving, returning, deleting, and adding a player.
   - “保存并开始下一局” first saves the table with a guarded write, then calls `approveNextHandStart()`; in room mode this records the host/cohost/proxy approval without skipping the all-player confirmation flow.

## Security Roadmap

Current implementation:

- Anonymous Auth is attempted on startup. If unavailable, the app falls back to the historical local `clientId`.
- Seat ownership is represented by `player.ownerClientId`.
- Ordinary players request seats through `room.joinRequests`; host/cohost devices approve.
- Some game mutations are still written directly by the browser with transaction guards.

Repository scaffolding:

- `database.rules.json`: transitional Realtime Database rules requiring `auth != null` and constraining members, join requests, and command creation. These rules still allow member writes needed by the current direct-write game flow.
- `functions/index.js`: Cloud Functions v2 command-processing skeleton under `/rooms/{roomId}/commands/{commandId}`.
- `firebase.json`: Firebase CLI entrypoint for rules, functions, and static hosting.

Target production model:

- Clients write intent commands only.
- Cloud Functions validate seat ownership, hand id, current action, betting legality, and idempotency.
- Cloud Functions write `players`, `gameState`, logs, settlement, and next-hand state with Admin SDK.
- Security Rules deny direct client writes to critical game state once command coverage is complete.

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
- Setup mode switch for single-device local mode vs multiplayer room mode
- Room creation/join controls in the setup panel with display name, invite link copying, and URL room auto-join
- Anonymous Auth integration with local `clientId` fallback
- Multiplayer player binding through `ownerClientId` plus host/cohost-approved join/reclaim requests
- Cohost grant/revoke through administrator-player ids
- Current-device identity display
- Local-only table view rotation in room mode
- Bound-player perspective: rotation offset `0` places the current device's player at the bottom-center table seat; manual rotation rotates the whole table locally, and “以我为底” resets the offset
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
- Shared seat and identity manager for in-hand seat/reclaim approvals plus setup/post-settlement seat order, chip edits, sit-out/leave/return, delete-player, and add-player
- Busted players: zero-chip seated players become `busted` after settlement and are skipped next hand until topped up
- Side-pot construction and multi-winner distribution
- Next-hand reset and dealer rotation
- Firebase room sync with optimistic conflict checks
- Custom in-app alert/confirm dialog UI instead of native browser dialogs
- Extracted pure game/table rules in `src/game-rules.js`
- Compatibility identity layer in `src/identity.js` with `clientId`, `mode`, `hostClientId`, `members`, access-code compatibility helpers, admin-player ids, and player `ownerClientId`
- Frontend permission layer for room mode: host/cohost setup/table management, own-player actions, Dealer-only deal confirmation with manager proxy for unbound players
- Firebase CLI, Realtime Database rules, and Cloud Functions command-processing scaffold
- All-required-player confirmation for settlement preview and next-hand start

Needs more validation:

- Complex All In and side-pot scenarios with 3+ players
- Multiple clients acting at nearly the same time
- Firebase permission-denied and offline cases
- Permission edge cases with unbound players, host/cohost reconnects, ownership takeovers, and simultaneous approvals
- Recovery from partially created or stale rooms
- Long sessions with many hands/log entries

Not implemented:

- Hand history persistence beyond current room state
- Card dealing or hand-rank evaluation
- Automated tests
- Build pipeline
- Lint/format tooling
- Complete Cloud Functions command coverage for all betting, settlement, and next-hand mutations
- Final strict database rules that deny direct client writes to `players` and `gameState`
- App Check setup

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
for f in src/*.js functions/*.js; do node --check "$f" || exit 1; done
git diff --check
```

Browser validation checklist:

- Setup screen renders on desktop and mobile.
- Setup mode switch can move between local mode and room mode before a hand starts.
- Creating a room writes a setup room, generates an invite link, and copies/shows it from the room controls.
- Joining from an invite URL fills the room id automatically and loads setup players when the remote room is still in setup.
- A non-host device can enter a display name and request a seat; it is not bound until host/cohost approval.
- Approving a join/reclaim request marks only one player as that device's seat and clears any previous binding for that requester.
- Non-admin room clients cannot add/delete setup players, edit setup stacks, save table management, or start the first hand.
- Non-admin room clients can still open "席位与身份管理" to inspect their identity and pending requests.
- Host/cohost can approve or reject join/reclaim requests.
- Host/cohost can grant/revoke cohost rights for a bound player.
- Adding two players enables “开始游戏”.
- Starting a game in local mode does not create a remote room and actions are not blocked by sync state.
- Starting a game in room mode creates or joins a room.
- Player cards fit without horizontal overflow at about 390px width.
- Active player is visually obvious.
- Room-mode action buttons are enabled only on the device that owns the current player; unbound players are controlled by host/cohost proxy.
- Deal prompts can only be confirmed by the Dealer owner, or by host/cohost proxy when Dealer is unbound.
- In room mode, a bound player appears at the bottom-center seat on that device when the view offset is reset.
- Room-mode rotation buttons change only the current browser's layout and do not change another browser's layout.
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
- Canceling settlement preview returns to winner selection on all clients.
- Confirming settlement preview records one approval per required player/proxy and settles once all are complete.
- Zero-chip losers are marked “待补码” after settlement.
- “席位与身份管理” can adjust chips and return a busted player before the next hand.
- Fewer than two eligible players disables “开始下一局”.
- Room-mode next-hand start records one approval per required player/proxy and starts once all are complete.
- Moving seats changes the next-hand Button/blind preview and the next hand follows that seat order.
- “开始下一局” appears only after settlement.
- Sync status updates for success and failure states.

## Safe Change Guidelines

- Preserve DOM IDs used by `src/main.js`.
- Keep game-rule changes small, prefer pure helpers in `src/game-rules.js`, and manually test several betting flows.
- If changing player object shape, update:
  - local creation
  - `normalizeIncomingPlayer()`
  - `createTableDraft()` / `normalizeDraftPlayer()`
  - Firebase write/read paths
  - `updatePlayerBoxes()`
- If changing room identity shape, update `src/identity.js`, `room` defaults, `applyRoomData()`, `updateFirebaseState()`, and docs together.
- If changing side-pot behavior, add manual test notes or automated tests first.
- If changing Firebase sync, keep guarded writes around action/settlement/reset flows.
- Avoid adding a framework unless the user asks for a larger refactor.
- Keep generated/browser test artifacts out of git. `.playwright-cli/` is ignored.

## Suggested Next Steps

1. Move `playerAction`, deal confirmation, settlement preview confirmation, table saves, and next-hand approval to command writes processed by Cloud Functions.
2. Tighten `database.rules.json` after command coverage so clients cannot directly write `players` or `gameState`.
3. Enable Firebase Anonymous Auth, App Check, API key restrictions, and budget alerts in the Firebase console.
4. Add unit tests for `src/game-rules.js`, `src/identity.js`, and the Cloud Functions command validator.
5. Consider room lifecycle controls: leave room, reset room, archive hand log.
