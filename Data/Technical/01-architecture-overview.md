# ORDR-Connect — System Architecture Overview

> **Classification:** Confidential — Internal Engineering
> **Compliance Scope:** SOC 2 Type II | ISO 27001:2022 | HIPAA
> **Last Updated:** 2026-03-24
> **Owner:** Platform Engineering

---

## 1. Architectural Philosophy

ORDR-Connect is a **Customer Operations OS** built on six composable primitives. Every
primitive enforces tenant isolation, audit logging, and encryption by default — there is
no "opt-in" security. The architecture follows a strict **event-driven, polyglot-persistent,
zero-trust** model designed to satisfy SOC 2 Type II, ISO 27001:2022, and HIPAA simultaneously.

### Design Principles

| Principle | Implementation |
|---|---|
| **Tenant Isolation** | PostgreSQL RLS, Neo4j namespace isolation, Kafka topic-per-tenant, Redis ACLs |
| **Defense in Depth** | mTLS everywhere, field-level encryption, Vault-managed secrets, AMD SEV-SNP |
| **Event Sourcing** | Every state mutation emits an immutable event to Kafka before acknowledgment |
| **Polyglot Persistence** | Right database for the right workload — no compromises |
| **Graduated Autonomy** | AI agents operate within explicit permission boundaries with kill switches |
| **Compliance by Construction** | Audit trails, retention policies, and access controls are structural, not bolted on |

---

## 2. Six Primitives — High-Level Architecture

```mermaid
graph TB
    subgraph "ORDR-Connect — Six Primitives"
        direction TB

        subgraph "Ingestion & State"
            CG["<b>Customer Graph</b><br/>Neo4j Aura + pgvector<br/>Unified entity model"]
            ES["<b>Event Stream</b><br/>Kafka (Confluent Cloud)<br/>Immutable event log"]
        end

        subgraph "Intelligence"
            DE["<b>Decision Engine</b><br/>Rules → ML → LLM<br/>Three-layer scoring"]
            AR["<b>Agent Runtime</b><br/>LangGraph Agents<br/>Graduated autonomy"]
        end

        subgraph "Action & Control"
            EL["<b>Execution Layer</b><br/>Twilio · SendGrid · Calendly<br/>Omnichannel delivery"]
            GL["<b>Governance Layer</b><br/>Merkle DAG audit<br/>RBAC + ABAC + ReBAC"]
        end
    end

    %% Data flows
    CG -->|"entity context"| DE
    ES -->|"real-time signals"| DE
    DE -->|"next-best-action"| AR
    AR -->|"execute actions"| EL
    EL -->|"outcome events"| ES
    ES -->|"graph mutations"| CG
    GL -.->|"policy enforcement"| CG
    GL -.->|"audit every call"| DE
    GL -.->|"permission gates"| AR
    GL -.->|"delivery compliance"| EL
    GL -.->|"event integrity"| ES

    style CG fill:#1a365d,stroke:#63b3ed,color:#fff
    style ES fill:#1a365d,stroke:#63b3ed,color:#fff
    style DE fill:#2d3748,stroke:#ed8936,color:#fff
    style AR fill:#2d3748,stroke:#ed8936,color:#fff
    style EL fill:#22543d,stroke:#68d391,color:#fff
    style GL fill:#742a2a,stroke:#fc8181,color:#fff
```

### Primitive Responsibilities

| # | Primitive | Purpose | Primary Store | SLA |
|---|---|---|---|---|
| 1 | **Customer Graph** | Unified entity model — people, companies, deals, tickets, products | Neo4j Aura + pgvector | p99 < 50ms read |
| 2 | **Event Stream** | Immutable log of every state change and external signal | Kafka (Confluent) | p99 < 15ms publish |
| 3 | **Decision Engine** | Three-layer intelligence: rules → ML → LLM reasoning | ClickHouse + Redis | p99 < 100ms (rules) |
| 4 | **Agent Runtime** | Autonomous AI agents with graduated permissions | LangGraph + Redis | p99 < 2s per step |
| 5 | **Execution Layer** | Omnichannel action delivery — email, SMS, call, calendar | Twilio, SendGrid, API | p99 < 500ms dispatch |
| 6 | **Governance Layer** | Audit, compliance, access control, encryption | PostgreSQL + Vault | p99 < 10ms policy check |

---

## 3. Data Flow Cycle

Every operation in ORDR-Connect follows a closed-loop cycle. No data transformation
happens outside this cycle, ensuring complete auditability.

```mermaid
sequenceDiagram
    participant Ext as External Signal
    participant ES as Event Stream (Kafka)
    participant CG as Customer Graph
    participant DE as Decision Engine
    participant AR as Agent Runtime
    participant EL as Execution Layer
    participant GL as Governance Layer
    participant Audit as Merkle DAG Audit Log

    Ext->>ES: Ingest event (webhook, API, CDC)
    ES->>GL: Validate schema + tenant auth
    GL-->>Audit: Log ingestion event
    ES->>CG: Update graph (entities, relationships)
    CG->>DE: Provide entity context + history
    ES->>DE: Provide real-time signal
    DE->>DE: Rules → ML → LLM (three-layer)
    DE->>GL: Check action permissions
    GL-->>Audit: Log decision rationale
    DE->>AR: Dispatch next-best-action
    AR->>GL: Verify agent permissions (L1-L5)
    GL-->>Audit: Log agent authorization
    AR->>EL: Execute action (email, SMS, call)
    EL->>ES: Emit outcome event
    ES->>CG: Update graph with outcome
    GL-->>Audit: Log execution result + Merkle hash
```

---

## 4. Deployment Topology

### Infrastructure Overview

All components deploy to **Kubernetes** (EKS/GKE) across three availability zones.
Stateful services use managed offerings (RDS, Confluent Cloud, Neo4j Aura) to
eliminate operational burden while maintaining compliance guarantees.

```mermaid
graph TB
    subgraph "Edge Layer"
        CF["Cloudflare<br/>WAF + DDoS + CDN"]
        LB["AWS ALB / GCP GLB<br/>TLS 1.3 termination"]
    end

    subgraph "Kubernetes Cluster — Primary Region"
        subgraph "API Tier (Hono)"
            API1["API Pod 1"]
            API2["API Pod 2"]
            API3["API Pod N"]
        end

        subgraph "Worker Tier"
            W1["Event Consumers"]
            W2["Agent Workers"]
            W3["CDC Processors"]
            W4["ML Inference"]
        end

        subgraph "Service Mesh (Istio)"
            MTLS["mTLS Sidecar<br/>Every pod"]
        end
    end

    subgraph "Data Tier — Managed Services"
        PG["PostgreSQL 16+<br/>RDS Multi-AZ<br/>RLS + FLE"]
        KF["Kafka<br/>Confluent Cloud<br/>3 brokers, RF=3"]
        NEO["Neo4j Aura<br/>Enterprise<br/>3-node cluster"]
        CH["ClickHouse Cloud<br/>3 shards<br/>OLAP analytics"]
        RD["Redis 7+<br/>ElastiCache<br/>Cluster mode"]
        PGV["pgvector<br/>on PostgreSQL<br/>HNSW indexes"]
        ICE["Apache Iceberg<br/>S3 + Glue Catalog<br/>Long-term storage"]
    end

    subgraph "Security Tier"
        VLT["HashiCorp Vault<br/>HSM-backed<br/>Auto-unseal"]
        WOS["WorkOS<br/>SSO + SCIM + MFA"]
        SIG["Sigstore<br/>Supply chain attestation"]
    end

    subgraph "Observability"
        OT["OpenTelemetry<br/>Traces + Metrics + Logs"]
        GF["Grafana Stack<br/>Dashboards + Alerts"]
    end

    CF --> LB
    LB --> API1 & API2 & API3
    API1 & API2 & API3 --> MTLS
    MTLS --> W1 & W2 & W3 & W4
    W1 --> KF
    W2 --> NEO & PG
    W3 --> PG & CH
    W4 --> PGV & RD
    API1 & API2 & API3 --> PG & RD & NEO
    W1 & W2 & W3 --> VLT
    API1 --> WOS
    MTLS --> OT --> GF

    style CF fill:#f6ad55,stroke:#c05621,color:#000
    style VLT fill:#742a2a,stroke:#fc8181,color:#fff
    style KF fill:#1a365d,stroke:#63b3ed,color:#fff
    style PG fill:#22543d,stroke:#68d391,color:#fff
    style NEO fill:#2d3748,stroke:#a0aec0,color:#fff
```

---

## 5. Component Dependency Diagram

```mermaid
graph LR
    subgraph "Runtime Dependencies"
        HONO["Hono<br/>HTTP Framework"] --> ZOD["Zod<br/>Validation"]
        HONO --> DRIZZLE["Drizzle ORM<br/>Query Builder"]
        DRIZZLE --> PG_DRV["pg Driver<br/>PostgreSQL"]
        HONO --> BULLMQ["BullMQ<br/>Job Queue"]
        BULLMQ --> REDIS_DRV["ioredis<br/>Redis Client"]
        HONO --> KAFKAJS["KafkaJS<br/>Event Producer"]
        HONO --> NEO4J_DRV["neo4j-driver<br/>Graph Client"]
    end

    subgraph "Intelligence Dependencies"
        LANGGRAPH["LangGraph<br/>Agent Orchestration"] --> LANGCHAIN["LangChain<br/>LLM Abstraction"]
        LANGCHAIN --> OPENAI["OpenAI / Anthropic<br/>LLM Providers"]
        LANGGRAPH --> GORULES["GoRules<br/>Rules Engine"]
        LANGGRAPH --> XGBOOST["XGBoost / LightGBM<br/>ML Scoring"]
    end

    subgraph "Infrastructure Dependencies"
        TF["Terraform<br/>IaC"] --> AWS["AWS / GCP<br/>Cloud Provider"]
        VAULT_SDK["Vault SDK<br/>Secrets"] --> VAULT_SRV["Vault Server<br/>HSM-backed"]
        WORKOS_SDK["WorkOS SDK<br/>Auth"] --> WORKOS_SRV["WorkOS<br/>IdP"]
    end

    subgraph "Delivery Dependencies"
        TWILIO_SDK["Twilio SDK<br/>Voice + SMS"] --> TWILIO_SRV["Twilio<br/>Communications"]
        SG_SDK["SendGrid SDK<br/>Email"] --> SG_SRV["SendGrid<br/>Email Delivery"]
    end

    HONO --> LANGGRAPH
    HONO --> VAULT_SDK
    HONO --> WORKOS_SDK
    LANGGRAPH --> TWILIO_SDK & SG_SDK
```

---

## 6. Tech Stack Reference

### Application Layer

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Language | TypeScript (strict mode) | 5.4+ | Type-safe application code |
| HTTP Framework | Hono | 4.x | Edge-ready, zero-dependency HTTP |
| ORM | Drizzle ORM | 0.30+ | Type-safe SQL with RLS support |
| Validation | Zod | 3.x | Runtime schema validation |
| Job Queue | BullMQ | 5.x | Background job processing |
| Agent Framework | LangGraph | 0.2+ | Stateful multi-agent orchestration |

### Data Layer

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Primary DB | PostgreSQL | 16+ | OLTP, RLS, field-level encryption |
| Graph DB | Neo4j Aura | 5.x | Customer relationship graph |
| OLAP | ClickHouse | 24.x | Analytics, materialized views |
| Vector Store | pgvector + pgvectorscale | 0.7+ | Embedding similarity search |
| Event Streaming | Kafka (Confluent Cloud) | 3.7+ | Event sourcing, CDC |
| Cache | Redis | 7+ | Session, rate limiting, feature flags |
| Cold Storage | Apache Iceberg | 1.5+ | Long-term event archival |

### Security & Infrastructure

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Auth Provider | WorkOS | latest | SSO, SCIM, MFA, Directory Sync |
| Secret Management | HashiCorp Vault | 1.16+ | HSM-backed secret lifecycle |
| IaC | Terraform | 1.7+ | Infrastructure provisioning |
| Container Runtime | Kubernetes | 1.29+ | Orchestration, auto-scaling |
| Service Mesh | Istio | 1.21+ | mTLS, traffic management |
| CI/CD | GitHub Actions | latest | Build, test, deploy pipelines |
| Supply Chain | Sigstore + SLSA | L3 | Artifact signing, provenance |

### External Services

| Component | Technology | Purpose |
|---|---|---|
| Voice & SMS | Twilio | Outbound communications |
| Email | SendGrid | Transactional + marketing email |
| Calendar | Calendly API | Meeting scheduling |
| Enrichment | Clearbit / Apollo | Contact data enrichment |

---

## 7. Cross-Cutting Concerns

### Observability

Every service emits structured telemetry via **OpenTelemetry**:

- **Traces:** Distributed tracing with W3C Trace Context propagation across all services
- **Metrics:** RED metrics (Rate, Errors, Duration) per endpoint, per tenant
- **Logs:** Structured JSON logs with `tenant_id`, `request_id`, `trace_id` correlation
- **Alerts:** PagerDuty integration with severity-based routing and escalation

### Multi-Tenancy

Tenant isolation is enforced at every layer:

1. **Network:** Istio `AuthorizationPolicy` restricts cross-tenant traffic
2. **Application:** Middleware injects `tenant_id` from JWT into every request context
3. **Database:** PostgreSQL RLS policies filter all queries by `tenant_id`
4. **Cache:** Redis ACLs scope keys to `tenant:{id}:*` patterns
5. **Events:** Kafka topics partitioned by `tenant_id` hash
6. **Graph:** Neo4j property-level tenant filtering on every traversal

### Compliance Mapping

| Requirement | SOC 2 | ISO 27001 | HIPAA |
|---|---|---|---|
| Access Control | CC6.1-6.8 | A.9 | 164.312(a)(1) |
| Audit Logging | CC7.1-7.4 | A.12.4 | 164.312(b) |
| Encryption at Rest | CC6.7 | A.10.1 | 164.312(a)(2)(iv) |
| Encryption in Transit | CC6.7 | A.13.1 | 164.312(e)(1) |
| Incident Response | CC7.3-7.5 | A.16 | 164.308(a)(6) |
| Data Retention | CC6.5 | A.8.3 | 164.530(j) |
| Availability | CC9.1 | A.17 | 164.308(a)(7) |

---

## 8. Scalability Targets

| Metric | Target | Burst |
|---|---|---|
| API requests/sec | 10,000 | 50,000 |
| Events/sec (Kafka) | 100,000 | 500,000 |
| Graph queries/sec | 5,000 | 20,000 |
| Agent executions/min | 1,000 | 5,000 |
| Concurrent tenants | 500 | 2,000 |
| Data retention | 7 years (Iceberg) | — |

### Horizontal Scaling Strategy

- **API Tier:** Kubernetes HPA based on CPU/memory and custom metrics (request latency)
- **Worker Tier:** KEDA-based autoscaling tied to Kafka consumer lag
- **Database Tier:** Read replicas (PostgreSQL), shard expansion (ClickHouse), auto-scaling (Neo4j Aura)
- **Cache Tier:** Redis Cluster with automatic resharding

---

## 9. Failure Modes & Recovery

| Failure | Detection | Recovery | RTO |
|---|---|---|---|
| API pod crash | Kubernetes liveness probe | Auto-restart + HPA scale-up | < 30s |
| Database failover | RDS Multi-AZ heartbeat | Automatic failover to standby | < 60s |
| Kafka broker loss | Confluent health check | Partition reassignment (RF=3) | < 120s |
| Neo4j node failure | Aura monitoring | Cluster self-healing | < 90s |
| Redis node failure | Sentinel/Cluster detection | Automatic failover | < 10s |
| Region outage | Route 53 health check | DNS failover to DR region | < 300s |
| Vault seal event | Audit log + health check | Auto-unseal via KMS | < 60s |

---

*Next: [02-security-architecture.md](./02-security-architecture.md) — Zero-trust security model, Merkle DAG audit, post-quantum readiness*
