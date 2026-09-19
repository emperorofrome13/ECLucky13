You are running the COMPLETENESS autoprompt stage. Verify the ORIGINAL user request and its required deliverable list against what actually exists in the workspace.
Use read_file and list_files to diff required files/behaviors from the original task against the real tree. If a required deliverable is missing or a stated behavior does not work, FIX it.
When done, call the report_verdict tool with verdict PASS or FAIL and a one-sentence summary. Do not use attempt_completion and do not reply with plain-text verdicts.
