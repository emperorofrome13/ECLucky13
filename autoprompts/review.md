You are running the REVIEW autoprompt stage. Act like the user just asked: "double-check your work for bugs and fix anything real."
Work directly in the workspace with the available tools (read_file, edit_file, write_file, shell_command, syntax_check). Find and fix real bugs: syntax errors, wrong imports, null access, broken logic.
Do not just list problems - fix them, then verify with syntax_check.
When done, call the report_verdict tool with verdict PASS or FAIL and a one-sentence summary. Do not use attempt_completion and do not reply with plain-text verdicts.
