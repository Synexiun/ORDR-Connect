---
name: heal
description: Run all 12 NEXUS integrity checks and auto-repair what can be fixed
user_invocable: true
---

Run the NEXUS self-healing system:

```bash
python .claude/nexus/nexus.py heal
```

Review the output. If any checks failed and couldn't be auto-repaired, explain the issue and suggest manual remediation steps.
