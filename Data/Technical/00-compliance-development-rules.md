# Compliance Development Rules — The Immutable Gate

> **This document is the law.** Every function, every endpoint, every deployment, every AI agent action in ORDR-Connect must satisfy every applicable control below. Violations are P0 incidents.

---

## 1. Control Framework Mapping

### SOC 2 Type II — Trust Services Criteria

| Control ID | Category | Requirement | Implementation |
|-----------|----------|-------------|----------------|
| CC1.1 | Control Environment | Board/management oversight of security | Security review board (quarterly), documented security policies |
| CC1.2 | Control Environment | Accountability for internal controls | Named owners for every security control, audit trail |
| CC2.1 | Communication | Internal security communication | Security channels, incident runbooks, training records |
| CC3.1 | Risk Assessment | Risk identification process | STRIDE threat modeling per component, risk register |
| CC3.2 | Risk Assessment | Fraud risk assessment | Agent behavior monitoring, anomaly detection |
| CC3.4 | Risk Assessment | Change impact assessment | Change management records, rollback plans |
| CC4.1 | Monitoring | Ongoing security monitoring | Grafana dashboards, automated alerting, log analysis |
| CC5.1 | Control Activities | Logical access controls | RBAC + ABAC + ReBAC, RLS, mTLS |
| CC5.2 | Control Activities | Access provisioning/deprovisioning | WorkOS SCIM, automated onboarding/offboarding |
| CC5.3 | Control Activities | Change management | PR gates, peer review, staging validation |
| CC6.1 | Logical Access | Security software/infra/architecture | Zero-trust, defense in depth, network segmentation |
| CC6.2 | Logical Access | User registration/authorization | OAuth 2.1 + PKCE, MFA mandatory |
| CC6.3 | Logical Access | Internal/external access restrictions | VPN, bastion hosts, IP allowlisting for admin |
| CC6.6 | Logical Access | Threat management | WAF, DDoS protection, rate limiting, IDS/IPS |
| CC6.7 | Logical Access | Transmission security | TLS 1.3, mTLS between services |
| CC6.8 | Logical Access | Unauthorized/malicious software prevention | Dependency scanning, SBOM, image scanning |
| CC7.1 | System Operations | Detection of anomalies | Real-time monitoring, ML-based anomaly detection |
| CC7.2 | System Operations | Incident response | Documented runbook, tested quarterly, 15-min P0 response |
| CC7.3 | System Operations | Recovery from incidents | Automated failover, backup restoration, RTO/RPO targets |
| CC7.4 | System Operations | Incident communication | Stakeholder notification workflow, status page |
| CC8.1 | Change Management | Change authorization | PR approval gates, compliance checks |
| CC9.1 | Risk Mitigation | Risk mitigation activities | Compensating controls, defense in depth |
| A1.1 | Availability | Capacity management | Auto-scaling, resource quotas, load testing |
| A1.2 | Availability | Environmental protections | Multi-AZ deployment, disaster recovery |
| PI1.1 | Processing Integrity | Data processing accuracy | Input validation, schema enforcement, idempotency |
| C1.1 | Confidentiality | Classification/protection | 4-tier data classification, encryption per tier |
| C1.2 | Confidentiality | Confidential information disposal | Crypto-shredding, secure deletion |
| P1.1 | Privacy | Privacy notice | Transparent data collection, consent management |

### ISO 27001:2022 — Annex A Control Mapping

| Control | Area | Requirement | Code-Level Implementation |
|---------|------|-------------|--------------------------|
| A.5.1 | Organizational | Information security policies | CLAUDE.md (this enforcement), security/policies/ |
| A.5.2 | Organizational | Roles and responsibilities | RBAC definitions in packages/auth/, owner mappings |
| A.5.7 | Organizational | Threat intelligence | Dependency scanning feeds, CVE monitoring |
| A.5.23 | Organizational | Cloud services security | Terraform modules with security baselines |
| A.5.29 | Organizational | Information security during disruption | Failover procedures, chaos testing |
| A.5.30 | Organizational | ICT readiness for business continuity | Multi-region deployment, automated recovery |
| A.6.1 | People | Screening | Background checks (HR process, documented) |
| A.6.3 | People | Security awareness training | Quarterly training, phishing simulation |
| A.7.1 | Physical | Physical security perimeters | Cloud provider certifications (SOC 2/ISO of AWS/GCP) |
| A.8.1 | Technological | User endpoint devices | MDM required for production access |
| A.8.2 | Technological | Privileged access rights | JIT access, time-limited, fully audited |
| A.8.3 | Technological | Information access restriction | RLS, field-level encryption, ABAC policies |
| A.8.4 | Technological | Access to source code | Branch protection, signed commits, code owners |
| A.8.5 | Technological | Secure authentication | Argon2id, MFA, OAuth 2.1, PKCE |
| A.8.7 | Technological | Protection against malware | Image scanning, SAST, DAST, SCA |
| A.8.8 | Technological | Management of technical vulnerabilities | SLA: Critical=48hr, High=7d, Medium=30d, Low=90d |
| A.8.9 | Technological | Configuration management | IaC, immutable infrastructure, drift detection |
| A.8.10 | Technological | Information deletion | Crypto-shredding for tenant offboarding, GDPR erasure |
| A.8.11 | Technological | Data masking | Non-production data anonymization, PHI tokenization |
| A.8.12 | Technological | Data leakage prevention | DLP rules, egress filtering, secret scanning |
| A.8.15 | Technological | Logging | WORM audit logs, Merkle tree verification |
| A.8.16 | Technological | Monitoring activities | Real-time dashboards, automated alerts |
| A.8.20 | Technological | Networks security | NetworkPolicies, service mesh, zero-trust |
| A.8.21 | Technological | Security of network services | WAF, API gateway rate limiting, DDoS protection |
| A.8.24 | Technological | Use of cryptography | AES-256-GCM, TLS 1.3, post-quantum readiness |
| A.8.25 | Technological | Secure development lifecycle | Compliance gates in CI/CD, security testing |
| A.8.26 | Technological | Application security requirements | OWASP Top 10 prevention, input validation |
| A.8.27 | Technological | Secure system architecture | Defense in depth, minimal attack surface |
| A.8.28 | Technological | Secure coding | Linting, SAST, peer review, banned function list |
| A.8.31 | Technological | Separation of environments | Dedicated environments, no PHI in dev/staging |
| A.8.33 | Technological | Test information | Synthetic data generation, no production data copies |
| A.8.34 | Technological | Protection during audit testing | Isolated audit environments, read-only access |

### HIPAA Technical Safeguards — §164.312

| Section | Requirement | Implementation |
|---------|-------------|----------------|
| §164.312(a)(1) | Access Control | Unique user IDs, emergency access procedures, auto-logoff, encryption |
| §164.312(a)(2)(i) | Unique User Identification | UUID per user, no shared accounts, service accounts scoped |
| §164.312(a)(2)(ii) | Emergency Access Procedure | Break-glass mechanism with dual-approval + full audit |
| §164.312(a)(2)(iii) | Automatic Logoff | 15-min idle timeout for sessions with PHI access |
| §164.312(a)(2)(iv) | Encryption and Decryption | AES-256-GCM at rest, TLS 1.3 in transit, field-level for PHI |
| §164.312(b) | Audit Controls | WORM logs, hash chain, 6-year retention, tamper detection |
| §164.312(c)(1) | Integrity Controls | Input validation, checksums, Merkle verification |
| §164.312(c)(2) | Authentication of ePHI | Digital signatures on PHI records, integrity verification |
| §164.312(d) | Person/Entity Authentication | MFA, certificate-based auth for systems, biometric option |
| §164.312(e)(1) | Transmission Security | TLS 1.3 mandatory, no fallback, certificate pinning |
| §164.312(e)(2)(i) | Integrity Controls (transmission) | HMAC on PHI payloads, TLS record-layer integrity |
| §164.312(e)(2)(ii) | Encryption (transmission) | AES-256-GCM for all PHI in transit, including internal |

### HIPAA Administrative Safeguards — §164.308

| Section | Requirement | Implementation |
|---------|-------------|----------------|
| §164.308(a)(1) | Security Management Process | Risk analysis, risk management, sanction policy, review |
| §164.308(a)(2) | Assigned Security Responsibility | Named security officer, documented responsibilities |
| §164.308(a)(3) | Workforce Security | Access authorization, termination procedures |
| §164.308(a)(4) | Information Access Management | Access establishment, modification procedures |
| §164.308(a)(5) | Security Awareness Training | Security reminders, malware protection, login monitoring |
| §164.308(a)(6) | Security Incident Procedures | Response and reporting, 60-day breach notification |
| §164.308(a)(7) | Contingency Plan | Backup plan, disaster recovery, emergency mode, testing |
| §164.308(a)(8) | Evaluation | Periodic security evaluation (annual minimum) |
| §164.308(b)(1) | Business Associate Contracts | BAA with every subprocessor handling PHI |

---

## 2. Per-Module Compliance Matrix

Every module in the codebase has specific compliance obligations:

| Module | SOC 2 | ISO 27001 | HIPAA | Critical Controls |
|--------|-------|-----------|-------|-------------------|
| `packages/auth` | CC5, CC6 | A.8.2, A.8.3, A.8.5 | §312(a), §312(d) | MFA, RBAC, RLS, session management |
| `packages/audit` | CC4, CC7 | A.8.15, A.8.16 | §312(b) | WORM, hash chain, Merkle tree, retention |
| `packages/crypto` | CC6.7 | A.8.24 | §312(a)(2)(iv), §312(e) | AES-256-GCM, HSM integration, key rotation |
| `packages/db` | CC5, PI1 | A.8.3, A.8.11 | §312(a), §312(c) | RLS, field encryption, data masking |
| `packages/events` | CC7, PI1 | A.8.15, A.8.20 | §312(b), §312(c) | Schema validation, replay safety, ordering |
| `packages/compliance` | CC3, CC9 | A.5.1, A.8.26 | §308(a)(1) | Rules engine, regulation enforcement |
| `packages/channels` | CC6.7 | A.8.20, A.8.21 | §312(e) | TLS, TCPA/FDCPA enforcement, consent |
| `packages/ai` | CC3, CC9 | A.8.26, A.8.27 | §312(a), §312(b) | Agent safety, hallucination containment, audit |
| `packages/graph` | CC5, CC6 | A.8.3 | §312(a) | Tenant isolation, access control, traversal limits |
| `apps/api` | All | All | All | Gateway security, rate limiting, validation |
| `apps/agent-runtime` | CC5, CC7, CC9 | A.8.2, A.8.27 | §312(a), §312(b) | Sandboxing, permission boundaries, kill switch |
| `infrastructure/` | CC6, CC7, A1 | A.7.1, A.8.9 | §310 | Network isolation, encryption, availability |

---

## 3. Automated Compliance Verification

### CI/CD Pipeline Gates (in order)

```
Stage 1: Pre-commit (local)
├── gitleaks — secret scanning
├── eslint-security — security lint rules
└── prettier — code formatting

Stage 2: PR Opened
├── TypeScript strict compilation (no `any` in security paths)
├── Unit tests (min 80% coverage)
├── SAST (Semgrep with OWASP rules)
├── Dependency scan (Snyk/Trivy)
├── License check (only OSI-approved)
├── PHI leak detection (custom regex patterns)
└── Audit log coverage check (all state-changing endpoints)

Stage 3: PR Approved
├── Integration tests (real database, encrypted connections)
├── Security tests (auth bypass, injection, privilege escalation)
├── Compliance tests (HIPAA controls, SOC 2 controls)
├── Container image scan (Trivy)
└── SBOM generation

Stage 4: Merge to develop
├── Full test suite
├── DAST scan (OWASP ZAP)
├── Performance baseline check
└── Deployment to staging

Stage 5: Staging → Production
├── Smoke tests on staging
├── Manual security review (for security-sensitive changes)
├── Change management record
├── Approval by security-designated reviewer
└── Blue-green deployment with health checks
```

### Compliance Test Patterns

Every compliance control MUST have an automated test:

```typescript
// tests/compliance/hipaa-access-control.test.ts
describe('HIPAA §164.312(a)(1) — Access Control', () => {
  it('rejects requests without authentication');
  it('enforces unique user identification');
  it('auto-logoff after 15 minutes idle');
  it('encrypts PHI at rest with AES-256-GCM');
  it('prevents cross-tenant data access via RLS');
  it('logs every PHI access with full audit trail');
  it('supports emergency break-glass with dual approval');
});

// tests/compliance/soc2-audit.test.ts
describe('SOC 2 CC7 — Audit Controls', () => {
  it('logs every state change as immutable event');
  it('prevents UPDATE on audit tables');
  it('prevents DELETE on audit tables');
  it('maintains SHA-256 hash chain continuity');
  it('generates Merkle roots every 1000 events');
  it('detects and alerts on hash chain breaks');
  it('retains audit logs for 7 years minimum');
});

// tests/compliance/iso27001-crypto.test.ts
describe('ISO 27001 A.8.24 — Cryptography', () => {
  it('uses AES-256-GCM for all encryption (not CBC/ECB)');
  it('generates keys via HSM-backed KMS');
  it('rotates encryption keys within 90 days');
  it('uses TLS 1.3 for all connections');
  it('enforces mTLS between services');
  it('uses Argon2id for password hashing');
});
```

---

## 4. Breach Notification Workflow

```
Detection (automated monitoring)
    │
    ▼
Assessment (< 1 hour)
    ├── Scope: How many records affected?
    ├── Data type: PHI? PII? Credentials?
    ├── Ongoing: Is the breach still active?
    └── Severity: P0/P1/P2/P3
    │
    ▼
Containment (immediate)
    ├── Revoke compromised credentials
    ├── Isolate affected systems
    ├── Activate kill switches for compromised agents
    └── Preserve forensic evidence (do NOT destroy logs)
    │
    ▼
Notification
    ├── Internal: Security team → Engineering → Leadership (within 4 hours)
    ├── HIPAA: HHS OCR within 60 days (if ≥500 records: within 60 days + media)
    ├── Affected individuals: Without unreasonable delay
    ├── State laws: Per state breach notification requirements
    └── SOC 2 auditor: Notify of material incident
    │
    ▼
Remediation
    ├── Root cause analysis
    ├── Fix deployed and verified
    ├── Controls enhanced
    └── Post-incident review documented
```

---

## 5. Data Retention Schedule

| Data Type | Minimum Retention | Maximum Retention | Disposal Method |
|-----------|-------------------|-------------------|-----------------|
| Audit logs | 7 years | 10 years | Secure deletion after retention |
| PHI records | 6 years from last action | Per BAA agreement | Crypto-shredding |
| Customer PII | Duration of relationship + 3 years | Per privacy policy | Crypto-shredding on request |
| Agent decision logs | 7 years | 10 years | Secure deletion |
| Financial records | 7 years | 10 years | Secure deletion |
| Access logs | 3 years | 7 years | Secure deletion |
| Communication records | 3 years | 7 years | Secure deletion |
| Encryption keys (retired) | 7 years after retirement | 10 years | HSM secure destruction |
| Backup data | 90 days | 1 year | Encrypted deletion |

---

## 6. Vendor/Subprocessor Requirements

Every third-party service MUST:

1. Have SOC 2 Type II report (current, reviewed annually)
2. Sign a BAA if handling PHI
3. Support encryption in transit and at rest
4. Provide audit log access
5. Support data deletion on request
6. Be documented in the vendor registry with:
   - Data types shared
   - Data classification level
   - Contract expiration
   - Last security review date
   - Compliance certifications

| Vendor | Purpose | PHI? | BAA Required? | SOC 2? | Status |
|--------|---------|------|---------------|--------|--------|
| AWS/GCP | Cloud infrastructure | Yes | Yes | Yes | Required |
| Confluent | Kafka (event stream) | Yes | Yes | Yes | Required |
| Neo4j Aura | Graph database | No (anonymized) | No | Yes | Required |
| Twilio | SMS/Voice/IVR | Potential | Yes | Yes | Required |
| SendGrid | Email delivery | Potential | Yes | Yes | Required |
| WorkOS | Auth/SSO/SCIM | No | No | Yes | Required |
| HashiCorp Vault | Secret management | Keys only | No | Yes | Required |
| Grafana Cloud | Monitoring | No (metrics only) | No | Yes | Required |

---

*This document is version-controlled, peer-reviewed, and updated with every architecture change. Non-compliance is a blocking incident.*
