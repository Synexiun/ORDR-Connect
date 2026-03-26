---
name: reconcile
description: Reconcile NEXUS state files with database truth, fixing any drift
user_invocable: true
---

Reconcile state files with database:

1. Run healing to detect drift:
```bash
python .claude/nexus/nexus.py heal
```

2. Regenerate all state files from current DB state:
```bash
python .claude/nexus/nexus.py load
```

3. Verify the reconciliation:
```bash
python .claude/nexus/nexus.py status
```

Report what was out of sync and what was fixed.
