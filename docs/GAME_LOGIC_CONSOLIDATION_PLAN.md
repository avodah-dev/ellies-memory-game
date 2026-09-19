> Historical proposal. See [the current architecture](architecture.md) for implemented ownership and testing boundaries. The duplicate hooks/store described below no longer represent the current app.

# Game Logic Consolidation Plan

## Problem Statement

The codebase has **three implementations of the same game logic**:
- `GameEngine.ts` (492 lines) - Pure functions that are **NOT USED**
- `useMemoryGame.ts` (1110 lines) - Local mode hook that reimplements everything
- `useOnlineGame.ts` (629 lines) - Online mode hook that reimplements everything again

This results in ~300+ lines of duplicated logic, inconsistent behavior risks, and maintenance burden.

## Goals

1. **Single source of truth** for all game rules in `GameEngine.ts`
2. **Unified hook** that works for both local and online modes
3. **Clean separation** of game state vs animation state vs side effects
4. **Testable architecture** with unit tests for game logic
5. **Consistent behavior** whether playing locally or online

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         App.tsx                              │
│              (UI, setup flow, components)                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   useGameController.ts                       │
│     Single hook for both local and online modes              │
│     - Manages React state                                    │
│     - Coordinates animation timing                           │
│     - Dispatches side effects                                │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   GameEngine    │  │  EffectManager  │  │   SyncAdapter   │
│   (Pure Logic)  │  │   (TTS, etc.)   │  │   (Firestore)   │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Current State Analysis

### Duplication Inventory

| Pattern | useMemoryGame.ts | useOnlineGame.ts | GameEngine.ts |
|---------|------------------|------------------|---------------|
| `sortPlayersByID` helper | Lines 6-8 (local copy) | Lines 16-18 (local copy) | ✅ Exists (unused) |
| `checkForMatch` function | Lines 473-699 (**226 lines**) | Lines 258-452 (**194 lines**) | ✅ Exists (unused) |
| `flipCard` logic | Lines 839-929 (90 lines) | Lines 185-255 (70 lines) | ✅ Exists (unused) |
| `endTurn` logic | Lines 701-789 (88 lines) | Lines 472-516 (44 lines) | ✅ Exists (unused) |
| Winner calculation | Inline | Inline | ✅ Exists (unused) |

### Key Issues

1. **GameEngine is ignored** - Both hooks reimplement all logic instead of importing
2. **Animation state mixed with game state** - `isFlyingToPlayer`, `flyingToPlayerId` in Card interface
3. **TTS embedded in game logic** - Side effects tightly coupled
4. **Stuck detection only online** - Local mode lacks this safety feature
5. **Complex App.tsx glue code** - Conditional switching between hooks

---

## Implementation Plan

### Phase 1: Extend GameEngine with Animation Support
- [ ] **Status:** Not Started

**File:** `src/services/game/GameEngine.ts`

Add animation-aware functions that the hooks currently implement inline:

```typescript
// New functions to add:
export function startMatchAnimation(state, cardIds, playerId): GameState
export function completeMatchAnimation(state, cardIds): GameState
export function applyNoMatchWithReset(state, cardIds): GameState
```

**Why:** The current `applyMatch()` goes directly to `isMatched: true`, but UI needs a 2-phase animation (flying → matched). These functions support that flow while keeping logic pure.

**Tests to add:**
- `GameEngine.test.ts` - Unit tests for all pure functions

**Estimated effort:** 3-4 hours

---

### Phase 2: Create Effect Manager
- [ ] **Status:** Not Started

**New file:** `src/services/effects/EffectManager.ts`

```typescript
export interface GameEffect {
  onMatchFound?(playerName: string): void;
  onNoMatch?(): void;
  onTurnChange?(playerName: string): void;
  onGameOver?(winner: Player | null, isTie: boolean): void;
}

export class EffectManager {
  private effects: GameEffect[] = [];
  register(effect: GameEffect): () => void;
  notifyMatchFound(playerName: string): void;
  notifyTurnChange(playerName: string): void;
  notifyGameOver(winner: Player | null, isTie: boolean): void;
}
```

**New file:** `src/services/effects/TTSEffect.ts`

```typescript
export function createTTSEffect(ttsHook): GameEffect {
  return {
    onMatchFound: (name) => ttsHook.speakMatchFound(name),
    onTurnChange: (name) => ttsHook.speakPlayerTurn(name),
  };
}
```

**Why:** Extracts TTS and other side effects from game logic. Effects become pluggable - easy to add sounds, analytics, etc.

**Estimated effort:** 1-2 hours

---

### Phase 3: Create Unified Game Controller Hook
- [ ] **Status:** Not Started

**New file:** `src/hooks/useGameController.ts`

```typescript
interface UseGameControllerOptions {
  mode: 'local' | 'online';
  flipDuration: number;

  // Online mode options
  syncAdapter?: ISyncAdapter;
  localPlayerSlot?: number;
  roomCode?: string;

  // Effects
  effectManager?: EffectManager;
}

interface GameControllerReturn {
  // State
  gameState: GameState;
  isAnimating: boolean;
  isAuthoritative: boolean;

  // Actions
  flipCard: (cardId: string) => void;
  endTurn: () => void;
  resetGame: () => void;
  setFullGameState: (state: GameState) => void;
  updatePlayerName: (playerId: number, name: string) => void;
  updatePlayerColor: (playerId: number, color: string) => void;

  // Settings (moved from old hooks)
  settings: GameSettings;
  updateSettings: (settings: Partial<GameSettings>) => void;
}
```

**Key responsibilities:**
1. **Authority checking** (online): Only current player can make moves
2. **Animation orchestration**: Manages 2-phase match animation timing
3. **State sync** (online): Syncs to Firestore after state changes
4. **Effect dispatch**: Calls EffectManager for TTS, etc.
5. **Stuck detection**: Monitors for stuck cards in both modes

**Internal flow for `flipCard`:**
```
flipCard(cardId)
  │
  ├─ If online && not authoritative → return (not your turn)
  │
  ├─ canFlipCard(state, cardId) → validate
  │
  ├─ GameEngine.flipCard(state, cardId) → new state
  │
  ├─ If 2 cards selected:
  │   ├─ Schedule match check after flipDuration
  │   └─ Set isCheckingMatch = true
  │
  ├─ If online: syncAdapter.setState(newState)
  │
  └─ Update React state
```

**Estimated effort:** 4-6 hours

---

### Phase 4: Update App.tsx
- [ ] **Status:** Not Started

**File:** `src/App.tsx`

Replace conditional hook switching:

```typescript
// BEFORE (complex conditional logic):
const isOnlineMode = gameMode === 'online' && roomCode && localPlayerSlot !== null;
const gameState = isOnlineMode ? onlineGame.gameState : localGame.gameState;
const flipCard = isOnlineMode ? onlineGame.flipCard : localGame.flipCard;
// ... repeated for every function

// AFTER (single unified hook):
const game = useGameController({
  mode: gameMode === 'online' ? 'online' : 'local',
  flipDuration,
  syncAdapter: gameMode === 'online' ? firestoreSyncAdapter : undefined,
  localPlayerSlot,
  roomCode,
  effectManager,
});
// Just use game.gameState, game.flipCard everywhere
```

**Estimated effort:** 2-3 hours

---

### Phase 5: Cleanup and Delete Old Code
- [ ] **Status:** Not Started

**Delete:**
- `src/hooks/useMemoryGame.ts` (1110 lines)
- `src/hooks/useOnlineGame.ts` (629 lines)
- `src/hooks/useOnlineGameSync.ts` (appears unused)

**Keep:**
- `src/services/game/GameEngine.ts` (enhanced)
- `src/services/sync/FirestoreSyncAdapter.ts` (unchanged)
- `src/stores/gameStore.ts` (may integrate later)

**Estimated effort:** 1 hour

---

## New File Structure

```
src/
├── services/
│   ├── game/
│   │   ├── GameEngine.ts          # Enhanced with animation functions
│   │   ├── GameEngine.test.ts     # NEW: Unit tests
│   │   └── index.ts
│   │
│   ├── effects/
│   │   ├── EffectManager.ts       # NEW: Side effect coordination
│   │   ├── TTSEffect.ts           # NEW: TTS as pluggable effect
│   │   └── index.ts
│   │
│   └── sync/
│       ├── FirestoreSyncAdapter.ts  # Unchanged
│       └── ...
│
├── hooks/
│   ├── useGameController.ts       # NEW: Unified hook
│   ├── useTextToSpeech.ts         # Keep as-is
│   └── ...other hooks unchanged
│
└── types.ts                        # May add AnimationState type
```

---

## Testing Strategy

### Unit Tests for GameEngine

**File:** `src/services/game/GameEngine.test.ts`

```typescript
describe('GameEngine', () => {
  describe('canFlipCard', () => {
    it('returns false if game not playing');
    it('returns false if 2 cards already selected');
    it('returns false if card already flipped');
    it('returns false if card already matched');
    it('returns true for valid flip');
  });

  describe('flipCard', () => {
    it('flips the specified card');
    it('adds card to selectedCards');
    it('returns unchanged state if invalid');
  });

  describe('checkMatch', () => {
    it('returns null if less than 2 cards selected');
    it('returns isMatch: true for matching imageIds');
    it('returns isMatch: false for different imageIds');
  });

  describe('startMatchAnimation', () => {
    it('sets isFlyingToPlayer on matched cards');
    it('increments player score');
    it('clears selectedCards');
  });

  describe('completeMatchAnimation', () => {
    it('sets isMatched on cards');
    it('clears isFlyingToPlayer');
  });

  describe('checkAndFinishGame', () => {
    it('returns unchanged if not all matched');
    it('sets gameStatus to finished');
    it('calculates winner correctly');
    it('detects tie correctly');
  });
});
```

### Integration Tests (Manual Checklist)

**Local Mode:**
- [ ] Flip two matching cards → animation plays → score updates → same player continues
- [ ] Flip two non-matching cards → flip back → turn switches
- [ ] End Turn button works
- [ ] Game completion → winner/tie detected
- [ ] TTS announces matches and turns (when enabled)
- [ ] Reset game works

**Online Mode:**
- [ ] Create room → join room
- [ ] Host starts game
- [ ] Can only flip cards on your turn
- [ ] Opponent sees your moves in real-time
- [ ] Match/no-match syncs correctly
- [ ] Game completion syncs
- [ ] Disconnect detection works

---

## Estimated Total Effort

| Phase | Description | Estimate |
|-------|-------------|----------|
| 1 | Extend GameEngine + tests | 3-4 hours |
| 2 | Create EffectManager | 1-2 hours |
| 3 | Create useGameController | 4-6 hours |
| 4 | Update App.tsx | 2-3 hours |
| 5 | Cleanup old code | 1 hour |
| **Total** | | **11-16 hours** |

---

## Critical Files to Read Before Implementation

1. **`src/services/game/GameEngine.ts`** - Understand existing pure functions
2. **`src/hooks/useMemoryGame.ts`** - Understand local mode patterns, especially `checkForMatch` (lines 473-699)
3. **`src/hooks/useOnlineGame.ts`** - Understand authority pattern and sync logic
4. **`src/services/sync/FirestoreSyncAdapter.ts`** - Understand sync interface
5. **`src/types.ts`** - Understand Card, Player, GameState types
6. **`src/App.tsx`** - Understand how hooks are consumed

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking online sync | Keep sync adapter interface unchanged; test with two browser windows |
| Animation timing regression | Keep exact timing constants (3000ms match animation, flipDuration) |
| Authority bugs | Comprehensive tests for turn enforcement |
| TTS stops working | EffectManager allows easy rollback to inline calls |

---

## Success Criteria

- [ ] All game logic lives in `GameEngine.ts`
- [ ] Single `useGameController` hook for both modes
- [ ] No duplicate game logic across files
- [ ] Unit tests pass for GameEngine
- [ ] Manual testing passes for both local and online modes
- [ ] ~1500 lines of code reduced to ~800 lines
- [ ] TTS works as before
- [ ] Online sync works as before

---

## Progress Log

| Date | Phase | Status | Notes |
|------|-------|--------|-------|
| | | | |

