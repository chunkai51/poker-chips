# Project Notes for Coding Agents

This file is for future coding agents working on this repository. It summarizes the current architecture, module responsibilities, progress, risks, and useful verification commands.

## Project Summary

Poker Chips is a static browser app for tracking chips during offline Texas Hold'em games. It is intended for groups that have physical cards but no physical chips. The app manages players, blinds, betting actions, pot size, side-pot settlement, hand reset, and optional room synchronization through Firebase Realtime Database.

The app is intentionally lightweight:

- No build step
- No framework
- No package manager metadata
- Native browser ES modules
- Firebase SDK loaded from the official CDN in `src/services/firebase.js`

## Current Architecture

```text
index.html
  -> loads styles.css
  -> loads src/main.js as a module
       -> imports Firebase Auth/Database helpers from src/services/firebase.js
       -> imports legacy access-code helpers from src/room/access-codes.js
       -> imports player seat DOM builders from src/ui/player-seat-ui.js
       -> imports raise action panel DOM builders from src/ui/raise-ui.js
       -> imports room database adapter helpers from src/room/room-sync.js
       -> composes setup/lobby flow from src/room/setup-lobby-flow.js
       -> composes room session flow from src/room/room-session-flow.js
       -> composes guarded game-sync flow from src/room/game-sync-flow.js
       -> composes shared approval labels from src/room/approval-labels.js
       -> imports room claim/request helpers from src/room/room-claims-controller.js
       -> imports room entry/link/request helpers from src/room/room-entry.js
       -> imports room lobby state helpers from src/room/room-lobby-controller.js
       -> imports room permission helpers from src/room/room-permissions.js
       -> imports room/game-state normalizers from src/room/room-state.js
       -> imports hand-flow state transition helpers from src/core/hand-flow-controller.js
       -> imports hand lifecycle state transitions from src/game/hand-controller.js
       -> imports settlement state transitions from src/game/settlement-controller.js
       -> imports settlement calculation helpers from src/core/settlement-engine.js
       -> imports client/room identity helpers from src/room/identity.js
       -> imports player model helpers from src/core/player-model.js
       -> imports pure table and betting rules from src/core/game-rules.js
       -> imports visual table coordinates from src/table/table-layout.js
       -> imports local table-view preferences from src/table/table-view-preferences.js
       -> imports table center DOM builders from src/ui/table-center-ui.js
       -> imports table manager draft helpers from src/table/table-manager-controller.js
       -> imports table manager DOM builders from src/ui/table-manager-ui.js
       -> imports shared dialog and DOM factories from src/ui/dialogs.js and src/ui/ui-dom.js
       -> imports collapsible player manual rendering from src/ui/guide.js
       -> imports chip riffle popover behavior from src/riffle/riffle.js
            -> imports sampled chip audio from src/riffle/riffle-sound.js

poker-game.js
  -> compatibility entrypoint that imports src/main.js
```

## Module Structure

The `src/` tree is organized by responsibility, not by extraction history:

- `src/core/`: pure poker/game calculations and data helpers. These modules should be the easiest to unit test and reuse from a future backend command validator.
- `src/game/`: DOM-free game workflow state transitions. These modules may compose `src/core/` helpers, but should not render UI or write Firebase.
- `src/room/`: room identity, permissions, room payload normalization, lobby/claim data transforms, and the Realtime Database room adapter.
- `src/ui/`: DOM builders and reusable UI shells. These modules receive prepared values and callbacks; they do not own room/game state.
- `src/table/`: visual table layout preferences and table-management draft logic.
- `src/riffle/`: optional chip-riffle interaction and sound. It must stay isolated from the hand flow.
- `src/services/`: third-party service initialization or very thin service wrappers.
- `src/main.js`: current composition root and legacy orchestrator. It still owns module-level app state, event wiring, and many workflows until those workflows are moved as complete responsibilities.

## Refactor Rules

Use these rules to avoid duplicate or overly fine-grained splits:

- Split by ownership sentence first. A new module should be explainable as "owns X state/flow/rendering", not "contains functions removed from `main.js`".
- Do not create a controller that only wraps another helper. If the old helper already owns the behavior, keep the caller in `main.js` until a complete workflow can move.
- Prefer a few complete workflow modules over many tiny orchestration files. A controller should own a user-visible flow such as hand lifecycle, settlement, room session, or seat identity.
- Keep pure logic small and separate when it has test value. `src/core/` modules may stay focused because they have no DOM/Firebase side effects.
- Keep UI modules callback-driven. They may create DOM, but should not decide permissions, mutate `players`, or write Firebase.
- Keep Firebase access in `src/room/room-sync.js` unless deliberately building a larger room-session workflow module.
- Passing explicit dependencies is good; passing a dozen unrelated callbacks is a smell. If that happens, either move a larger workflow together or leave the code in `main.js` for now.
- A file under about 40 lines needs a clear reason to exist, such as being pure, reused, or isolating a browser/service boundary.
- After directory moves or mechanical import edits, run syntax checks. After workflow moves, also run a targeted smoke script or stop for manual browser testing.

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

### `src/services/firebase.js`

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

### `src/room/room-sync.js`

Thin Realtime Database adapter for room-level network access:

- Room existence checks
- Full room reads and game-state reads
- Room listener setup
- Room-level transactions
- Member presence and join-request partial updates

Keep Firebase `ref/get/update/onValue/runTransaction` usage here instead of spreading low-level database calls across UI and game-flow code. Higher-level room/session orchestration now belongs in `src/room/room-session-flow.js`, while guarded in-hand state writes belong in `src/room/game-sync-flow.js`.

### `src/room/room-entry.js`

Owns room-entry and invitation helpers:

- Room id and invite-token normalization
- Random room id and invite-token generation
- Invite-link and URL search-parameter parsing helpers
- Local display-name persistence
- Join/reclaim request normalization

This module may touch browser storage and URL parsing, but it should not render DOM, write Firebase, or decide game permissions.

### `src/room/room-lobby-controller.js`

Owns DOM-free lobby-state helpers:

- Local-mode room data reset
- Host room data initialization
- Joined-room data initialization
- Setup/lobby game-state payload creation
- Room transaction payload construction for lobby sync

This module should receive dependencies explicitly through parameters, such as `createMembersMap`, `touchMemberWithProfile`, `canClientManageRoom`, `mergePlayerIdentityFields`, and normalizers. It should not read module-level app state, render DOM, start listeners, or call Firebase directly.

### `src/room/setup-lobby-flow.js`

Owns setup-page player editing and pregame lobby sync:

- Setup player row rendering
- Add/delete player interactions before game start
- Setup input enable/disable state based on host/cohost permissions
- Debounced lobby writes while still in `handStatus === "setup"`
- Player-id and setup-player creation for setup/table-manager callers

This is a workflow module. It receives `getState`, mutation callbacks, permission helpers, identity callbacks, and remote transaction helpers from `src/main.js`. It may render setup DOM and call the room transaction adapter passed to it, but it should not own the global app state or in-hand betting logic.

### `src/room/room-session-flow.js`

Owns the room lifecycle around the poker hand:

- Local/room mode switching
- Room creation without overwriting existing rooms
- Room joining and invite-link auto-join
- Invite-link copying
- Firebase room listener lifecycle
- Remote room reads and member presence writes

This module calls the thin Firebase adapter in `src/room/room-sync.js` and asks `src/main.js` to apply incoming room data through a callback. It should not decide betting, settlement, or hand-reset rules.

### `src/room/game-sync-flow.js`

Owns guarded in-hand remote writes:

- Local game-state snapshot creation before writing
- Merged vs guarded room transaction selection
- Conflict handling for hand id, hand status, state version, and custom remote guards
- Remote-hand-still-valid checks used before settlement/reset flows

This module composes `src/room/game-state-snapshot.js` and receives explicit state/dependency callbacks from `src/main.js`. It should stay focused on remote write semantics and not render UI beyond delegated status/refresh callbacks.

### `src/room/room-claims-controller.js`

Owns DOM-free player identity binding helpers:

- Current-device claim labels
- Local claim/release state transforms
- Claim-auth decision data
- Claim/release room transaction payloads
- Seat ownership request creation
- Seat request approval and decline transaction payloads
- Cohost grant/revoke transaction payloads

This module intentionally does not call Firebase, show dialogs, focus inputs, or refresh UI. Transaction helpers receive `currentRoom`, `room`, `clientId`, and dependencies such as `canClientManageRoom`, `inferHandStatus`, `getRoomHostId`, `normalizeRoomMode`, and `touchMember` through parameters, then return the next room payload or `undefined` to reject the transaction.

### `src/room/access-codes.js`

Owns legacy recovery-code helpers:

- Admin-code and player-code local-storage keys
- Remembered admin/player code persistence
- Admin/player code salts
- Admin/player code validation against stored hashes

The normal UX now uses invite-link + seat request approval, but these helpers remain for old rooms and recovery paths. Keep this module free of DOM rendering, Firebase writes, and room permission decisions.

### `src/room/room-state.js`

Owns DOM-free room/game-state payload helpers:

- Player payload normalization
- Side-pot payload normalization
- Winner-selection serialization and normalization
- Settlement-preview normalization

This module is intentionally about data shape only. It should not render UI, write Firebase, or decide permissions.

### `src/room/game-state-snapshot.js`

Owns DOM-free sync payload helpers:

- Game-state snapshot creation before remote writes
- Local room-data preparation before sync
- Current remote room + next local room payload merge
- Guarded write checks for hand id, hand status, state version, and optional remote guard callbacks

This module should receive dependencies explicitly through parameters, such as `normalizeRoomMode`, `getRoomHostId`, `normalizeAdminPlayerIds`, `normalizeJoinRequests`, `normalizeMembers`, and `mergePlayerIdentityFields`. It should not call Firebase, mutate app globals, render UI, or decide what user message should be shown after conflicts.

### `src/core/settlement-engine.js`

Owns DOM-free settlement calculations:

- Side-pot construction from player total commitments and folded state
- Adjacent side-pot merging when contenders are identical
- Winner plan creation from selected winners
- Split-pot payout calculation
- Settlement-preview and report-line construction

Keep this module pure and testable. It should not mutate `players`, show dialogs, render UI, or write Firebase.

### `src/room/room-permissions.js`

Owns DOM-free room permission helpers:

- Host lookup
- Admin/manager checks
- Room-manager proxy lookup for unclaimed seats
- Player-control checks
- Current-device player lookup helpers

`src/main.js` keeps thin wrappers because it still owns `clientId`, current `room`, remembered admin-code checks, and local fallback state.

### `src/room/approval-labels.js`

Owns shared synchronized-confirmation helpers:

- Settlement approver ids
- Next-hand approver ids
- Human-readable labels for approving players/devices
- Waiting and progress text for synchronized confirmation prompts

This module is DOM-free. It receives current state, identity lookup helpers, and label formatters from `src/main.js`, then feeds settlement, next-hand, and table-screen flows through one shared approval object.

### `src/ui/player-seat-ui.js`

Owns DOM builders for player seats around the visual poker table:

- Player capsule shell and state classes
- Seat coordinate CSS variables
- Position markers such as D, SB, BB, and D/SB
- Bet/status badges
- Seat detail popover
- Optional claim/reclaim button inside the popover

`src/main.js` still computes labels, permissions, active seat state, and claim callbacks. Keep this module focused on rendering the seat UI from prepared values.

### `src/core/player-model.js`

Owns DOM-free player data helpers:

- Player id generation
- Setup-player creation and normalization
- Display-name extraction
- Auto-generated seat-name detection
- Duplicate-name aware player labels

Keep this module about player object shape and labels. It should not decide room permissions, render player seats, write Firebase, or mutate the global `players` array.

### `src/ui/raise-ui.js`

Owns the Raise action panel DOM:

- Rule summary chips
- Preset raise targets
- Numeric raise target field
- Nudge buttons
- Live validation preview
- Confirm button text/disabled state

`src/main.js` still computes legal raise targets and supplies the validation callback. Keep betting rules in `src/core/game-rules.js` / `src/main.js`, not in this UI module.

### `src/core/approvals.js`

Owns DOM-free approval progress helpers used by room-mode settlement confirmation and next-hand readiness:

- Normalizes approval maps keyed by client id.
- Computes approved/required counts and completion state.
- Keep label rendering in `src/main.js`; this module should stay pure enough to reuse from a future backend command validator.

### `src/core/deal-prompts.js`

Owns DOM-free synchronized dealer prompt metadata:

- Opening hand prompt: deal two hole cards after blinds are posted.
- Flop / turn / river prompts.
- Incoming prompt normalization for Firebase room state.

The module intentionally does not decide who may confirm a prompt; that remains in room/identity flow code for now.

### `src/room/identity.js`

Owns the compatibility identity layer for the multiplayer-by-player roadmap:

- Persistent local `clientId` fallback in `localStorage`; `src/main.js` replaces it with Firebase Anonymous Auth `uid` when available
- Room modes: `local` and `room`
- Room host id normalization for legacy rooms and creator fallback
- Room member map normalization, claimed-player ids, display names, admin-session flags, and last-seen updates
- Optional `ownerClientId` normalization for player objects
- Access-code helpers kept for backward compatibility, but the primary UX is now invite-link + request approval
- Permission helper stubs such as `canClientControlPlayer()` and `isRoomHost()`

Important: this layer is still partly frontend-enforced. The app now uses Anonymous Auth when available, but complete malicious-client resistance depends on finishing Security Rules and moving critical game mutations behind Cloud Functions command processing. Unbound players (`ownerClientId === ""`) are controlled by the room manager proxy so rooms do not become stuck.

### `src/core/game-rules.js`

Owns pure, DOM-free poker table rules:

- Seat status labels and normalization
- Eligibility for the next hand
- Next eligible seat lookup
- Button / small blind / big blind / first-action layout, including heads-up handling
- Action eligibility
- Call amount
- Raise minimums, max target, pot-sized presets, and validation

Keep this module side-effect-free. It should be the first place to add unit tests for betting, all-in, side-pot-adjacent, and seat-rotation behavior.

### `src/core/hand-flow-controller.js`

Owns pure, DOM-free hand-flow transitions:

- Chip commitment calculation for a single player
- Check / call / raise / fold state changes
- Current-bet, last-raise-size, and pot updates
- Automatic hand-end decisions when everyone is all-in or only one player remains
- Betting-round completion checks
- Next actionable player and street max-bet lookup

Keep this module parameter-driven. It can import pure rule helpers from `src/core/game-rules.js`, but it should not read app globals, render DOM, write Firebase, show dialogs, or decide remote conflict behavior.

### `src/game/hand-controller.js`

Owns DOM-free hand lifecycle state transitions:

- Dealer normalization and next-hand dealer advancement
- Seat position labels for Dealer, small blind, big blind, heads-up, and inactive seats
- Opening-round reset, blind posting, and opening deal-prompt creation
- Later-street bet/acted reset and first actionable player lookup
- Next-hand base-state reset after settlement

This module composes `src/core/game-rules.js`, `src/core/deal-prompts.js`, and `src/core/hand-flow-controller.js`. It returns next state objects for `src/main.js` to apply. It should not show dialogs, write logs, render DOM, call Firebase, or decide remote conflict messages.

### `src/game/hand-play-flow.js`

Owns the in-hand betting and street progression workflow:

- Starting a betting street from `prepareRoundStartState()`
- Opening deal confirmation after blinds are posted
- Player Check / Call / Raise / Fold action handling
- Fold confirmation and remote turn/version guard checks
- Next-actionable-player selection and betting-round completion
- Street-end deal prompts and automatic hand-end routing to settlement callbacks

This workflow module composes pure helpers from `src/core/hand-flow-controller.js` and `src/game/hand-controller.js`. It receives state, mutations, UI callbacks, permission callbacks, and remote-sync callbacks from `src/main.js`; it should not become a global state store or own showdown/settlement payout logic.

### `src/game/settlement-controller.js`

Owns DOM-free settlement flow state transitions:

- Showdown state setup and side-pot creation
- Winner-selection toggling
- Settlement-plan validation and preview creation
- Cancel-preview state restoration back to showdown
- Final preview payout application
- Immediate remaining-pot award when only one player remains
- Zero-chip seated player transition to `busted`

This module composes `src/core/settlement-engine.js` and returns next state objects for `src/main.js` to apply. It should not show dialogs, render winner-selection DOM, write logs, call Firebase, or decide remote approval/conflict messages.

### `src/game/settlement-flow.js`

Owns the user-visible settlement workflow:

- Immediate remaining-pot award when everyone else folds
- Transition from betting to showdown
- Winner selection and settlement-plan validation
- Settlement preview creation and cancellation
- Room-mode all-required-player settlement confirmation
- Final payout application and busted-player log messages

This workflow composes `src/game/settlement-controller.js` and approval helpers, while receiving state, mutation, UI, approval, and remote-sync callbacks from `src/main.js`. Keep payout math in `src/core/settlement-engine.js`; keep this module focused on settlement workflow orchestration.

### `src/game/next-hand-flow.js`

Owns post-settlement next-hand readiness:

- Room-mode all-required-player next-hand approvals
- Guarded next-hand approval transactions
- Resetting state through `prepareNextHandResetState()`
- Clearing logs/actions/prompts and starting the next opening round
- Remote guard checks that prevent stale devices from starting a hand twice

This workflow receives state, mutation, UI, approval, and remote-sync callbacks from `src/main.js`. Keep dealer/blind reset mechanics in `src/game/hand-controller.js`; keep this module focused on the post-settlement confirmation and reset workflow.

### `src/ui/ui-dom.js`

Owns tiny shared DOM factories:

- `createParagraph()` for safe text-only paragraph creation
- `createButton()` for standard button creation with disabled/class/click wiring

Keep this module generic. It should not know about poker rules, room state, Firebase, or app-specific permission logic.

### `src/ui/dialogs.js`

Owns shared modal shells:

- App-level alert/confirm dialog replacements for browser `alert()` / `confirm()`
- Table action dialog shell used by raise, showdown, settlement, and similar focused actions

Business flows still live in `src/main.js`; this module only creates the reusable dialog frame and delegates content construction through callbacks.

### `src/table/table-layout.js`

Owns the visual seat-slot coordinates for the poker table:

- `TABLE_SEAT_LAYOUTS`: editable desktop/mobile seat points for 1-10 players
- `normalizeRotationOffset()`: pure rotation wraparound helper
- `getVisualSeatCoordinates()`: maps a player index to a visual slot, including local-only table rotation and "my player at bottom" anchoring

This is the preferred file for hand-tuning player label placement. Keep it DOM-free so layout experiments are easy to review and eventually test.

### `src/table/table-view-preferences.js`

Owns local-only table-view preferences:

- Local rotation storage key
- Rotation offset load/save helpers

These preferences are intentionally not written to Firebase. Each browser/device can rotate the visual table independently.

### `src/ui/table-center-ui.js`

Owns DOM builders for table-center UI:

- Center status shell with pot and hand meta
- Operation headers
- Animated waiting notices
- Showdown winner-selection dialog body
- Settlement-preview dialog body

`src/main.js` still decides which state is active, which actions are allowed, and what callbacks run. Keep this module UI-focused and callback-driven.

### `src/table/table-screen-controller.js`

Owns the poker-table screen composition:

- Player-seat rendering around the table
- Table-center status and operation slot
- Raise dialog entry and callback wiring
- Showdown winner-selection dialog entry
- Settlement-preview dialog entry
- Lightweight panel show/hide wrappers used by hand and settlement flows

It receives current state through `getState()` and grouped dependencies for modes, permissions, labels, betting helpers, approval helpers, and actions. Keep this module focused on rendering and UI event wiring. It should not mutate authoritative game state directly, write Firebase, or decide remote conflict behavior.

### `src/table/table-manager-controller.js`

Owns draft-state logic for the table management workflow:

- Creates the editable table draft from current players
- Normalizes draft players back into player payloads
- Adds, deletes, reorders, and returns seats
- Adjusts chip counts and seat status
- Builds the next-hand preview summary

It does not save to Firebase and does not render DOM. Persistence, permissions, and conflict guards live in `src/table/table-save-flow.js`.

### `src/table/table-manager-flow.js`

Owns the seat/identity management window workflow:

- Opens and closes the management modal
- Owns the transient table draft while the modal is open
- Renders identity summary, seat requests, and draft rows through `src/ui/table-manager-ui.js`
- Applies local draft edits before passing normalized players back to `src/main.js`
- Delegates authoritative save, room sync, admin toggles, and seat-claim actions through explicit callbacks

This module intentionally sits between `src/table/table-manager-controller.js` and `src/ui/table-manager-ui.js`. It may own UI-local draft state, but it should not become the global app state store and should not call Firebase directly.

### `src/table/table-save-flow.js`

Owns authoritative table-management persistence:

- Checks whether the current phase allows table edits
- Saves setup-stage table/player edits back into the lobby state
- Saves post-settlement table edits with remote hand/state guards
- Clears stale next-hand approvals after table edits
- Grants/revokes cohost status through guarded room transactions
- Prunes admin-player ids for deleted players

This module receives state, mutation, setup-lobby, UI, and remote-sync callbacks from `src/main.js`. Keep draft editing in `src/table/table-manager-controller.js` / `src/table/table-manager-flow.js`; keep this module focused on persistence and conflict handling.

### `src/ui/table-manager-ui.js`

Owns DOM builders for the seat and identity management panel:

- Panel header and footer
- Current identity summary
- Seat-request list
- Player rows with seat order, chip editing, seat status, and identity controls

`src/table/table-manager-flow.js` prepares the context, permission booleans, formatter functions, and mutation callbacks. This module should stay UI-focused and avoid direct Firebase writes or room-state ownership.

### `src/main.js`

Still orchestrates the app shell and authoritative browser state:

- Module-level game state
- Composition of flow/controllers and their callbacks

It now delegates setup/lobby editing to `src/room/setup-lobby-flow.js`, room lifecycle/listening to `src/room/room-session-flow.js`, guarded in-hand sync to `src/room/game-sync-flow.js`, shared approval labels to `src/room/approval-labels.js`, in-hand betting and street progression to `src/game/hand-play-flow.js`, settlement workflow to `src/game/settlement-flow.js`, next-hand readiness/reset to `src/game/next-hand-flow.js`, table-management persistence to `src/table/table-save-flow.js`, room database access to `src/room/room-sync.js`, room-entry helpers to `src/room/room-entry.js`, room lobby data helpers to `src/room/room-lobby-controller.js`, room claim/request helpers to `src/room/room-claims-controller.js`, legacy access-code helpers to `src/room/access-codes.js`, room payload normalization to `src/room/room-state.js`, sync snapshot helpers to `src/room/game-state-snapshot.js`, room permission checks to `src/room/room-permissions.js`, identity normalization to `src/room/identity.js`, player object helpers to `src/core/player-model.js`, approval progress to `src/core/approvals.js`, dealer prompt metadata to `src/core/deal-prompts.js`, betting action transitions to `src/core/hand-flow-controller.js`, hand lifecycle transitions to `src/game/hand-controller.js`, settlement flow transitions to `src/game/settlement-controller.js`, settlement calculations to `src/core/settlement-engine.js`, player-seat DOM rendering to `src/ui/player-seat-ui.js`, raise panel DOM rendering to `src/ui/raise-ui.js`, visual seat coordinates to `src/table/table-layout.js`, local table-view preferences to `src/table/table-view-preferences.js`, table-center DOM rendering to `src/ui/table-center-ui.js`, table-screen composition to `src/table/table-screen-controller.js`, table-manager workflow to `src/table/table-manager-flow.js`, table-manager draft logic to `src/table/table-manager-controller.js`, table-manager DOM rendering to `src/ui/table-manager-ui.js`, shared dialog shells to `src/ui/dialogs.js`, small DOM factories to `src/ui/ui-dom.js`, and core table/betting calculations to `src/core/game-rules.js`. There is still no separate state store, reducer, or test harness.

### `src/ui/guide.js`

Owns the generated player manual shown in collapsible panels on both the setup screen and game screen. It keeps usage guidance, beginner-friendly Texas Hold'em rules, and hand rankings in one structured source so the two UI placements stay synchronized.

### `poker-game.js`

Compatibility entrypoint only. It imports `./src/main.js`. Prefer changing `src/main.js` unless a legacy integration specifically loads `poker-game.js`.

### `assets/`

Contains generated site icon assets and sampled chip riffle audio:

- `assets/poker-chip-icon.png`: 512x512 app/brand icon
- `assets/favicon.png`: 64x64 favicon
- `assets/audio/riffle/*.mp3`: CC0 poker-chip samples from Kenney Casino Audio and BigSoundBank
- `assets/audio/riffle/LICENSES.md`: source and license notes for bundled audio

### `src/riffle/riffle.js` and `src/riffle/riffle-sound.js`

`src/riffle/riffle.js` owns the optional Chip Riffle popover opened from the header chip icon. It is intentionally isolated from the core game flow so the animation can run without blocking Firebase updates or normal hand actions.

Riffle behavior is modeled as real chip identity plus current stack order:

- `stackOrder` is the current single-stack order from bottom to top.
- Each split takes the current lower half as the left pile and the current upper half as the right pile.
- A successful riffle commits a deterministic interleave: `[left0, right0, left1, right1, ...]`.
- Chip colors and symbols are tied to chip identity (`data-chip-set`), not to the current left/right pile. This is important for dual-color skins: repeated riffles should visibly mix the piles instead of sorting chips back by color.
- The current 12-chip, 6/6 perfect riffle returns to the initial color grouping after 10 successful riffles.

The popover has a skin switcher. Skin selection is saved in `localStorage` under `pokerChipsRiffleSkin`; stack position is reset whenever the popover opens. Keep the existing skin id `mint-white` for local-storage compatibility even though the visible label is now orange/green.

Chip side decoration is CSS-only. The default/dual-color skins use repeated SVG crown marks; the orange/green skin uses a decorative letter `C`. These are embedded as CSS data URIs in `styles.css` so no extra assets or DOM nodes are required. Keep the crown/letter repeat aligned with the chip width: the 126px chip side currently uses two 63px pattern cells, yielding exactly two visible marks per chip.

`src/riffle/riffle-sound.js` owns the Web Audio sampler. It preloads only the MP3 files referenced by `SAMPLE_GROUPS`, decodes them after the first user gesture, and triggers short samples for split, riffle progress, reverse movement, scrape, and settle sounds. The current samples come from Kenney Casino Audio and BigSoundBank Poker Chips; source pages and licenses are documented in `assets/audio/riffle/LICENSES.md`. Keep audio assets small and mobile-safe; MP3 is used here for better Safari/iOS compatibility than OGG.

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
- Setup/lobby flow split into `src/room/setup-lobby-flow.js`
- Room lifecycle/listener flow split into `src/room/room-session-flow.js`
- Guarded in-hand sync flow split into `src/room/game-sync-flow.js`
- In-hand betting/street progression flow split into `src/game/hand-play-flow.js`
- Settlement workflow split into `src/game/settlement-flow.js`
- Next-hand readiness/reset flow split into `src/game/next-hand-flow.js`
- Table-management persistence split into `src/table/table-save-flow.js`
- Shared synchronized-confirmation labels split into `src/room/approval-labels.js`
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
- Extracted pure game/table rules in `src/core/game-rules.js`
- Compatibility identity layer in `src/room/identity.js` with `clientId`, `mode`, `hostClientId`, `members`, access-code compatibility helpers, admin-player ids, and player `ownerClientId`
- Frontend permission layer for room mode: host/cohost setup/table management, own-player actions, Dealer-only deal confirmation with manager proxy for unbound players
- Firebase CLI, Realtime Database rules, and Cloud Functions command-processing scaffold
- All-required-player confirmation for settlement preview and next-hand start
- Extracted pure hand-flow transitions in `src/core/hand-flow-controller.js`
- Extracted hand lifecycle state transitions in `src/game/hand-controller.js`
- Extracted settlement flow state transitions in `src/game/settlement-controller.js`

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
for f in $(find src functions -name "*.js" | sort); do node --check "$f" || exit 1; done
git diff --check
```

Browser validation checklist:

- Setup screen renders on desktop and mobile.
- Setup mode switch can move between local mode and room mode before a hand starts.
- Creating a room writes a setup room, generates an invite link, and copies/shows it from the room controls.
- Joining from an invite URL fills the room id automatically and loads setup players when the remote room is still in setup.
- A non-host device can enter a display name and request a seat; it is not bound until host/cohost approval.
- A device that joins an in-progress room can set or edit its display name from "席位与身份管理" before requesting a seat.
- If a room client without a display name clicks request/reclaim, a custom display-name dialog appears and the request continues after saving.
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
- Keep game-rule changes small, prefer pure helpers in `src/core/game-rules.js`, and manually test several betting flows.
- If changing player object shape, update:
  - local creation
  - `normalizeIncomingPlayer()`
  - `createTableDraft()` / `normalizeDraftPlayer()`
  - Firebase write/read paths
  - `updatePlayerBoxes()`
- If changing room identity shape, update `src/room/identity.js`, `room` defaults, `applyRoomData()`, `updateFirebaseState()`, and docs together.
- If changing side-pot behavior, add manual test notes or automated tests first.
- If changing Firebase sync, keep guarded writes around action/settlement/reset flows.
- Avoid adding a framework unless the user asks for a larger refactor.
- Keep generated/browser test artifacts out of git. `.playwright-cli/` is ignored.

## Suggested Next Steps

1. Move `playerAction`, deal confirmation, settlement preview confirmation, table saves, and next-hand approval to command writes processed by Cloud Functions.
2. Tighten `database.rules.json` after command coverage so clients cannot directly write `players` or `gameState`.
3. Enable Firebase Anonymous Auth, App Check, API key restrictions, and budget alerts in the Firebase console.
4. Add unit tests for `src/core/game-rules.js`, `src/room/identity.js`, and the Cloud Functions command validator.
5. Consider room lifecycle controls: leave room, reset room, archive hand log.
