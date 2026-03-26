# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in ORDR-Connect, **do not open a public issue**.

Email: **security@synexiun.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge within **24 hours** and provide a resolution timeline within **72 hours**.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x.x (current) | Yes |

## Compliance Standards

This project enforces:
- **SOC 2 Type II** — Trust Services Criteria
- **ISO 27001:2022** — Information Security Management
- **HIPAA** — Health Insurance Portability and Accountability Act

## Security Controls

- All dependencies scanned on every PR (Snyk/Dependabot)
- Secret scanning via gitleaks (pre-commit + CI)
- Static analysis via Semgrep and ESLint security rules
- Container scanning for CVEs
- Annual third-party penetration testing
