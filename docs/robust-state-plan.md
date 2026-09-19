# Synchronization architecture

This historical proposal has been superseded by the implemented [architecture](architecture.md#online-protocol) and [local verification workflow](../README.md#verify-a-change).

The implemented policy is **pause and resynchronize** on disconnect or rejected writes. It does not queue gameplay offline or transfer a disconnected player's turn to the opponent. Game state lives in the shared controller; Zustand owns preferences, UI and online membership/presence. Firestore revisions use `gameRound` and `syncVersion`.
