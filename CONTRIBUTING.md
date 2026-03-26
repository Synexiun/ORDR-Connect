# Contributing to ORDR-Connect

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker & Docker Compose
- Git (with GPG/SSH commit signing)

## Development Setup

```bash
git clone git@github.com:Synexiun/ORDR-Connect.git
cd ORDR-Connect
make setup
```

## Branch Strategy

1. Create a branch from `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature
   ```

2. Branch prefixes:
   - `feat/` — New features
   - `fix/` — Bug fixes
   - `security/` — Security patches
   - `compliance/` — Compliance updates

3. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(auth): add MFA enforcement for admin endpoints
   fix(audit): correct Merkle tree hash chain on batch boundary
   security(crypto): rotate to AES-256-GCM-SIV for field encryption
   ```

## Pull Request Requirements

Every PR must pass **all 10 compliance gates** before merge:

1. Static analysis (no critical/high findings)
2. Dependency scan (no known critical/high CVEs)
3. Secret scan (zero secrets detected)
4. Type safety (TypeScript strict, no `any` in security paths)
5. Test coverage (80%+ lines, 100% on auth/audit/encryption)
6. Audit log check (all state-changing endpoints have audit events)
7. Access control check (all endpoints have authorization)
8. PHI check (no PHI in logs, errors, or client responses)
9. Encryption check (all RESTRICTED data encrypted before storage)
10. Peer review (1 reviewer standard, 2 for security-sensitive)

## Code Standards

- TypeScript strict mode — no exceptions
- No `any` types in security-sensitive code
- Parameterized queries only (Drizzle ORM)
- All secrets via external vault — never in code
- Every state change must emit an audit event
- Tenant isolation enforced server-side on every operation

## Testing

```bash
make test              # All unit tests
make test-coverage     # With coverage report
make security-scan     # Dependency audit + secret scan
```

Write tests for:
- Every new endpoint (auth + RBAC assertions)
- Every state-changing operation (audit log assertions)
- Every encryption/decryption path (100% coverage required)
