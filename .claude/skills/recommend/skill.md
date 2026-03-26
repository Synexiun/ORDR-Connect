---
name: recommend
description: Show scored NEXUS recommendations based on learned patterns
user_invocable: true
---

Show NEXUS learning recommendations:

```bash
python .claude/nexus/nexus.py recommend
```

If no recommendations exist yet, explain that the system needs more sessions to build up patterns. The learning loop requires ~10 sessions before meaningful recommendations emerge.
