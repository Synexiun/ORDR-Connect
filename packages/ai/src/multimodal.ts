/**
 * Multi-Modal Processing — image, document, and audio input handling
 *
 * SECURITY (CLAUDE.md Rules 1, 4, 6, 7):
 * - File validation: MIME type verified against content magic bytes (Rule 4)
 * - Size limits enforced per media type (Rule 4)
 * - No PHI stored in processing pipeline: process -> use -> discard (Rule 6)
 * - Malware scan placeholder validates MIME vs actual content (Rule 4)
 * - All errors return safe messages, never expose internals (Rule 7)
 * - Supported formats: JPEG, PNG, PDF, DOCX, MP3, WAV
 *
 * SOC2 CC6.1 — Input validation and access controls.
 * HIPAA §164.312 — No PHI retained in processing pipeline.
 * ISO 27001 A.8.9 — Configuration management for allowed file types.
 */

import {
  type Result,
  ok,
  err,
  ValidationError,
  InternalError,
} from '@ordr/core';

// ─── Types ───────────────────────────────────────────────────────

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
export const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
export const SUPPORTED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav'] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];
export type SupportedDocumentType = (typeof SUPPORTED_DOCUMENT_TYPES)[number];
export type SupportedAudioType = (typeof SUPPORTED_AUDIO_TYPES)[number];
export type SupportedMimeType = SupportedImageType | SupportedDocumentType | SupportedAudioType;

export interface ImageAnalysis {
  readonly description: string;
  readonly labels: readonly string[];
  readonly confidence: number;
  readonly dimensions: { readonly width: number; readonly height: number } | null;
}

export interface DocumentAnalysis {
  readonly extractedText: string;
  readonly pageCount: number;
  readonly wordCount: number;
  readonly mimeType: string;
}

export interface AudioTranscription {
  readonly text: string;
  readonly durationSeconds: number;
  readonly language: string;
  readonly confidence: number;
}

// ─── Backend Interfaces ─────────────────────────────────────────

export interface ImageBackend {
  readonly analyze: (data: Buffer, mimeType: SupportedImageType) => Promise<Result<ImageAnalysis, InternalError>>;
}

export interface DocumentBackend {
  readonly extract: (data: Buffer, mimeType: SupportedDocumentType) => Promise<Result<DocumentAnalysis, InternalError>>;
}

export interface AudioBackend {
  readonly transcribe: (data: Buffer, mimeType: SupportedAudioType) => Promise<Result<AudioTranscription, InternalError>>;
}

// ─── Constants ───────────────────────────────────────────────────

/** Size limits per media type in bytes */
const SIZE_LIMITS = {
  image: 10 * 1024 * 1024,     // 10 MB
  document: 25 * 1024 * 1024,  // 25 MB
  audio: 50 * 1024 * 1024,     // 50 MB
} as const;

/**
 * Magic byte signatures for MIME type verification.
 * Used to validate that the content matches the declared MIME type.
 */
const MAGIC_BYTES: ReadonlyMap<string, readonly number[]> = new Map([
  ['image/jpeg', [0xFF, 0xD8, 0xFF]],
  ['image/png', [0x89, 0x50, 0x4E, 0x47]],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46]], // %PDF
  // DOCX is a ZIP file
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', [0x50, 0x4B, 0x03, 0x04]],
  // MP3 can start with ID3 tag or frame sync
  ['audio/mpeg', [0x49, 0x44, 0x33]], // ID3
  // WAV starts with RIFF
  ['audio/wav', [0x52, 0x49, 0x46, 0x46]], // RIFF
]);

/** Set of all supported MIME types */
const ALL_SUPPORTED_TYPES = new Set<string>([
  ...SUPPORTED_IMAGE_TYPES,
  ...SUPPORTED_DOCUMENT_TYPES,
  ...SUPPORTED_AUDIO_TYPES,
]);

// ─── Implementation ─────────────────────────────────────────────

export class MultiModalProcessor {
  private readonly imageBackend: ImageBackend;
  private readonly documentBackend: DocumentBackend;
  private readonly audioBackend: AudioBackend;

  constructor(deps: {
    readonly imageBackend: ImageBackend;
    readonly documentBackend: DocumentBackend;
    readonly audioBackend: AudioBackend;
  }) {
    this.imageBackend = deps.imageBackend;
    this.documentBackend = deps.documentBackend;
    this.audioBackend = deps.audioBackend;
  }

  /**
   * Process an image and return a description.
   *
   * SECURITY:
   * - MIME type validated against magic bytes (malware scan placeholder)
   * - Size limit enforced (10 MB)
   * - No PHI retained after processing — result is description only
   */
  async processImage(
    input: Buffer,
    mimeType: string,
  ): Promise<Result<ImageAnalysis, ValidationError | InternalError>> {
    // ── Validate ────────────────────────────────────────
    const validation = validateFile(input, mimeType, 'image');
    if (validation !== null) {
      return err(validation);
    }

    return this.imageBackend.analyze(input, mimeType as SupportedImageType);
  }

  /**
   * Process a document and extract text content.
   *
   * SECURITY:
   * - MIME type validated against magic bytes
   * - Size limit enforced (25 MB)
   * - Extracted text returned to caller — NOT stored in processing pipeline
   */
  async processDocument(
    input: Buffer,
    mimeType: string,
  ): Promise<Result<DocumentAnalysis, ValidationError | InternalError>> {
    const validation = validateFile(input, mimeType, 'document');
    if (validation !== null) {
      return err(validation);
    }

    return this.documentBackend.extract(input, mimeType as SupportedDocumentType);
  }

  /**
   * Process audio and return transcription.
   *
   * SECURITY:
   * - MIME type validated against magic bytes
   * - Size limit enforced (50 MB)
   * - Transcription returned to caller — audio buffer NOT retained
   */
  async processAudio(
    input: Buffer,
    mimeType: string,
  ): Promise<Result<AudioTranscription, ValidationError | InternalError>> {
    const validation = validateFile(input, mimeType, 'audio');
    if (validation !== null) {
      return err(validation);
    }

    return this.audioBackend.transcribe(input, mimeType as SupportedAudioType);
  }
}

// ─── Validation Helpers ─────────────────────────────────────────

/**
 * Validate a file input: MIME type, size, magic bytes.
 *
 * Returns null if valid, ValidationError if invalid.
 */
function validateFile(
  input: Buffer,
  mimeType: string,
  category: 'image' | 'document' | 'audio',
): ValidationError | null {
  // ── Check buffer is not empty ─────────────────────────
  if (input.length === 0) {
    return new ValidationError('File input must not be empty', { file: ['Empty buffer'] });
  }

  // ── Check MIME type is supported ──────────────────────
  if (!ALL_SUPPORTED_TYPES.has(mimeType)) {
    return new ValidationError(
      `Unsupported MIME type: ${mimeType}`,
      { mimeType: [`Supported types: ${Array.from(ALL_SUPPORTED_TYPES).join(', ')}`] },
    );
  }

  // ── Check category matches MIME type ──────────────────
  const categoryTypes = getCategoryTypes(category);
  if (!categoryTypes.has(mimeType)) {
    return new ValidationError(
      `MIME type ${mimeType} does not match expected category: ${category}`,
      { mimeType: [`Expected one of: ${Array.from(categoryTypes).join(', ')}`] },
    );
  }

  // ── Check size limit ──────────────────────────────────
  const sizeLimit = SIZE_LIMITS[category];
  if (input.length > sizeLimit) {
    const limitMB = sizeLimit / (1024 * 1024);
    return new ValidationError(
      `File size ${input.length} bytes exceeds ${limitMB}MB limit for ${category}`,
      { file: [`Maximum size is ${limitMB}MB`] },
    );
  }

  // ── Verify magic bytes (malware scan placeholder) ─────
  const magicBytesResult = verifyMagicBytes(input, mimeType);
  if (!magicBytesResult) {
    return new ValidationError(
      'File content does not match declared MIME type',
      { file: ['Magic bytes verification failed — possible MIME type mismatch'] },
    );
  }

  return null;
}

/**
 * Verify that the file's magic bytes match the declared MIME type.
 * This is a basic malware scan placeholder — in production, integrate
 * with a full malware scanning service (ClamAV, etc.).
 */
function verifyMagicBytes(input: Buffer, mimeType: string): boolean {
  const expected = MAGIC_BYTES.get(mimeType);
  if (expected === undefined) {
    // No magic bytes registered — allow (defense in depth at other layers)
    return true;
  }

  if (input.length < expected.length) {
    return false;
  }

  for (let i = 0; i < expected.length; i++) {
    if (input[i] !== expected[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Get the set of supported MIME types for a given category.
 */
function getCategoryTypes(category: 'image' | 'document' | 'audio'): ReadonlySet<string> {
  switch (category) {
    case 'image':
      return new Set<string>(SUPPORTED_IMAGE_TYPES);
    case 'document':
      return new Set<string>(SUPPORTED_DOCUMENT_TYPES);
    case 'audio':
      return new Set<string>(SUPPORTED_AUDIO_TYPES);
  }
}
