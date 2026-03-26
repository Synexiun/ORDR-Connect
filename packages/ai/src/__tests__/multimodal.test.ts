import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr, ok, err, InternalError } from '@ordr/core';
import type {
  ImageBackend,
  DocumentBackend,
  AudioBackend,
  ImageAnalysis,
  DocumentAnalysis,
  AudioTranscription,
} from '../multimodal.js';
import {
  MultiModalProcessor,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_DOCUMENT_TYPES,
  SUPPORTED_AUDIO_TYPES,
} from '../multimodal.js';

// ─── Magic Byte Helpers ─────────────────────────────────────────

/** Build a buffer with correct magic bytes for the given MIME type + padding */
function makeBuffer(mimeType: string, sizeBytes: number = 1024): Buffer {
  const magicBytes: Record<string, number[]> = {
    'image/jpeg': [0xFF, 0xD8, 0xFF, 0xE0],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'application/pdf': [0x25, 0x50, 0x44, 0x46],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4B, 0x03, 0x04],
    'audio/mpeg': [0x49, 0x44, 0x33],
    'audio/wav': [0x52, 0x49, 0x46, 0x46],
  };

  const magic = magicBytes[mimeType] ?? [0x00];
  const buf = Buffer.alloc(Math.max(sizeBytes, magic.length));
  for (let i = 0; i < magic.length; i++) {
    buf[i] = magic[i]!;
  }
  return buf;
}

// ─── Mock Backends ──────────────────────────────────────────────

function createMockImageBackend(): ImageBackend {
  const mockAnalysis: ImageAnalysis = {
    description: 'A photo of a document',
    labels: ['document', 'text', 'paper'],
    confidence: 0.92,
    dimensions: { width: 1920, height: 1080 },
  };
  return {
    analyze: vi.fn().mockResolvedValue(ok(mockAnalysis)),
  };
}

function createMockDocumentBackend(): DocumentBackend {
  const mockExtraction: DocumentAnalysis = {
    extractedText: 'Invoice for services rendered.',
    pageCount: 3,
    wordCount: 150,
    mimeType: 'application/pdf',
  };
  return {
    extract: vi.fn().mockResolvedValue(ok(mockExtraction)),
  };
}

function createMockAudioBackend(): AudioBackend {
  const mockTranscription: AudioTranscription = {
    text: 'Hello, I need help with my account.',
    durationSeconds: 12.5,
    language: 'en',
    confidence: 0.88,
  };
  return {
    transcribe: vi.fn().mockResolvedValue(ok(mockTranscription)),
  };
}

function createProcessor(overrides: {
  imageBackend?: ImageBackend;
  documentBackend?: DocumentBackend;
  audioBackend?: AudioBackend;
} = {}): MultiModalProcessor {
  return new MultiModalProcessor({
    imageBackend: overrides.imageBackend ?? createMockImageBackend(),
    documentBackend: overrides.documentBackend ?? createMockDocumentBackend(),
    audioBackend: overrides.audioBackend ?? createMockAudioBackend(),
  });
}

// ─── Image Processing Tests ─────────────────────────────────────

describe('MultiModalProcessor.processImage', () => {
  let processor: MultiModalProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = createProcessor();
  });

  it('returns image description for valid JPEG', async () => {
    const result = await processor.processImage(makeBuffer('image/jpeg'), 'image/jpeg');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.description).toBe('A photo of a document');
      expect(result.data.labels).toContain('document');
      expect(result.data.confidence).toBeGreaterThan(0);
    }
  });

  it('returns image description for valid PNG', async () => {
    const result = await processor.processImage(makeBuffer('image/png'), 'image/png');
    expect(isOk(result)).toBe(true);
  });

  it('returns dimensions when available', async () => {
    const result = await processor.processImage(makeBuffer('image/jpeg'), 'image/jpeg');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.dimensions).toEqual({ width: 1920, height: 1080 });
    }
  });

  it('rejects unsupported MIME type', async () => {
    const result = await processor.processImage(makeBuffer('image/jpeg'), 'image/gif');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Unsupported MIME type');
    }
  });

  it('rejects image exceeding 10MB size limit', async () => {
    const bigBuffer = makeBuffer('image/jpeg', 11 * 1024 * 1024);
    const result = await processor.processImage(bigBuffer, 'image/jpeg');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('exceeds');
      expect(result.error.message).toContain('10MB');
    }
  });

  it('rejects empty buffer', async () => {
    const result = await processor.processImage(Buffer.alloc(0), 'image/jpeg');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('must not be empty');
    }
  });

  it('rejects mismatched magic bytes', async () => {
    // Create a PNG buffer but declare it as JPEG
    const pngBuffer = makeBuffer('image/png');
    const result = await processor.processImage(pngBuffer, 'image/jpeg');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('does not match');
    }
  });

  it('returns error when backend fails', async () => {
    const failingBackend: ImageBackend = {
      analyze: vi.fn().mockResolvedValue(err(new InternalError('Vision API down'))),
    };
    const proc = createProcessor({ imageBackend: failingBackend });
    const result = await proc.processImage(makeBuffer('image/jpeg'), 'image/jpeg');
    expect(isErr(result)).toBe(true);
  });
});

// ─── Document Processing Tests ──────────────────────────────────

describe('MultiModalProcessor.processDocument', () => {
  let processor: MultiModalProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = createProcessor();
  });

  it('extracts text from valid PDF', async () => {
    const result = await processor.processDocument(makeBuffer('application/pdf'), 'application/pdf');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.extractedText).toContain('Invoice');
      expect(result.data.pageCount).toBe(3);
      expect(result.data.wordCount).toBe(150);
    }
  });

  it('extracts text from valid DOCX', async () => {
    const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const result = await processor.processDocument(makeBuffer(docxMime), docxMime);
    expect(isOk(result)).toBe(true);
  });

  it('rejects documents exceeding 25MB size limit', async () => {
    const bigBuffer = makeBuffer('application/pdf', 26 * 1024 * 1024);
    const result = await processor.processDocument(bigBuffer, 'application/pdf');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('25MB');
    }
  });

  it('rejects unsupported document MIME type', async () => {
    const result = await processor.processDocument(makeBuffer('application/pdf'), 'text/plain');
    expect(isErr(result)).toBe(true);
  });

  it('rejects audio MIME type in document processor', async () => {
    const result = await processor.processDocument(makeBuffer('audio/mpeg'), 'audio/mpeg');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('does not match expected category');
    }
  });

  it('returns error when backend fails', async () => {
    const failingBackend: DocumentBackend = {
      extract: vi.fn().mockResolvedValue(err(new InternalError('Extraction failed'))),
    };
    const proc = createProcessor({ documentBackend: failingBackend });
    const result = await proc.processDocument(makeBuffer('application/pdf'), 'application/pdf');
    expect(isErr(result)).toBe(true);
  });
});

// ─── Audio Processing Tests ─────────────────────────────────────

describe('MultiModalProcessor.processAudio', () => {
  let processor: MultiModalProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = createProcessor();
  });

  it('transcribes valid MP3 audio', async () => {
    const result = await processor.processAudio(makeBuffer('audio/mpeg'), 'audio/mpeg');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.text).toContain('Hello');
      expect(result.data.durationSeconds).toBe(12.5);
      expect(result.data.language).toBe('en');
      expect(result.data.confidence).toBeGreaterThan(0);
    }
  });

  it('transcribes valid WAV audio', async () => {
    const result = await processor.processAudio(makeBuffer('audio/wav'), 'audio/wav');
    expect(isOk(result)).toBe(true);
  });

  it('rejects audio exceeding 50MB size limit', async () => {
    const bigBuffer = makeBuffer('audio/mpeg', 51 * 1024 * 1024);
    const result = await processor.processAudio(bigBuffer, 'audio/mpeg');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('50MB');
    }
  });

  it('rejects unsupported audio MIME type', async () => {
    const result = await processor.processAudio(makeBuffer('audio/mpeg'), 'audio/ogg');
    expect(isErr(result)).toBe(true);
  });

  it('rejects image MIME type in audio processor', async () => {
    const result = await processor.processAudio(makeBuffer('image/jpeg'), 'image/jpeg');
    expect(isErr(result)).toBe(true);
  });

  it('returns error when backend fails', async () => {
    const failingBackend: AudioBackend = {
      transcribe: vi.fn().mockResolvedValue(err(new InternalError('Transcription failed'))),
    };
    const proc = createProcessor({ audioBackend: failingBackend });
    const result = await proc.processAudio(makeBuffer('audio/mpeg'), 'audio/mpeg');
    expect(isErr(result)).toBe(true);
  });
});

// ─── Supported Types ────────────────────────────────────────────

describe('Supported types constants', () => {
  it('exports correct image types', () => {
    expect(SUPPORTED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png']);
  });

  it('exports correct document types', () => {
    expect(SUPPORTED_DOCUMENT_TYPES).toContain('application/pdf');
    expect(SUPPORTED_DOCUMENT_TYPES).toHaveLength(2);
  });

  it('exports correct audio types', () => {
    expect(SUPPORTED_AUDIO_TYPES).toEqual(['audio/mpeg', 'audio/wav']);
  });
});
