/**
 * Security Package — Shared Types
 *
 * Type definitions for the military-grade security layer covering:
 * anomaly detection, threat scoring, attack detection, DLP, and security events.
 *
 * SOC2 CC6.7 — Restriction of unauthorized software: type-safe threat modelling.
 * ISO 27001 A.12.6.1 — Management of technical vulnerabilities.
 * HIPAA §164.312(a)(1) — Access control: detect and block unauthorized access.
 */

// ─── Threat Scoring ────────────────────────────────────────────────────────

/**
 * Composite threat level derived from the 0–1000 total score.
 *
 * none     (0–199)   : benign traffic — allow
 * low      (200–399) : minor indicators — allow + log
 * medium   (400–599) : moderate risk — alert + log
 * high     (600–799) : significant threat — challenge (adaptive rate limit)
 * critical (800–1000): confirmed attack — block immediately
 */
export type ThreatLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

/** Action the middleware enforces based on the ThreatAssessment. */
export type ThreatAction = 'allow' | 'monitor' | 'challenge' | 'block';

/** Individual threat signal contributing to the composite score. */
export interface ThreatSignal {
  readonly name: string;
  /** Contribution to the 0–1000 composite score. */
  readonly score: number;
  readonly reason: string;
}

/** Per-request threat assessment produced by ThreatScorer. */
export interface ThreatAssessment {
  readonly requestId: string;
  readonly tenantId: string | undefined;
  readonly threatLevel: ThreatLevel;
  /** Composite score 0–1000; higher = more dangerous. */
  readonly totalScore: number;
  readonly signals: readonly ThreatSignal[];
  readonly action: ThreatAction;
  readonly timestamp: Date;
}

// ─── Anomaly Detection ─────────────────────────────────────────────────────

/** Behavioral anomaly signal produced by AnomalyDetector. */
export interface AnomalySignal {
  readonly metric: 'request_rate' | 'error_rate' | 'data_volume' | 'payload_size';
  readonly observed: number;
  /** Exponential Moving Average baseline. */
  readonly baseline: number;
  /** Standard deviations from baseline (Welford Z-score). */
  readonly zScore: number;
  readonly isAnomaly: boolean;
}

/**
 * Per-tenant behavior baseline maintained by AnomalyDetector.
 * Uses EMA for baselines and Welford's online algorithm for variance.
 */
export interface BehaviorBaseline {
  readonly tenantId: string;
  emaRequestRate: number; // requests/minute
  emaErrorRate: number; // errors/minute
  emaDataVolume: number; // response bytes/minute
  emaPayloadSize: number; // average request bytes
  // Welford running variance (M2 term)
  m2RequestRate: number;
  m2ErrorRate: number;
  m2DataVolume: number;
  m2PayloadSize: number;
  meanRequestRate: number;
  meanErrorRate: number;
  meanDataVolume: number;
  meanPayloadSize: number;
  sampleCount: number;
  // Rolling window tracking
  windowRequestCount: number;
  windowErrorCount: number;
  windowDataBytes: number;
  windowStart: number; // epoch ms
  lastUpdated: Date;
}

/** Observation recorded per request for anomaly tracking. */
export interface RequestObservation {
  readonly tenantId: string;
  readonly isError: boolean;
  readonly responseBytes: number;
  readonly requestBytes: number;
}

// ─── Attack Detection ──────────────────────────────────────────────────────

export type AttackType =
  | 'sqli'
  | 'xss'
  | 'path_traversal'
  | 'ssrf'
  | 'command_injection'
  | 'xxe'
  | 'open_redirect'
  | 'mass_assignment'
  | 'prototype_pollution'
  | 'nosql_injection'
  | 'ldap_injection'
  | 'header_injection';

/** Attack indicator found by AttackDetector. */
export interface AttackIndicator {
  readonly type: AttackType;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  readonly location: 'url' | 'header' | 'body' | 'query';
  readonly pattern: string;
  /** Truncated matched string (max 64 chars) for logging — NEVER log full payload. */
  readonly matched: string;
}

// ─── Data Loss Prevention ──────────────────────────────────────────────────

export type DLPDataType =
  | 'ssn'
  | 'credit_card'
  | 'phone'
  | 'date_of_birth'
  | 'medical_record_number'
  | 'api_key'
  | 'jwt_token'
  | 'private_key'
  | 'password_hash'
  | 'aws_key'
  | 'gcp_key';

/** PII/PHI/secret finding in response body. */
export interface DLPFinding {
  readonly type: DLPDataType;
  readonly severity: 'low' | 'medium' | 'high' | 'critical';
  /** Redacted placeholder for audit logging — never the actual value. */
  readonly redacted: string;
  /** Character offset in the scanned text. */
  readonly offset: number;
}

// ─── Security Events ────────────────────────────────────────────────────────

export type SecurityEventType =
  | 'attack.sqli'
  | 'attack.xss'
  | 'attack.path_traversal'
  | 'attack.ssrf'
  | 'attack.command_injection'
  | 'attack.xxe'
  | 'attack.open_redirect'
  | 'attack.mass_assignment'
  | 'anomaly.request_rate'
  | 'anomaly.error_rate'
  | 'anomaly.data_volume'
  | 'honeypot.triggered'
  | 'auth.replay_attack'
  | 'auth.fingerprint_mismatch'
  | 'auth.brute_force'
  | 'dlp.pii_in_response'
  | 'dlp.phi_in_response'
  | 'dlp.secret_in_response'
  | 'threat.ip_blocked'
  | 'threat.high_score'
  | 'threat.critical_blocked'
  | 'scan.vulnerability_probe';

export type SecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

/** Internal security event emitted to the SecurityEventBus. */
export interface SecurityEvent {
  readonly id: string;
  readonly type: SecurityEventType;
  readonly severity: SecuritySeverity;
  readonly tenantId: string | undefined;
  readonly actorId: string | undefined;
  readonly ip: string;
  readonly userAgent: string;
  readonly requestId: string;
  readonly path: string;
  readonly details: Record<string, unknown>;
  readonly timestamp: Date;
}

// ─── IP Intelligence ────────────────────────────────────────────────────────

export interface IPBlock {
  readonly ip: string;
  readonly reason: string;
  readonly blockedAt: Date;
  readonly expiresAt: Date;
}

export interface GeoAccessRecord {
  readonly userId: string;
  readonly ip: string;
  readonly timestamp: Date;
}
