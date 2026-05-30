# Trạm Đọc — Claude Working Guide

This file intentionally mirrors the project agent rules in `AGENTS.md`.

Claude Code and Claude-compatible agent sessions working in this repository must read and follow:

- `AGENTS.md` — primary project guide, stack, verification commands, and Trạm PT-derived working principles.
- `CODEX_HANDOFF_EPUB_TTS.md` — current EPUB parser/TTS hardening handoff when touching EPUB parsing, TTS routes, audio cache, or iOS audio integration.

Key operating rules:

- Vietnamese-first UX.
- Verify live files and behavior before acting.
- Keep changes small, safe, and reviewable.
- Preserve unrelated dirty files from other lanes.
- For EPUB/TTS work, verify with `npm run typecheck`, `npm run smoke:epub`, and `npm test` from `server/`.
- Ask before destructive DB/file cleanup, mass audio regeneration, production deploys, broad rewrites, or risky schema migrations.
