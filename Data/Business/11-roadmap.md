# ORDR-Connect — Product Roadmap

> **Document Classification:** Confidential — Internal Strategy
> **Version:** 1.0
> **Last Updated:** 2026-03-24
> **Owner:** Synexiun Product & Engineering

---

## 1. Roadmap Overview

The ORDR-Connect roadmap is structured in four phases, each gated by clear success criteria before the next phase begins. The gating mechanism exists to prevent premature breadth (Risk B1) and ensure each layer of the platform is production-hardened before building on top of it.

### Phase Summary

| Phase | Name | Duration | Focus |
|-------|------|----------|-------|
| **Phase 0** | Documentation + Architecture | 2 weeks | Design decisions, compliance framework, data models |
| **Phase 1** | Core Infrastructure | 6–8 weeks | Event backbone, data layer, auth, audit trail, single agent runtime |
| **Phase 2** | Wedge Vertical | 8–12 weeks | Collections AI agent, SMS channel, FDCPA compliance, first paying customers |
| **Phase 3** | Multi-Agent + Multi-Channel | 12–16 weeks | Agent orchestration, Customer Graph, enterprise features, second vertical |
| **Phase 4** | Ecosystem | 16–24 weeks | Agent marketplace, white-label, developer SDK, international |

### Total Timeline: 44–62 Weeks (~11–15 Months)

---

## 2. Gantt-Style Timeline

```
Month:    1    2    3    4    5    6    7    8    9    10   11   12   13   14   15
        |====|====|====|====|====|====|====|====|====|====|====|====|====|====|====|
Phase 0 |████|    |    |    |    |    |    |    |    |    |    |    |    |    |    |
Phase 1 |    |████|████|████|    |    |    |    |    |    |    |    |    |    |    |
Phase 2 |    |    |    |    |████|████|████|    |    |    |    |    |    |    |    |
Phase 3 |    |    |    |    |    |    |    |████|████|████|████|    |    |    |    |
Phase 4 |    |    |    |    |    |    |    |    |    |    |    |████|████|████|████|
```

### Detailed Week-by-Week Timeline

| Week | Phase | Key Milestone |
|------|-------|---------------|
| 1–2 | Phase 0 | Architecture docs complete, data models finalized, compliance controls mapped |
| 3–4 | Phase 1 | Kafka cluster operational, PostgreSQL schema deployed, basic auth functional |
| 5–6 | Phase 1 | Merkle audit trail operational, tenant isolation verified, event bus tested |
| 7–8 | Phase 1 | Single agent runtime deployed, internal testing complete |
| 9–10 | Phase 1 | Agent sandbox environment, CI/CD pipeline with compliance gates |
| 11–14 | Phase 2 | Collections agent v1, SMS integration, FDCPA rule engine |
| 15–18 | Phase 2 | Compliance validation suite, first pilot customer, SOC 2 Type I prep |
| 19–22 | Phase 2 | Production hardening, 10 paying customers, case study material |
| 23–26 | Phase 3 | Agent orchestration framework, multi-channel routing |
| 27–30 | Phase 3 | Customer Graph v1, enterprise RBAC, SSO integration |
| 31–34 | Phase 3 | Second vertical agent, advanced analytics dashboard |
| 35–38 | Phase 3 | SOC 2 Type II audit, enterprise customer onboarding |
| 39–42 | Phase 4 | Agent SDK beta, marketplace architecture, white-label framework |
| 43–48 | Phase 4 | Developer portal, partner program, international compliance (GDPR) |
| 49–54 | Phase 4 | Agent marketplace GA, white-label GA, SDK 1.0 |

---

## 3. Phase 0 — Documentation + Architecture (Weeks 1–2)

### Objective

Establish the architectural foundation, compliance framework, and data models that every subsequent phase builds upon. No code is written until the architecture is reviewed and approved.

### Deliverables

| Deliverable | Description | Status |
|-------------|-------------|--------|
| System architecture document | Component diagram, service boundaries, communication patterns, data flow | In Progress |
| Compliance development rules | SOC 2 + ISO 27001 + HIPAA control mapping to code-level implementation | Complete |
| Data model specification | PostgreSQL schema, tenant isolation model, Merkle audit structure | In Progress |
| API design specification | RESTful + event-driven API contracts, versioning strategy | Not Started |
| Security architecture | Encryption strategy, access control model, threat model (STRIDE) | Not Started |
| Business documentation suite | Pricing, GTM, financials, risk analysis, roadmap (this document) | In Progress |
| Technology selection rationale | Documented reasoning for every major technology choice | Not Started |
| Development environment setup | Containerized local dev, CI/CD pipeline skeleton, linting/formatting | Not Started |

### Tech Milestones

| Milestone | Target | Verification |
|-----------|--------|-------------|
| Architecture reviewed by at least 2 engineers | End of Week 1 | Review meeting notes |
| All data models pass normalization review | End of Week 1 | Schema review document |
| STRIDE threat model complete for all components | End of Week 2 | Threat model document |
| Development environment reproducible on any machine | End of Week 2 | New developer can run full stack in < 30 minutes |

### Compliance Milestones

| Milestone | Target | Evidence |
|-----------|--------|----------|
| SOC 2 control mapping complete | Week 1 | 00-compliance-development-rules.md |
| ISO 27001 Annex A mapping complete | Week 1 | Same document |
| HIPAA safeguard mapping complete | Week 2 | Same document |
| Data classification policy defined | Week 2 | Security architecture document |
| Encryption strategy documented | Week 2 | Security architecture document |

### Success Criteria (Gate to Phase 1)

- [ ] All architecture documents reviewed and approved
- [ ] Compliance control mapping covers 100% of applicable controls
- [ ] Data models support multi-tenancy, audit logging, and field-level encryption
- [ ] Development environment runs locally with a single command
- [ ] STRIDE threat model identifies all attack surfaces

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Analysis paralysis — over-documenting instead of building | Medium | Medium | Strict 2-week timebox; imperfect docs that ship > perfect docs that don't |
| Architecture decisions made without sufficient context | Low | High | Design for change — every component has a clear interface boundary |

### Dependencies

- None (Phase 0 has no external dependencies)

---

## 4. Phase 1 — Core Infrastructure (Weeks 3–10, 6–8 Weeks)

### Objective

Build the foundational infrastructure that every feature depends on: event backbone, data layer, authentication, audit trail, and a single-agent runtime. This phase produces no customer-facing features — it produces the platform that customer-facing features run on.

### Deliverables

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **Kafka event backbone** | Multi-topic event bus, schema registry, dead letter queues, exactly-once semantics | P0 |
| **PostgreSQL data layer** | Multi-tenant schema, RLS policies, migration framework, connection pooling | P0 |
| **Authentication system** | OAuth 2.1 + PKCE, MFA support, session management, API key management | P0 |
| **Merkle audit trail** | Append-only audit log with Merkle tree anchoring, tamper-evident verification | P0 |
| **Tenant isolation** | Data isolation, resource quotas, tenant-aware routing | P0 |
| **Single agent runtime** | Agent lifecycle management, prompt execution, tool calling, response validation | P0 |
| **Agent sandbox** | Isolated execution environment for agent testing and development | P1 |
| **CI/CD pipeline** | Build, test, lint, security scan, compliance check, deploy pipeline | P0 |
| **Monitoring stack** | Structured logging, metrics collection, alerting, health checks | P1 |
| **Developer documentation** | API reference, getting started guide, architecture overview | P1 |

### Tech Milestones

| Week | Milestone | Verification |
|------|-----------|-------------|
| Week 3 | Kafka cluster running, topics created, producer/consumer tested | Integration test passes |
| Week 4 | PostgreSQL schema deployed, RLS policies active, migrations working | Tenant A cannot see Tenant B data |
| Week 5 | Auth system operational, OAuth flow complete, MFA functional | Auth test suite passes (100% coverage) |
| Week 6 | Merkle audit trail operational, tamper detection verified | Insert 10K events, verify Merkle root, tamper 1, detect |
| Week 7 | Single agent runtime deploys, executes prompt, returns response | Agent responds to test input within 2s |
| Week 8 | Agent sandbox isolated, tools restricted, output validated | Agent cannot access data outside its scope |
| Week 9 | CI/CD pipeline enforces all compliance gates | PR with security violation is automatically blocked |
| Week 10 | Full integration test suite, monitoring alerts verified | All services healthy, alerts fire on simulated failure |

### Compliance Milestones

| Milestone | Week | Evidence |
|-----------|------|----------|
| Encryption at rest implemented (AES-256) | Week 4 | Database encryption verification |
| Encryption in transit (TLS 1.3) | Week 3 | Certificate configuration, HTTPS-only |
| Access control (RBAC) operational | Week 5 | Permission matrix test results |
| Audit logging captures all data access | Week 6 | Audit log completeness verification |
| Merkle tree tamper detection verified | Week 6 | Tamper test results |
| Secret management (no plaintext secrets) | Week 3 | Secrets scanning in CI/CD |
| Dependency scanning automated | Week 9 | SBOM generation, CVE report |
| Input validation on all API endpoints | Week 8 | OWASP Top 10 test results |

### Success Criteria (Gate to Phase 2)

- [ ] All P0 deliverables deployed and passing integration tests
- [ ] Kafka processes 10,000 events/second without consumer lag > 100ms
- [ ] PostgreSQL supports 100 concurrent tenants with < 50ms query P95
- [ ] Auth system passes OWASP authentication checklist
- [ ] Merkle audit trail detects tampering with 100% reliability
- [ ] Single agent runtime responds to test inputs within 2 seconds (P95)
- [ ] CI/CD pipeline blocks PRs with security violations
- [ ] Zero critical or high vulnerabilities in dependency scan
- [ ] Test coverage > 80% across all services

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Kafka operational complexity | Medium | Medium | Use managed Kafka (Confluent Cloud) for Phase 1; self-host later if needed |
| Merkle tree performance at scale | Low | Medium | Batch Merkle operations; anchor on schedule (every 60s) not per-event |
| Auth system security vulnerabilities | Low | Critical | Use proven libraries (WorkOS, Auth.js), not custom auth code |
| Scope creep — building features instead of infrastructure | High | High | Every PR must map to a Phase 1 deliverable; feature requests go to Phase 2 backlog |

### Dependencies

| Dependency | Type | Risk if Delayed |
|-----------|------|-----------------|
| Cloud provider account + billing | External | Blocks all infrastructure work |
| LLM API access (Anthropic, OpenAI) | External | Blocks agent runtime development |
| Domain + SSL certificates | External | Blocks production deployment |
| Phase 0 architecture documents | Internal | Blocks schema design and service boundaries |

---

## 5. Phase 2 — Wedge Vertical (Weeks 11–22, 8–12 Weeks)

### Objective

Deliver the first complete, compliance-certified AI agent for a specific vertical (collections/debt recovery) on a single channel (SMS). Achieve product-market fit with paying customers. This phase transforms ORDR-Connect from infrastructure into a product.

### Deliverables

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **Collections AI agent** | Domain-specific agent: payment reminders, negotiation, dispute handling, compliance-aware responses | P0 |
| **SMS channel integration** | Twilio integration, opt-in/opt-out management, message delivery tracking | P0 |
| **FDCPA compliance engine** | Rule-based validation: contact time restrictions, frequency limits, disclosure requirements, cease-and-desist handling | P0 |
| **TCPA compliance engine** | Consent management, DNC list checking, time zone awareness, opt-out processing | P0 |
| **Customer dashboard** | Real-time interaction view, agent performance metrics, compliance status, account management | P0 |
| **Payment processing integration** | Accept payments through AI agent conversation, PCI-DSS compliant | P1 |
| **Reporting and analytics** | Recovery rates, contact rates, compliance violation tracking, agent performance | P1 |
| **Self-serve onboarding** | Account creation, agent configuration, channel setup, portfolio upload | P1 |
| **Free tier implementation** | Rate limiting, feature gating, upgrade prompts | P1 |
| **Billing system** | Stripe integration, usage metering, invoice generation | P0 |

### Tech Milestones

| Week | Milestone | Verification |
|------|-----------|-------------|
| Week 11 | Collections agent prototype responds to test scenarios | 20 test scenarios pass |
| Week 12 | SMS integration sends/receives messages via Twilio | Round-trip message test |
| Week 13 | FDCPA rule engine blocks non-compliant messages | 50 compliance test cases pass |
| Week 14 | TCPA opt-in/opt-out management operational | Consent lifecycle test passes |
| Week 15 | Customer dashboard shows real-time interaction data | Dashboard displays live test data |
| Week 16 | Billing system charges correct amounts for usage | Billing accuracy test (100 simulated months) |
| Week 17 | Self-serve onboarding flow complete (< 10 min signup-to-first-message) | User testing confirms < 10 min |
| Week 18 | First pilot customer onboarded with real portfolio | Pilot sends first AI messages |
| Week 19 | Payment processing integration functional | Test payment completes end-to-end |
| Week 20 | Analytics dashboard with recovery rate tracking | Dashboard shows accurate metrics |
| Week 21 | Free tier live with appropriate limitations | Feature gating verified |
| Week 22 | Production hardening: load test, penetration test, chaos test | All tests pass with acceptable results |

### Compliance Milestones

| Milestone | Week | Evidence |
|-----------|------|----------|
| FDCPA rule engine covers all Regulation F requirements | Week 14 | Compliance test suite (100+ test cases) |
| TCPA consent management meets FCC guidelines | Week 14 | Consent lifecycle audit |
| Contact time restrictions enforced per state | Week 13 | Time zone test suite |
| Message frequency limits enforced | Week 13 | Rate limiting test results |
| Cease-and-desist handling automated | Week 14 | C&D processing test |
| SOC 2 Type I readiness assessment | Week 18 | Auditor readiness checklist |
| SOC 2 Type I audit initiated | Week 20 | Audit engagement letter |
| Penetration test (third-party) completed | Week 22 | Penetration test report |
| Privacy policy and terms of service published | Week 17 | Legal review complete |

### Success Criteria (Gate to Phase 3)

- [ ] Collections AI agent resolves > 40% of interactions without human escalation
- [ ] FDCPA compliance engine passes 100% of compliance test cases
- [ ] 10+ paying customers on Growth tier or higher
- [ ] Monthly recurring revenue > $5,000
- [ ] Customer NPS > 30
- [ ] Agent response time < 3 seconds (P95)
- [ ] System uptime > 99.5% over 30 consecutive days
- [ ] SOC 2 Type I audit initiated
- [ ] Zero compliance violations in production
- [ ] Free tier live with > 100 signups

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Collections agent quality insufficient for production | Medium | High | Extensive testing with real collections scenarios; human-in-the-loop for first 30 days |
| FDCPA compliance gaps discovered in production | Low | Critical | Engage collections compliance attorney for rule engine review; conservative defaults |
| SMS delivery rates lower than expected | Medium | Medium | Multi-provider SMS (Twilio + Vonage fallback); deliverability monitoring |
| Pilot customers churn before validation | Medium | High | Select pilots carefully; provide white-glove onboarding; weekly check-ins |
| Twilio pricing increases | Low | Medium | Abstracted communication layer allows provider switch |

### Dependencies

| Dependency | Type | Risk if Delayed |
|-----------|------|-----------------|
| Phase 1 infrastructure complete | Internal | Blocks all Phase 2 work |
| Twilio account + SMS number provisioning | External | Blocks SMS testing |
| Stripe account approval | External | Blocks billing system |
| Collections compliance attorney review | External | Blocks FDCPA engine sign-off |
| First pilot customer agreement | External | Blocks production validation |

---

## 6. Phase 3 — Multi-Agent + Multi-Channel + Enterprise (Weeks 23–38, 12–16 Weeks)

### Objective

Scale from single-agent/single-channel to a multi-agent orchestration platform with omnichannel communication, the Customer Graph, and enterprise-grade features. Expand to a second vertical. This phase transforms ORDR-Connect from a vertical tool into a platform.

### Deliverables

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **Agent orchestration framework** | Multi-agent routing, handoff between agents, escalation chains, agent collaboration | P0 |
| **Multi-channel support** | Voice (Twilio), email (SendGrid), WhatsApp Business, web chat widget | P0 |
| **Customer Graph** | Unified customer identity across channels, interaction history, relationship mapping, sentiment tracking | P0 |
| **Enterprise RBAC** | Organization hierarchy, custom roles, permission sets, audit of permission changes | P0 |
| **SSO / SCIM** | WorkOS integration for enterprise SSO (SAML, OIDC) and automated user provisioning | P0 |
| **Second vertical agent** | Political campaign communications agent (FEC/TCPA-compliant voter outreach) | P1 |
| **Advanced analytics** | Predictive metrics, agent performance comparison, channel effectiveness, cohort analysis | P1 |
| **API v2** | Public REST API for custom integrations, webhook management, API rate limiting | P1 |
| **White-label foundation** | Theming engine, custom domain support, branded communication templates | P2 |
| **Salesforce integration** | Bi-directional sync, contact mapping, activity logging | P1 |
| **HubSpot integration** | Bi-directional sync, deal mapping, workflow triggers | P1 |

### Tech Milestones

| Week | Milestone | Verification |
|------|-----------|-------------|
| Week 23–24 | Agent orchestration: 2 agents can collaborate on a single customer interaction | Orchestration test: handoff between collection agent and payment agent |
| Week 25–26 | Voice channel operational (Twilio Voice) | Inbound and outbound call test |
| Week 27–28 | Email channel operational (SendGrid) | Automated email sequence test |
| Week 29–30 | Customer Graph v1: unified identity across SMS + voice + email | Same customer identified across 3 channels |
| Week 31–32 | Enterprise RBAC + SSO operational | Enterprise test tenant with SAML SSO and role hierarchy |
| Week 33–34 | Second vertical agent (political) deployed to staging | 50 political outreach scenarios tested |
| Week 35–36 | Advanced analytics dashboard live | Metrics accuracy verified against raw data |
| Week 37–38 | Salesforce + HubSpot integrations functional | Bi-directional sync test with sandbox instances |

### Compliance Milestones

| Milestone | Week | Evidence |
|-----------|------|----------|
| SOC 2 Type I report received | Week 24 | Auditor report |
| SOC 2 Type II observation period begins | Week 25 | Audit engagement |
| FEC compliance engine for political vertical | Week 34 | Compliance test suite |
| SCIM provisioning/deprovisioning audit | Week 32 | Automated onboarding/offboarding test |
| Multi-channel consent management | Week 28 | Cross-channel consent test |
| Penetration test (second round) | Week 38 | Penetration test report |
| HIPAA readiness assessment (for healthcare Phase 4 prep) | Week 36 | Gap analysis document |

### Success Criteria (Gate to Phase 4)

- [ ] Agent orchestration handles 3+ agent types in a single workflow
- [ ] 3+ communication channels operational and compliant
- [ ] Customer Graph correctly unifies identity across all active channels
- [ ] Enterprise SSO functional with at least 2 identity providers
- [ ] 100+ paying customers across both verticals
- [ ] MRR > $50,000
- [ ] SOC 2 Type II observation period in progress
- [ ] NRR > 110%
- [ ] Platform uptime > 99.9% over 90 consecutive days
- [ ] Public API serving 5+ third-party integrations

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent orchestration complexity | High | Medium | Start with simple sequential handoff; add parallel orchestration later |
| Voice AI quality (speech-to-text, text-to-speech) | Medium | Medium | Use best-in-class providers (Deepgram, ElevenLabs); human fallback for low-confidence |
| Customer Graph identity resolution failures | Medium | Medium | Probabilistic matching with human review for ambiguous cases |
| Enterprise sales cycle longer than expected | High | Medium | Build pipeline early (Month 8); enterprise deals close in Month 14–16 |
| Second vertical diverts focus from first | High | High | Dedicated team for each vertical; shared infrastructure only |

### Dependencies

| Dependency | Type | Risk if Delayed |
|-----------|------|-----------------|
| Phase 2 gate criteria met | Internal | Blocks Phase 3 start |
| SOC 2 Type I completion | External (auditor) | Blocks enterprise sales conversations |
| WorkOS or equivalent SSO provider | External | Blocks enterprise SSO |
| Voice AI provider (Deepgram/similar) | External | Blocks voice channel |
| Election cycle timing (for political vertical) | External | Political vertical is season-dependent |

---

## 7. Phase 4 — Ecosystem (Weeks 39–62, 16–24 Weeks)

### Objective

Transform ORDR-Connect from a product into a platform ecosystem. Enable third-party developers to build agents, allow enterprises to white-label the platform, and expand internationally with region-specific compliance.

### Deliverables

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| **Agent SDK (TypeScript + Python)** | Developer toolkit for building custom agents: agent lifecycle, tool registration, testing framework, compliance helpers | P0 |
| **Agent Marketplace** | Discovery, installation, rating, and revenue sharing for third-party agents | P0 |
| **White-label platform** | Full platform rebranding: custom domain, logo, colors, email templates, agent branding | P0 |
| **Developer portal** | Documentation, API explorer, sandbox environment, community forums | P0 |
| **Healthcare vertical** | HIPAA-compliant patient communication agents, EHR integration (HL7 FHIR), appointment scheduling | P1 |
| **Legal vertical** | Attorney-client privilege-aware agents, matter management integration, document intake | P2 |
| **International compliance** | GDPR (EU), PIPEDA (Canada), LGPD (Brazil) compliance frameworks | P1 |
| **Advanced AI features** | Agent memory (long-term context), multi-modal (image/document processing), sentiment-aware routing | P1 |
| **Partner program** | Certified partner tiers, training materials, partner portal, co-marketing framework | P1 |
| **Mobile app** | iOS/Android app for agent management, real-time notifications, customer interaction monitoring | P2 |

### Tech Milestones

| Week | Milestone | Verification |
|------|-----------|-------------|
| Week 39–40 | Agent SDK alpha: build, test, deploy a custom agent | Internal developer builds agent using SDK in < 2 hours |
| Week 41–42 | Marketplace architecture: agent packaging, installation, sandboxing | Third-party agent installs and runs without platform modification |
| Week 43–44 | White-label framework: theme engine, custom domains, branded emails | Demo white-label instance indistinguishable from original |
| Week 45–46 | Developer portal live: docs, API explorer, sandbox | External developer completes tutorial successfully |
| Week 47–48 | Healthcare agent prototype: appointment scheduling, patient FAQ | 30 healthcare scenarios tested |
| Week 49–50 | GDPR compliance framework operational | EU tenant data residency verified, right-to-erasure tested |
| Week 51–52 | Agent SDK beta: 10+ external developers building agents | Developer feedback survey NPS > 40 |
| Week 53–54 | Agent Marketplace GA: 5+ third-party agents available | Marketplace live, agents installable, revenue share functional |
| Week 55–58 | Healthcare vertical GA with HIPAA certification | HIPAA audit complete |
| Week 59–62 | White-label GA: 2+ partners running white-label instances | Partners serving customers on white-label |

### Compliance Milestones

| Milestone | Week | Evidence |
|-----------|------|----------|
| SOC 2 Type II report issued | Week 40 | Auditor report |
| HIPAA certification (for healthcare vertical) | Week 56 | BAA template, security assessment |
| GDPR compliance verification | Week 50 | Data residency audit, DPA template |
| Agent marketplace security review framework | Week 42 | Third-party agent security policy |
| ISO 27001 certification initiated | Week 44 | Audit engagement letter |
| ISO 27001 certification achieved | Week 58 | Certificate |
| Annual penetration test (third round) | Week 54 | Penetration test report |

### Success Criteria (Phase 4 Completion)

- [ ] Agent SDK 1.0 released with comprehensive documentation
- [ ] Agent Marketplace live with 10+ agents (including 5+ third-party)
- [ ] 2+ white-label partners operational
- [ ] Healthcare vertical live with HIPAA certification
- [ ] GDPR compliance enabling EU customers
- [ ] SOC 2 Type II + ISO 27001 certified
- [ ] 1,000+ paying customers
- [ ] $250K+ MRR
- [ ] Developer community: 500+ registered developers
- [ ] NRR > 118%

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Third-party agent quality/security | High | High | Mandatory security review, sandboxed execution, marketplace review process |
| SDK adoption below expectations | Medium | Medium | Developer evangelism, hackathons, showcase projects, responsive support |
| White-label operational complexity | Medium | Medium | Standardized customization framework; limit deep customization initially |
| Healthcare HIPAA certification delays | Medium | High | Engage HIPAA auditor early (Phase 3); continuous readiness assessment |
| International expansion regulatory complexity | High | Medium | One region at a time (EU first); local legal counsel; compliance automation |

### Dependencies

| Dependency | Type | Risk if Delayed |
|-----------|------|-----------------|
| Phase 3 gate criteria met | Internal | Blocks Phase 4 start |
| SOC 2 Type II report | External (auditor) | Required for enterprise and healthcare credibility |
| HIPAA auditor engagement | External | Blocks healthcare vertical launch |
| EU data center availability | External (cloud provider) | Blocks GDPR compliance |
| Third-party developer interest | External (market) | Blocks marketplace viability — mitigated by SDK quality and developer relations |

---

## 8. Cross-Phase Workstreams

Some work spans all phases and is not tied to a specific phase gate.

### Continuous Security

| Activity | Cadence | Start Phase |
|----------|---------|-------------|
| Dependency scanning | Every PR | Phase 1 |
| SAST (static analysis) | Every PR | Phase 1 |
| DAST (dynamic analysis) | Weekly | Phase 2 |
| Penetration testing (third-party) | Quarterly | Phase 2 |
| Security incident response drills | Quarterly | Phase 2 |
| Threat model updates | Per major feature | Phase 0 |
| Access reviews | Monthly | Phase 1 |

### Continuous Compliance

| Activity | Cadence | Start Phase |
|----------|---------|-------------|
| Compliance evidence collection | Automated (continuous) | Phase 1 |
| Internal audit | Quarterly | Phase 2 |
| Policy review and update | Quarterly | Phase 0 |
| Employee security training | Quarterly | Phase 2 |
| Vendor security assessment | Per new vendor | Phase 1 |

### Continuous Product

| Activity | Cadence | Start Phase |
|----------|---------|-------------|
| Customer feedback collection | Weekly | Phase 2 |
| NPS survey | Quarterly | Phase 2 |
| Feature prioritization review | Bi-weekly | Phase 1 |
| Competitive analysis | Monthly | Phase 0 |
| AI model evaluation (new models) | Per release from providers | Phase 1 |

---

## 9. Resource Allocation by Phase

| Role | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|------|---------|---------|---------|---------|---------|
| **Backend Engineers** | 1 | 1 | 2 | 4 | 7 |
| **Frontend Engineers** | 0 | 1 | 1 | 2 | 4 |
| **AI/ML Engineers** | 1 | 1 | 1 | 2 | 4 |
| **DevOps/SRE** | 0 | 0 | 0 | 1 | 3 |
| **Product Manager** | 1 | 1 | 1 | 1 | 2 |
| **Designer** | 0 | 0 | 1 | 1 | 2 |
| **Sales** | 0 | 0 | 1 | 2 | 4 |
| **Customer Success** | 0 | 0 | 0 | 1 | 2 |
| **Compliance** | 0 | 0 | 0 | 1 | 1 |
| **Total Headcount** | **3** | **4** | **7** | **15** | **29** |

---

## 10. Decision Log

Decisions are logged as they are made. This section will grow throughout execution.

| Date | Decision | Rationale | Revisit Date |
|------|----------|-----------|-------------|
| 2026-03-24 | Collections as wedge vertical | Highest weighted score (8.85/10) on selection criteria | Phase 2 midpoint |
| 2026-03-24 | Kafka for event backbone (not RabbitMQ/SQS) | Exactly-once semantics, event replay, schema registry — critical for audit trail | Phase 1 end |
| 2026-03-24 | PostgreSQL over MongoDB | Relational integrity for compliance data, RLS for tenant isolation, Merkle tree support | Phase 1 end |
| 2026-03-24 | Managed services for Phase 1, evaluate self-hosting in Phase 3 | Reduce operational overhead when team is small | Phase 3 start |
| 2026-03-24 | SOC 2 Type I before Type II | Type I proves controls exist (faster), Type II proves controls operate over time (6-month observation) | Phase 2 midpoint |

---

## 11. Roadmap Governance

### Review Cadence

| Review | Frequency | Participants | Purpose |
|--------|-----------|-------------|---------|
| Sprint review | Bi-weekly | Engineering + Product | Track progress against phase milestones |
| Phase gate review | Per phase completion | Full leadership | Go/no-go for next phase |
| Quarterly business review | Quarterly | Leadership + advisors | Strategic alignment, resource allocation |
| Annual planning | Annually | Full team | Next-year roadmap, OKRs, budget |

### Change Management

Roadmap changes follow a structured process:

1. **Feature requests** go to the backlog and are prioritized in the next sprint review
2. **Phase scope changes** require Product Manager approval and documentation of trade-offs
3. **Phase sequence changes** (e.g., skipping Phase 2 gate criteria) require CEO approval and documented risk acceptance
4. **Timeline extensions** > 2 weeks require root cause analysis and updated projections

### Roadmap Communication

| Audience | Format | Cadence |
|----------|--------|---------|
| Engineering team | Sprint board (Jira/Linear) | Real-time |
| Full team | Phase progress update | Bi-weekly |
| Board/investors | Milestone progress report | Quarterly |
| Customers | Public roadmap (high-level) | Quarterly update |
| Partners | Partner roadmap (NDA) | Quarterly |

---

*This roadmap is a living document. It will be updated at every phase gate review and quarterly business review. Dates are targets, not commitments — phase gate criteria are commitments. We ship when it is ready, not when the calendar says so.*
