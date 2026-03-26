---
name: metrics
description: Show quality and learning metrics with trend sparklines
user_invocable: true
---

Show NEXUS metrics:

```bash
python .claude/nexus/nexus.py metrics
```

If no metrics data exists yet, explain that metrics accumulate over sessions. Show what data is available from:
```bash
python .claude/nexus/nexus.py query "SELECT COUNT(*) as sessions FROM sessions WHERE status='completed'"
```
