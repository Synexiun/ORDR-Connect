# ORDR-Connect

**Customer Operations OS** — an autonomous, event-sourced, multi-agent platform that replaces passive CRM with an intelligent system of action.

Built under the [Synexiun](https://github.com/Synexiun) ecosystem (limb: SynexCom).

---

## Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Language** | TypeScript (strict) | Type safety across the entire stack |
| **Runtime** | Node.js 22 LTS | LTS stability + performance |
| **API** | Hono | Edge-ready, standards-based HTTP |
| **ORM** | Drizzle ORM | Type-safe SQL, zero magic |
| **Database** | PostgreSQL 16+ (RLS) | ACID, Row-Level Security, pgvector |
| **Events** | Apache Kafka | Event sourcing backbone |
| **Graph** | Neo4j Aura | Customer relationship modeling |
| **Analytics** | ClickHouse | OLAP at scale |
| **Cache** | Redis 7+ (ACL) | Session, rate limiting, scoring |
| **Auth** | WorkOS + JWT | Enterprise SSO, SCIM, RBAC/ABAC |
| **AI** | LangGraph + Claude API | Multi-agent orchestration |
| **Channels** | Twilio + SendGrid | SMS, Voice, IVR, Email |

## Project Structure

```
ORDR-Connect/
├── apps/
│   ├── api/                    Hono REST API
│   ├── web/                    React + Vite dashboard
│   ├── agent-runtime/          AI agent execution sandbox
│   ├── developer-portal/       API management & self-service
│   └── worker/                 Background job processing
├── packages/
│   ├── ai/                     LLM abstraction & safety
│   ├── analytics/              Metrics pipeline
│   ├── audit/                  WORM logging + Merkle tree
│   ├── auth/                   OAuth 2.1, JWT, RBAC/ABAC
│   ├── billing/                Usage metering & invoicing
│   ├── channels/               Multi-channel delivery
│   ├── compliance/             SOC2/ISO27001/HIPAA rules engine
│   ├── core/                   Shared business logic
│   ├── crypto/                 AES-256-GCM, field-level encryption
│   ├── db/                     Drizzle schemas, migrations, RLS
│   ├── decision-engine/        Customer operations rules
│   ├── events/                 Kafka producers/consumers
│   ├── graph/                  Neo4j customer graph
│   ├── integrations/           Third-party connectors
│   ├── observability/          Prometheus + Grafana + Loki
│   ├── realtime/               WebSocket subscriptions
│   ├── scheduler/              Job scheduling & cron
│   ├── sdk/                    Public customer SDK
│   ├── search/                 Full-text search & indexing
│   └── workflow/               Workflow orchestration engine
├── infrastructure/
│   ├── docker/                 Distroless Dockerfiles
│   ├── kubernetes/             K8s + Istio manifests
│   └── terraform/              IaC definitions
├── security/
│   ├── policies/               OPA/Rego policies
│   ├── schemas/                JSON Schema validation
│   └── threat-models/          STRIDE threat models
└── tests/
    ├── unit/                   Unit test suites
    ├── integration/            Integration tests
    ├── security/               Security-specific tests
    └── compliance/             Compliance verification
```

## Compliance

Every line of code complies with **SOC 2 Type II**, **ISO 27001:2022**, and **HIPAA**. These are hard gates, not guidelines.

| Control | Implementation |
|---------|---------------|
| Encryption at rest | AES-256-GCM, HSM-backed keys |
| Encryption in transit | TLS 1.3, mTLS between services |
| Authentication | OAuth 2.1 + PKCE, Argon2id hashing |
| Authorization | RBAC + ABAC, PostgreSQL RLS |
| Audit logging | WORM with SHA-256 hash chain, 7-year retention |
| Secret management | External vault, automated 90-day rotation |
| PHI handling | Field-level encryption, access logging, cryptographic erasure |
| Agent safety | JSON schema validation, confidence scoring, human-in-the-loop |

## Quick Start

```bash
# Prerequisites: Node.js 22+, pnpm 9+, Docker

# Clone and install
git clone git@github.com:Synexiun/ORDR-Connect.git
cd ORDR-Connect
pnpm install

# Start infrastructure (PostgreSQL, Redis, Kafka)
make docker-up

# Run migrations and seed
make db-migrate
make db-seed

# Start development
make dev
```

## Commands

```bash
make setup           # Full setup (install + docker + migrate + seed)
make dev             # Start dev servers
make test            # Run all tests
make test-coverage   # Tests with coverage report
make lint            # Linting
make type-check      # TypeScript strict checking
make security-scan   # Dependency audit + secret scan
make build           # Build all packages
make clean           # Remove build artifacts
```

## Git Workflow

| Branch | Purpose | Protection |
|--------|---------|-----------|
| `main` | Production | 2 reviewers + all compliance gates |
| `staging` | Pre-production | 1 reviewer + all compliance gates |
| `develop` | Integration | All compliance gates |

Feature branches: `feat/`, `fix/`, `security/`, `compliance/`

## Test Suite

**172 files | 5,179 tests | 80%+ coverage threshold**

```bash
pnpm test                          # All unit tests
pnpm test:integration              # Integration tests
pnpm test -- --coverage            # Coverage report
```

## License

**UNLICENSED** — Proprietary. All rights reserved by Synexiun.
