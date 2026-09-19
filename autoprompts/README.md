# EC11 Autoprompts

Editable prompt files. EC11 reads these at runtime — change them and the next run uses the new text (no rebuild needed).

- `system.md` — the main agent system prompt.
- `review.md` — the Review stage.
- `completeness.md` — the Completeness stage.
- `senior_review.md` — the Senior Review stage.
- `run_fix.md` — the Run / Fix stage.

## Overrides
- Edit the files here for a global change.
- For a single project, put overrides in `<working-folder>/.ec12/autoprompts/<name>.md` — those win over these.

## Editing
Use the Prompts panel in the UI (rail → prompts), or edit the `.md` files directly.
Keep the `VERDICT: PASS or FAIL` / `SUMMARY: ...` instruction lines in stage prompts — the pipeline parses them to decide pass/fail.

