/**
 * @ordr/security — Military-grade security layer
 *
 * Exports:
 * - Types: ThreatAssessment, AttackIndicator, DLPFinding, SecurityEvent, etc.
 * - AnomalyDetector: EMA + Z-score behavioral anomaly detection
 * - ThreatScorer: Multi-signal per-request risk scoring (0–1000)
 * - AttackDetector: SQLi/XSS/path-traversal/SSRF/injection detection
 * - DLPScanner: PII/PHI/secrets response scanning
 * - SecurityEventBus: In-process security event streaming + SIEM correlation
 * - IPIntelligence: TOR detection, IP blocking, geo-velocity
 * - Honeypot: Decoy path detection
 */

export type {
  ThreatLevel,
  ThreatAction,
  ThreatSignal,
  ThreatAssessment,
  AnomalySignal,
  BehaviorBaseline,
  RequestObservation,
  AttackType,
  AttackIndicator,
  DLPDataType,
  DLPFinding,
  SecurityEventType,
  SecuritySeverity,
  SecurityEvent,
  IPBlock,
  GeoAccessRecord,
} from './types.js';

export { AnomalyDetector } from './anomaly-detector.js';
export { AttackDetector } from './attack-detector.js';
export { DLPScanner } from './dlp-scanner.js';
export { ThreatScorer } from './threat-scorer.js';
export type { ThreatScorerInput } from './threat-scorer.js';
export { SecurityEventBus } from './security-event-bus.js';
export type { SecurityEventHandler, SecurityCorrelation } from './security-event-bus.js';
export { IPIntelligence, isPrivateIP } from './ip-intelligence.js';
export { isHoneypotPath, HONEYPOT_PATHS, HONEYPOT_BLOCK_DURATION_MS } from './honeypot.js';
