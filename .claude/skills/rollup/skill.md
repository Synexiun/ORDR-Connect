---
name: rollup
description: Generate a golden rollup summary of recent sessions and their learnings
user_invocable: true
---

Generate a rollup of recent sessions:

1. Query the last 5 completed sessions from nexus.db:
```bash
python .claude/nexus/nexus.py query "SELECT id, started_at, ended_at, summary, learnings, files_touched, actions_count FROM sessions WHERE status='completed' ORDER BY ended_at DESC LIMIT 5"
```

2. Query active patterns:
```bash
python .claude/nexus/nexus.py query "SELECT description, status, confidence, evidence_count FROM patterns WHERE status != 'deprecated' ORDER BY confidence DESC LIMIT 10"
```

3. Synthesize a concise rollup summarizing:
   - What was accomplished across sessions
   - Key patterns learned
   - Current system confidence level

4. Write the rollup to `.claude/state/golden_rollups.md`
