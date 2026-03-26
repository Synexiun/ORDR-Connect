# Integration Tier Threat Model — STRIDE Analysis

**System:** ORDR-Connect External Integrations
**Scope:** Twilio (SMS/Voice/WhatsApp), SendGrid (Email), WorkOS (SSO/SCIM), Anthropic (Claude API)
**Review date:** 2026-03-25
**Reviewer:** Security Architecture Team

---

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| Twilio credentials | RESTRICTED | Account SID, auth token |
| SendGrid API key | RESTRICTED | Email delivery key |
| WorkOS API key | RESTRICTED | SSO/SCIM integration key |
| Claude API key | RESTRICTED | LLM inference key |
| Webhook payloads | CONFIDENTIAL | Inbound event data |
| OAuth tokens | RESTRICTED | User SSO tokens |
| SCIM provisioning data | CONFIDENTIAL | User directory sync |

---

## Threat: Spoofing

### S-INT-01: Webhook Spoofing (Twilio)

- **Attack:** Attacker sends forged Twilio webhook payloads to trigger system actions.
- **Mitigation:** Twilio signature validation on every webhook request (X-Twilio-Signature header). Signature computed from request URL + body + auth token. Requests without valid signatures are rejected with 403.
- **Control:** ISO 27001 A.14.1.3
- **Residual risk:** LOW. Requires Twilio auth token compromise.

### S-INT-02: Webhook Spoofing (SendGrid)

- **Attack:** Attacker sends forged SendGrid event webhook payloads.
- **Mitigation:** SendGrid Event Webhook signature verification. ECDSA signature validation using SendGrid public key. Timestamp validation prevents replay.
- **Control:** ISO 27001 A.14.1.3
- **Residual risk:** LOW.

### S-INT-03: OAuth Token Theft (WorkOS SSO)

- **Attack:** Attacker intercepts OAuth authorization code or tokens during SSO flow.
- **Mitigation:** OAuth 2.1 + PKCE for all external auth flows. State parameter for CSRF protection. Short-lived authorization codes. Token exchange over TLS only. Tokens stored with SHA-256 hash.
- **Control:** SOC2 CC6.1, CLAUDE.md Rule 2
- **Residual risk:** LOW. PKCE prevents authorization code interception.

---

## Threat: Tampering

### T-INT-01: MCP Injection in Developer Portal

- **Attack:** Malicious developer submits an agent to the marketplace containing injection payloads.
- **Mitigation:** Agent security review pipeline (marketplace-review routes). Static analysis of agent code before approval. Sandbox testing before deployment. Admin-only review queue with explicit approval/rejection.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** MEDIUM. Novel injection vectors may bypass static analysis.

### T-INT-02: Webhook Payload Manipulation

- **Attack:** Man-in-the-middle modifies webhook payload between provider and ORDR-Connect.
- **Mitigation:** TLS for all webhook endpoints. Signature verification (HMAC/ECDSA) ensures payload integrity. Timestamp validation rejects stale payloads.
- **Control:** ISO 27001 A.14.1.3
- **Residual risk:** VERY LOW. TLS + signature verification.

---

## Threat: Repudiation

### R-INT-01: Denied Message Delivery

- **Attack:** Dispute about whether a message was sent or delivered.
- **Mitigation:** All outbound messages logged with audit trail entry. Twilio/SendGrid delivery receipts processed and stored. Kafka events for every message action. Webhook status callbacks tracked.
- **Control:** SOC2 CC7.2
- **Residual risk:** VERY LOW.

### R-INT-02: SSO Session Attribution

- **Attack:** User denies performing actions that occurred during their SSO session.
- **Mitigation:** SSO login events logged with full context (IP, user agent, timestamp). Session ID tracked through all subsequent actions. WorkOS audit trail provides independent verification.
- **Control:** SOC2 CC7.2
- **Residual risk:** LOW.

---

## Threat: Information Disclosure

### I-INT-01: Credential Exposure in Logs

- **Attack:** Integration credentials (API keys, tokens) appear in application logs.
- **Mitigation:** All secrets managed via HashiCorp Vault. Secrets never logged (masked/redacted). Pre-commit hooks scan for secrets (gitleaks). CI/CD pipeline rejects commits with detected secrets.
- **Control:** CLAUDE.md Rule 5
- **Residual risk:** LOW. Requires ongoing secret scanning.

### I-INT-02: PHI Leakage via Email/SMS Content

- **Attack:** Customer PHI included in outbound communications.
- **Mitigation:** Compliance rules engine checks every customer-facing message before delivery. Template-based messaging with reviewed templates. Agent output validated by safety checks (ai/safety.ts).
- **Control:** HIPAA §164.312
- **Residual risk:** MEDIUM. Requires ongoing template and content review.

---

## Threat: Denial of Service

### D-INT-01: Integration Rate Limit Exhaustion

- **Attack:** Attacker triggers actions that exhaust Twilio/SendGrid API quotas.
- **Mitigation:** Per-tenant rate limiting. Channel-specific rate limits (channels/rate-limiter.ts). Budget enforcement for agent actions. Mass communication requires HITL approval.
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW.

### D-INT-02: Webhook Flood

- **Attack:** Attacker sends massive volume of webhook requests to overwhelm the system.
- **Mitigation:** Signature validation rejects unauthenticated webhooks early. Rate limiting on webhook endpoints. Async processing via Kafka decouples webhook handling from core processing.
- **Control:** ISO 27001 A.13.1.1
- **Residual risk:** LOW.

---

## Threat: Elevation of Privilege

### E-INT-01: SCIM Provisioning Abuse

- **Attack:** Attacker uses compromised SCIM token to provision admin accounts.
- **Mitigation:** SCIM endpoints use bearer token authentication (not JWT). Token scope limited to user provisioning operations. Role assignment capped — SCIM cannot create super_admin accounts. All SCIM operations audited.
- **Control:** SOC2 CC6.3
- **Residual risk:** MEDIUM. SCIM token compromise enables user provisioning. Monitoring required.

### E-INT-02: WorkOS SSO Role Mapping Manipulation

- **Attack:** Attacker manipulates SSO attributes to gain elevated roles.
- **Mitigation:** Role mapping configured server-side (not from SSO attributes directly). WorkOS directory sync provides group membership. Role assignment requires explicit admin configuration. Default role is 'viewer' for new SSO users.
- **Control:** SOC2 CC6.3
- **Residual risk:** LOW.

### E-INT-03: Agent Marketplace Privilege Escalation

- **Attack:** Marketplace agent requests permissions beyond what was approved.
- **Mitigation:** Agent permissions defined at installation time. Runtime enforcement via OPA policy. Permissions cannot exceed what was approved in security review. Any permission change triggers re-review.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** LOW.
