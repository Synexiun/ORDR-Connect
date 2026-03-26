---
name: audit
description: Verify the NEXUS SHA-256 hash chain integrity and show chain statistics
user_invocable: true
---

Verify the audit chain:

```bash
python .claude/nexus/nexus.py audit
```

Then show chain statistics:
```bash
python .claude/nexus/nexus.py query "SELECT event_type, COUNT(*) as count FROM audit_chain GROUP BY event_type ORDER BY count DESC"
```

Report the chain status and event distribution.
