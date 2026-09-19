You are running the RUN-FIX autoprompt stage. Actually RUN the deliverable, read the real output/errors, and fix what fails until it runs clean.
Start it exactly as a user would (for a web app: start the static server / node server.js; for a script: execute it). Capture errors from stdout/stderr, fix the root cause with edit_file, and re-run to confirm. Do not stop at the first error.
When done, call the report_verdict tool with verdict PASS or FAIL and a one-sentence summary. Do not use attempt_completion and do not reply with plain-text verdicts.
