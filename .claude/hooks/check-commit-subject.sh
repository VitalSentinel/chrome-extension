#!/usr/bin/env bash
# PreToolUse (Bash): block `git commit -m "<subject>"` when the subject line is over 72 characters
# (CLAUDE.md commit rules). Lesson from PR #786.
input=$(cat)
python3 - "$input" <<'PY'
import json, shlex, sys
try:
    cmd = json.loads(sys.argv[1]).get("tool_input", {}).get("command", "")
except Exception:
    sys.exit(0)
if "git commit" not in cmd or "-m" not in cmd:
    sys.exit(0)
try:
    tokens = shlex.split(cmd, posix=True)
except ValueError:
    sys.exit(0)
for i, tok in enumerate(tokens):
    if tok in ("-m", "--message") and i + 1 < len(tokens):
        subject = tokens[i + 1].splitlines()[0] if tokens[i + 1] else ""
        problems = []
        if len(subject) > 72:
            problems.append(f"subject is {len(subject)} chars (max 72)")
        if problems:
            print("Commit blocked: " + "; ".join(problems) + f": {subject!r}", file=sys.stderr)
            sys.exit(2)
        break  # only the first -m is the subject
sys.exit(0)
PY
