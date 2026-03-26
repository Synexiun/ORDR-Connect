/**
 * @ordr/audit — Immutable WORM Audit Logging
 *
 * SOC2 / ISO27001 / HIPAA compliant audit trail with:
 * - SHA-256 hash chains (tamper detection)
 * - Merkle tree batch verification (cryptographic proofs)
 * - Append-only storage (WORM enforcement)
 */

// Types
export type {
  AuditEventType,
  ActorType,
  AuditEvent,
  AuditChainStatus,
  MerkleRoot,
  MerkleProof,
} from './types.js';

// Hash chain
export {
  GENESIS_HASH,
  computeEventHash,
  verifyChainLink,
  verifyChain,
} from './hash-chain.js';

// Merkle tree
export {
  MERKLE_BATCH_SIZE,
  computeLeafHash,
  buildMerkleTree,
  computeMerkleRoot,
  generateMerkleProof,
  verifyMerkleProof,
} from './merkle-tree.js';

// Audit logger + store interface
export { AuditLogger } from './audit-logger.js';
export type { AuditStore, AuditEventInput } from './audit-logger.js';

// In-memory store (testing)
export { InMemoryAuditStore } from './in-memory-store.js';
