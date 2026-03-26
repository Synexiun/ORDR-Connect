/**
 * @ordr/audit — Merkle Tree for Batch Verification
 *
 * Provides cryptographic proof that a specific audit event exists within
 * a batch, without requiring the full batch to be available.
 *
 * Batch size: 1000 events per Merkle root.
 * Uses Node.js native `crypto` only.
 */

import { createHash } from 'node:crypto';
import type { AuditEvent, MerkleProof } from './types.js';

/** Generate a new Merkle root every 1000 events. */
export const MERKLE_BATCH_SIZE = 1000;

/**
 * Compute the leaf hash for a single audit event.
 * Leaf = SHA-256(event.hash) — double-hashing prevents second-preimage attacks.
 */
export function computeLeafHash(event: AuditEvent): string {
  return createHash('sha256').update(event.hash).digest('hex');
}

/**
 * Compute SHA-256 of two concatenated hashes (internal tree node).
 */
function hashPair(left: string, right: string): string {
  return createHash('sha256').update(left + right).digest('hex');
}

/**
 * Build a complete Merkle tree from leaf hashes.
 *
 * Returns array of levels: [leaves, level1, level2, ..., [root]].
 * Odd leaf counts are padded by duplicating the last leaf at that level.
 *
 * @param leaves - Array of leaf hashes
 * @returns Array of tree levels, bottom to top
 */
export function buildMerkleTree(leaves: ReadonlyArray<string>): string[][] {
  if (leaves.length === 0) {
    return [];
  }

  // Copy leaves into mutable working array
  const currentLevel: string[] = [...leaves];
  const tree: string[][] = [currentLevel];

  let level = currentLevel;
  while (level.length > 1) {
    const nextLevel: string[] = [];

    // Pad odd count by duplicating last element
    const working = level.length % 2 !== 0 ? [...level, level[level.length - 1]!] : level;

    for (let i = 0; i < working.length; i += 2) {
      nextLevel.push(hashPair(working[i]!, working[i + 1]!));
    }

    tree.push(nextLevel);
    level = nextLevel;
  }

  return tree;
}

/**
 * Convenience: compute the Merkle root for a batch of audit events.
 *
 * @param events - Array of audit events
 * @returns Hex-encoded Merkle root hash
 */
export function computeMerkleRoot(events: ReadonlyArray<AuditEvent>): string {
  if (events.length === 0) {
    return createHash('sha256').update('EMPTY_MERKLE_ROOT').digest('hex');
  }

  const leaves = events.map((e) => computeLeafHash(e));
  const tree = buildMerkleTree(leaves);
  const topLevel = tree[tree.length - 1]!;
  return topLevel[0]!;
}

/**
 * Generate a Merkle proof for a specific event within a batch.
 *
 * The proof consists of sibling hashes at each level, with their position
 * (left/right) so the verifier knows how to reconstruct the root.
 *
 * @param events - The full batch of events
 * @param targetIndex - Index of the event to prove (0-based)
 * @returns MerkleProof object
 */
export function generateMerkleProof(
  events: ReadonlyArray<AuditEvent>,
  targetIndex: number,
): MerkleProof {
  if (events.length === 0) {
    throw new Error('Cannot generate proof for empty event set');
  }

  if (targetIndex < 0 || targetIndex >= events.length) {
    throw new Error(
      `Target index ${String(targetIndex)} out of range [0, ${String(events.length - 1)}]`,
    );
  }

  const leaves = events.map((e) => computeLeafHash(e));
  const tree = buildMerkleTree(leaves);
  const proof: Array<{ hash: string; position: 'left' | 'right' }> = [];

  let currentIndex = targetIndex;

  // Walk up the tree, collecting sibling hashes
  for (let levelIdx = 0; levelIdx < tree.length - 1; levelIdx++) {
    const level = tree[levelIdx]!;

    // Pad odd levels the same way buildMerkleTree does
    const working = level.length % 2 !== 0 ? [...level, level[level.length - 1]!] : level;

    const isLeftChild = currentIndex % 2 === 0;
    const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;
    const sibling = working[siblingIndex]!;

    // If current node is left child, sibling is on the right, and vice versa
    proof.push({
      hash: sibling,
      position: isLeftChild ? 'right' : 'left',
    });

    // Move to parent index
    currentIndex = Math.floor(currentIndex / 2);
  }

  const root = tree[tree.length - 1]![0]!;
  const leaf = leaves[targetIndex]!;

  return { leaf, proof, root };
}

/**
 * Verify a Merkle proof by recomputing from the leaf up to the root.
 *
 * @param proof - The proof to verify
 * @returns true if the proof is valid (leaf is included in the claimed root)
 */
export function verifyMerkleProof(proof: MerkleProof): boolean {
  let currentHash = proof.leaf;

  for (const step of proof.proof) {
    if (step.position === 'left') {
      // Sibling is on the left
      currentHash = hashPair(step.hash, currentHash);
    } else {
      // Sibling is on the right
      currentHash = hashPair(currentHash, step.hash);
    }
  }

  return currentHash === proof.root;
}
