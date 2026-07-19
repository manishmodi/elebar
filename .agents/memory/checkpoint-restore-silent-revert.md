---
name: Checkpoint restore can silently revert shipped features
description: How to detect and recover a feature wiped by a "Restored to ..." rollback commit
---

A Replit checkpoint restore appears in git history as a commit titled `Restored to '<sha>'`. It rewinds the project to an earlier state, which can **silently erase an already-shipped feature** that landed after that earlier point. The reverted code is not "overwritten by new code" — it simply ceases to exist in the working tree, so grepping the current files turns up nothing.

**Why:** A user reported the Yango daily-logs sync had lost its background-job + live progress bar. The feature commit (`Move Yango Daily-Logs preview to a background job`) was followed in history by a `Restored to '...'` rollback to a point *before* it, wiping it. Auto-generated checkpoint commit messages can also be misleading (one claimed to "restore" the feature while the code was still the reverted version) — always verify against the actual files, not the commit message.

**How to apply:**
- To diagnose "was feature X reverted?": `git log --oneline -- <file>` and look for a `Restored to '...'` commit *after* the feature commit. `git log -S "<unique string>" --oneline -- <file>` shows when a marker was added/removed.
- To recover without clobbering unrelated newer work: first confirm the target files haven't diverged since the rollback — `git diff <featureCommit>^ -- <file>` should be empty (current == feature's parent). If empty, restore each file with read-only `git show <featureCommit>:<path> > <path>` (avoids the destructive `git checkout`). Don't forget new files the feature added.
- After restoring server+client files, restart the affected workflows and confirm a clean boot before republishing.
