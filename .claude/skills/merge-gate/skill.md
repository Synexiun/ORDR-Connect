---
name: merge-gate
description: Run pre-merge quality gate checks including tests, lint, security scan, and architecture freeze verification
user_invocable: true
---

Run the NEXUS merge gate:

1. Run integrity checks:
```bash
python .claude/nexus/nexus.py heal
```

2. Verify audit chain:
```bash
python .claude/nexus/nexus.py audit
```

3. Check for open critical/high risks:
```bash
python .claude/nexus/nexus.py query "SELECT title, severity, category FROM risks WHERE status='open' AND severity IN ('critical','high')"
```

4. Check for architecture freeze violations in changed files:
```bash
python .claude/nexus/nexus.py query "SELECT component, reason, override_requires FROM architecture_freeze"
```

5. Report gate status:
   - PASS: All checks green, no critical risks, no freeze violations
   - WARN: Minor issues that should be addressed
   - BLOCK: Critical issues that must be resolved before merge
