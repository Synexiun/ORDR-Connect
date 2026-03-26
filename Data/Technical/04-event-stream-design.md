# ORDR-Connect — Event Stream Design

> **Classification:** Confidential — Internal Engineering
> **Compliance Scope:** SOC 2 Type II | ISO 27001:2022 | HIPAA
> **Last Updated:** 2026-03-24
> **Owner:** Platform Engineering

---

## 1. Event-Driven Architecture Overview

Every state mutation in ORDR-Connect is represented as an **immutable event** in Kafka.
This provides a complete, ordered, replayable history of every operation — satisfying
audit requirements (SOC 2 CC7.2, ISO 27001 A.12.4, HIPAA 164.312(b)) while enabling
real-time reactive processing across all six primitives.

### Design Principles

| Principle | Implementation |
|---|---|
| **Event First** | State changes emit events before returning success to caller |
| **Immutable Log** | Events are append-only, never modified or deleted from Kafka |
| **Schema Evolution** | Protobuf with Schema Registry, backward-compatible changes only |
| **Exactly-Once** | Kafka transactions + idempotent producers + consumer offset management |
| **Tenant Partitioning** | Events partitioned by `tenant_id` for ordering and isolation |
| **Replay Capability** | Any consumer can replay from any offset for recovery or reprocessing |

---

## 2. Kafka Topology

```mermaid
graph TB
    subgraph "Producers"
        API["API Service<br/>Transactional producer"]
        CDC["Debezium CDC<br/>WAL-based"]
        WEBHOOK["Webhook Ingress<br/>External events"]
        AGENT["Agent Runtime<br/>Action events"]
    end

    subgraph "Kafka Cluster — Confluent Cloud"
        subgraph "Core Topics"
            T_CMD["commands.*<br/>Inbound commands<br/>RF=3, partitions=tenant_count"]
            T_EVT["events.*<br/>Domain events<br/>RF=3, partitions=tenant_count"]
            T_CDC["cdc.*<br/>Change data capture<br/>RF=3, partitions=12"]
            T_AUDIT["audit.events<br/>Audit trail<br/>RF=3, retention=7y"]
        end

        subgraph "Derived Topics"
            T_GRAPH["graph.sync<br/>Neo4j mutations"]
            T_ANALYTICS["analytics.events<br/>ClickHouse sink"]
            T_EMBED["embeddings.update<br/>Vector recomputation"]
            T_ARCHIVE["archive.events<br/>Iceberg sink"]
            T_NOTIFY["notifications.*<br/>Delivery channel routing"]
        end

        subgraph "System Topics"
            T_DLQ["dlq.*<br/>Dead letter queue<br/>Alerting on arrival"]
            T_RETRY["retry.*<br/>Delayed retry<br/>Exponential backoff"]
            T_SCHEMA["_schemas<br/>Schema Registry<br/>Protobuf schemas"]
        end
    end

    subgraph "Consumer Groups"
        CG_GRAPH["graph-sync-cg<br/>Neo4j updater"]
        CG_ANALYTICS["analytics-cg<br/>ClickHouse writer"]
        CG_DECISION["decision-engine-cg<br/>Real-time scoring"]
        CG_AGENT["agent-trigger-cg<br/>Agent orchestrator"]
        CG_NOTIFY["notification-cg<br/>Delivery dispatcher"]
        CG_ARCHIVE["archive-cg<br/>Iceberg writer"]
        CG_AUDIT["audit-cg<br/>Merkle DAG builder"]
    end

    API --> T_CMD & T_EVT
    CDC --> T_CDC
    WEBHOOK --> T_EVT
    AGENT --> T_EVT & T_AUDIT

    T_EVT --> CG_GRAPH & CG_ANALYTICS & CG_DECISION & CG_AGENT
    T_CDC --> CG_GRAPH & CG_ANALYTICS
    T_CMD --> CG_DECISION
    T_EVT --> CG_NOTIFY
    T_EVT --> CG_ARCHIVE
    T_EVT --> CG_AUDIT
    T_AUDIT --> CG_AUDIT

    style T_CMD fill:#1a365d,stroke:#63b3ed,color:#fff
    style T_EVT fill:#1a365d,stroke:#63b3ed,color:#fff
    style T_AUDIT fill:#742a2a,stroke:#fc8181,color:#fff
    style T_DLQ fill:#744210,stroke:#f6e05e,color:#fff
```

### Topic Configuration

| Topic Pattern | Partitions | Replication | Retention | Cleanup Policy |
|---|---|---|---|---|
| `commands.*` | By tenant count | 3 | 7 days | delete |
| `events.*` | By tenant count | 3 | 30 days | delete |
| `cdc.*` | 12 per table | 3 | 7 days | delete |
| `audit.events` | 24 | 3 | 7 years | delete (+ Iceberg archive) |
| `graph.sync` | 12 | 3 | 3 days | delete |
| `analytics.events` | 24 | 3 | 7 days | delete |
| `dlq.*` | 6 | 3 | 30 days | delete |
| `retry.*` | 6 | 3 | 7 days | delete |

### Partition Strategy

Events are partitioned by `tenant_id` to guarantee **per-tenant ordering**:

```typescript
function partitionKey(event: DomainEvent): string {
  // Primary partition by tenant for ordering guarantee
  // Secondary partition by entity for high-volume tenants
  if (event.metadata.highVolume) {
    return `${event.tenantId}:${event.entityId}`;
  }
  return event.tenantId;
}
```

---

## 3. Event Schema Design

### Event Envelope

All events share a common envelope with domain-specific payload:

```protobuf
syntax = "proto3";
package ordr.events.v1;

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";

message EventEnvelope {
  // Identity
  string event_id = 1;            // UUIDv7 — time-ordered
  string correlation_id = 2;      // Request trace correlation
  string causation_id = 3;        // ID of event that caused this

  // Routing
  string tenant_id = 4;
  string event_type = 5;          // e.g., "customer.updated"
  int32  schema_version = 6;      // Schema version for evolution

  // Payload
  google.protobuf.Struct payload = 7;

  // Metadata
  string actor_id = 8;
  string actor_type = 9;          // "user", "service", "agent"
  string source_service = 10;
  google.protobuf.Timestamp occurred_at = 11;
  google.protobuf.Timestamp ingested_at = 12;

  // Integrity
  string content_hash = 13;       // SHA-256 of canonical payload
  string signature = 14;          // Ed25519 signature
}
```

### Event Flow Through the System

```mermaid
sequenceDiagram
    participant Client as API Client
    participant API as Hono API
    participant VAL as Schema Validator
    participant TX as Kafka Producer (Tx)
    participant PG as PostgreSQL
    participant KF as Kafka
    participant SR as Schema Registry
    participant CG1 as Graph Sync Consumer
    participant CG2 as Analytics Consumer
    participant CG3 as Decision Engine Consumer
    participant DLQ as Dead Letter Queue

    Client->>API: POST /customers/{id} (update)
    API->>VAL: Validate request (Zod)
    VAL-->>API: Valid

    Note over API,PG: Transactional Outbox Pattern
    API->>PG: BEGIN transaction
    API->>PG: UPDATE customers SET ... WHERE id = $1
    API->>PG: INSERT INTO outbox (event_type, payload, ...)
    API->>PG: COMMIT

    Note over TX,KF: Outbox Relay (Debezium)
    TX->>PG: Poll outbox table (CDC)
    TX->>SR: Validate against Protobuf schema
    SR-->>TX: Schema OK (version 3)
    TX->>KF: Produce to events.customer.updated

    par Parallel Consumer Processing
        KF->>CG1: Consume → Update Neo4j graph
        KF->>CG2: Consume → Insert into ClickHouse
        KF->>CG3: Consume → Trigger scoring pipeline
    end

    alt Consumer Failure
        CG1->>CG1: Retry 3x with backoff
        CG1->>DLQ: Send to dlq.graph-sync after exhaustion
        DLQ->>DLQ: Alert on-call engineer
    end
```

### Domain Event Types

| Domain | Event Type | Trigger |
|---|---|---|
| **Customer** | `customer.created` | New customer record |
| **Customer** | `customer.updated` | Profile or attribute change |
| **Customer** | `customer.health_changed` | Health score threshold crossed |
| **Deal** | `deal.stage_changed` | Pipeline stage transition |
| **Deal** | `deal.closed_won` | Deal marked as won |
| **Deal** | `deal.closed_lost` | Deal marked as lost |
| **Ticket** | `ticket.created` | New support ticket |
| **Ticket** | `ticket.escalated` | Priority escalation |
| **Ticket** | `ticket.resolved` | Resolution recorded |
| **Interaction** | `interaction.received` | Inbound communication |
| **Interaction** | `interaction.sent` | Outbound communication |
| **Agent** | `agent.execution.started` | Agent begins work |
| **Agent** | `agent.execution.completed` | Agent finishes |
| **Agent** | `agent.action.executed` | Agent performs an action |
| **Decision** | `decision.score.computed` | ML/rules score calculated |
| **Decision** | `decision.action.recommended` | Next-best-action selected |
| **Audit** | `audit.access.granted` | Authorization check passed |
| **Audit** | `audit.access.denied` | Authorization check failed |

---

## 4. Event Sourcing & CQRS

### Event Sourcing Pattern

For critical domains (Customer Lifecycle, Deal Pipeline), ORDR-Connect maintains
an **event-sourced** model where the current state is derived from replaying events:

```typescript
interface EventSourcedAggregate<TState, TEvent> {
  id: string;
  tenantId: string;
  version: number;
  state: TState;

  apply(event: TEvent): TState;
  rehydrate(events: TEvent[]): TState;
}

// Example: Customer aggregate
class CustomerAggregate implements EventSourcedAggregate<CustomerState, CustomerEvent> {
  apply(event: CustomerEvent): CustomerState {
    switch (event.type) {
      case 'customer.created':
        return { ...this.state, ...event.payload, lifecycle: 'new' };
      case 'customer.health_changed':
        return { ...this.state, healthScore: event.payload.newScore };
      case 'customer.churned':
        return { ...this.state, lifecycle: 'churned', churnedAt: event.occurredAt };
      default:
        return this.state;
    }
  }

  rehydrate(events: CustomerEvent[]): CustomerState {
    return events.reduce((state, event) => this.apply(event), initialState);
  }
}
```

### CQRS Separation

| Concern | Write Side | Read Side |
|---|---|---|
| Store | PostgreSQL (event store + projections) | ClickHouse, Neo4j, Redis |
| Consistency | Strong (ACID transactions) | Eventual (via Kafka consumers) |
| Latency | p99 < 50ms | p99 < 100ms (cached: < 5ms) |
| Scaling | Vertical + read replicas | Horizontal (independent per store) |

---

## 5. Schema Evolution Strategy

### Rules

1. **Backward compatible only:** New consumers must read old events, old consumers must tolerate new fields
2. **No field removal:** Fields can be deprecated (ignored) but never removed from the Protobuf schema
3. **No type changes:** A field's type is immutable once published
4. **Additive only:** New optional fields, new event types — never breaking changes
5. **Version tracking:** Every event carries `schema_version` for routing to version-aware handlers

### Schema Registry Workflow

```
1. Developer adds new field to .proto file
2. CI runs: confluent schema-registry test --compatibility BACKWARD
3. If compatible → merge PR, register new schema version
4. If incompatible → block PR, require new event type instead
5. Consumers use schema version to route to correct handler
```

---

## 6. Exactly-Once Semantics

### Producer Side

```typescript
const producer = kafka.producer({
  idempotent: true,
  transactionalId: `ordr-api-${process.env.POD_NAME}`,
  maxInFlightRequests: 5,
});

async function publishWithTransaction(events: DomainEvent[]): Promise<void> {
  const transaction = await producer.transaction();
  try {
    for (const event of events) {
      await transaction.send({
        topic: `events.${event.domain}.${event.type}`,
        messages: [{
          key: event.tenantId,
          value: await serialize(event),
          headers: {
            'event-id': event.eventId,
            'correlation-id': event.correlationId,
            'schema-version': String(event.schemaVersion),
          },
        }],
      });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}
```

### Consumer Side

```typescript
const consumer = kafka.consumer({
  groupId: 'decision-engine-cg',
  readUncommitted: false,  // Only read committed messages
});

// Idempotent processing with deduplication
async function processEvent(event: DomainEvent): Promise<void> {
  const dedupeKey = `processed:${event.eventId}`;
  const alreadyProcessed = await redis.get(dedupeKey);
  if (alreadyProcessed) return; // Skip duplicate

  await handleEvent(event);

  // Mark as processed with TTL matching topic retention
  await redis.set(dedupeKey, '1', 'EX', 7 * 24 * 3600);
}
```

---

## 7. Dead Letter Queue & Retry

```mermaid
graph LR
    subgraph "Normal Flow"
        KF["Kafka Topic"] --> CONSUMER["Consumer"]
        CONSUMER --> PROCESS["Process Event"]
    end

    subgraph "Failure Handling"
        PROCESS -->|"failure"| RETRY1["Retry 1<br/>1 sec delay"]
        RETRY1 -->|"failure"| RETRY2["Retry 2<br/>5 sec delay"]
        RETRY2 -->|"failure"| RETRY3["Retry 3<br/>30 sec delay"]
        RETRY3 -->|"failure"| DLQ["Dead Letter Queue<br/>dlq.{consumer-group}"]
    end

    subgraph "DLQ Processing"
        DLQ --> ALERT["PagerDuty Alert<br/>P2 severity"]
        DLQ --> DASHBOARD["DLQ Dashboard<br/>Manual review"]
        DASHBOARD --> REPLAY["Manual Replay<br/>After fix applied"]
        REPLAY --> KF
    end

    style DLQ fill:#742a2a,stroke:#fc8181,color:#fff
    style ALERT fill:#744210,stroke:#f6e05e,color:#fff
```

### Retry Configuration

| Attempt | Delay | Max Attempts | After Exhaustion |
|---|---|---|---|
| 1 | 1 second | — | — |
| 2 | 5 seconds | — | — |
| 3 | 30 seconds | 3 | Send to DLQ |

### DLQ Monitoring

- **Alert:** PagerDuty P2 on any DLQ message arrival
- **Dashboard:** Grafana panel showing DLQ depth, age, and event type distribution
- **SLA:** DLQ must be drained within 4 hours during business hours
- **Audit:** Every DLQ event logged in audit trail (compliance requirement)

---

## 8. Event Replay & Temporal Queries

### Replay Use Cases

| Use Case | Method | Scope |
|---|---|---|
| **Consumer recovery** | Reset consumer group offset | Single consumer group |
| **State reconstruction** | Replay from beginning | Single aggregate |
| **Backfill new consumer** | Create new consumer group at earliest offset | All events |
| **Point-in-time query** | Replay events up to timestamp T | Single aggregate at time T |
| **Bug fix reprocessing** | Reset offset to before bug introduction | Affected consumer group |

### Temporal Query Implementation

```typescript
async function getCustomerStateAtTime(
  customerId: string,
  tenantId: string,
  asOf: Date,
): Promise<CustomerState> {
  // Fetch all events for this customer up to the requested time
  const events = await eventStore.getEvents({
    aggregateId: customerId,
    tenantId,
    before: asOf,
    orderBy: 'occurred_at ASC',
  });

  // Replay to reconstruct state at that point in time
  const aggregate = new CustomerAggregate(customerId, tenantId);
  return aggregate.rehydrate(events);
}
```

---

## 9. Backpressure Handling

| Layer | Mechanism | Action |
|---|---|---|
| **Producer** | Buffer memory limit (32MB) | Block send until buffer drains |
| **Kafka** | Quota per client (MB/s, requests/s) | Throttle producer/consumer |
| **Consumer** | Max poll records (500) | Process batch then poll next |
| **Processing** | Concurrency semaphore (per partition) | Limit parallel handlers |
| **Downstream** | Circuit breaker (Opossum) | Open circuit on >50% error rate for 30s |

### Circuit Breaker Configuration

```typescript
import CircuitBreaker from 'opossum';

const clickhouseBreaker = new CircuitBreaker(insertToClickHouse, {
  timeout: 5000,        // 5 second timeout per call
  errorThresholdPercentage: 50,
  resetTimeout: 30000,  // Try again after 30 seconds
  volumeThreshold: 10,  // Minimum 10 calls before tripping
});

clickhouseBreaker.on('open', () => {
  logger.warn('ClickHouse circuit breaker OPEN — buffering events');
  metrics.increment('circuit_breaker.open', { service: 'clickhouse' });
});
```

---

## 10. Compliance — Event Stream

| Requirement | SOC 2 | ISO 27001 | HIPAA | Implementation |
|---|---|---|---|---|
| Audit Trail Integrity | CC7.2 | A.12.4.1 | 164.312(b) | Content hashing, Merkle chain |
| Event Retention | CC6.5 | A.8.3.2 | 164.530(j) | 7-year Iceberg archival |
| Encryption in Transit | CC6.7 | A.13.1.1 | 164.312(e)(1) | SASL + TLS for all Kafka |
| Access Control | CC6.1 | A.9.2 | 164.312(a)(1) | Kafka ACLs per tenant + service |
| Replay Auditability | CC7.2 | A.12.4.1 | 164.312(b) | Replay operations logged |
| PHI in Events | — | — | 164.312(a)(2)(iv) | PHI fields encrypted before publish |

---

*Next: [05-customer-graph.md](./05-customer-graph.md) — Customer Graph design with Neo4j*
