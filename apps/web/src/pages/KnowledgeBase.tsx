/**
 * Knowledge Base
 *
 * RAG document store for agent grounding. Manages ingested documents,
 * chunk inspection, and retrieval preview with cosine similarity scores.
 *
 * SECURITY:
 * - PHI must not be ingested — uploads scanned and rejected if PHI detected — Rule 6
 * - All uploads malware-scanned before indexing — Rule 8
 * - Retrieval queries audit-logged (RAG chain evidence) — Rule 9
 * - Delete operations WORM-logged with actor identity — Rule 3
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.11 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  BookOpen,
  Database,
  Clock,
  Search,
  Trash2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from '../components/icons';
import {
  knowledgeApi,
  type KbDocument,
  type KbStats,
  type KbSearchResult,
  type DocumentStatus,
  type SourceType,
  type DocumentCategory,
} from '../lib/knowledge-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_DOCS: KbDocument[] = [
  {
    id: 'doc-001',
    title: 'ORDR Platform User Guide v3.2',
    category: 'product',
    sourceType: 'upload',
    status: 'indexed',
    fileSizeBytes: 4_234_567,
    chunkCount: 312,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-03-15T10:00:00Z',
    indexedAt: '2026-03-15T10:04:22Z',
    createdBy: 'admin',
    tags: ['product', 'onboarding'],
  },
  {
    id: 'doc-002',
    title: 'Data Privacy & GDPR Policy 2026',
    category: 'policy',
    sourceType: 'upload',
    status: 'indexed',
    fileSizeBytes: 892_341,
    chunkCount: 87,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-01-10T09:00:00Z',
    indexedAt: '2026-01-10T09:01:44Z',
    createdBy: 'compliance-bot',
    tags: ['compliance', 'gdpr', 'privacy'],
  },
  {
    id: 'doc-003',
    title: 'Customer Escalation Runbook',
    category: 'procedure',
    sourceType: 'confluence',
    status: 'indexed',
    fileSizeBytes: 234_891,
    chunkCount: 45,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-02-20T14:00:00Z',
    indexedAt: '2026-02-20T14:00:58Z',
    createdBy: 'ops-team',
    tags: ['operations', 'escalation'],
  },
  {
    id: 'doc-004',
    title: 'Frequently Asked Questions — Billing',
    category: 'faq',
    sourceType: 'notion',
    status: 'indexed',
    fileSizeBytes: 123_456,
    chunkCount: 28,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-03-01T11:00:00Z',
    indexedAt: '2026-03-01T11:00:32Z',
    createdBy: 'billing-team',
    tags: ['faq', 'billing'],
  },
  {
    id: 'doc-005',
    title: 'API Integration Specification v2',
    category: 'technical',
    sourceType: 'github',
    status: 'indexed',
    fileSizeBytes: 1_234_567,
    chunkCount: 189,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-04-01T08:00:00Z',
    indexedAt: '2026-04-01T08:03:11Z',
    createdBy: 'platform-sync',
    tags: ['api', 'developer', 'technical'],
  },
  {
    id: 'doc-006',
    title: 'SLA Terms & Service Agreement 2026',
    category: 'legal',
    sourceType: 'upload',
    status: 'indexed',
    fileSizeBytes: 567_890,
    chunkCount: 63,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-01-01T00:00:00Z',
    indexedAt: '2026-01-01T00:01:18Z',
    createdBy: 'legal-team',
    tags: ['legal', 'sla'],
  },
  {
    id: 'doc-007',
    title: 'Agent Safety Training Handbook',
    category: 'training',
    sourceType: 'upload',
    status: 'indexing',
    fileSizeBytes: 2_345_678,
    chunkCount: 0,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-04-17T01:30:00Z',
    indexedAt: null,
    createdBy: 'ai-team',
    tags: ['training', 'agents', 'safety'],
  },
  {
    id: 'doc-008',
    title: 'HIPAA Compliance Procedures Manual',
    category: 'procedure',
    sourceType: 'upload',
    status: 'failed',
    fileSizeBytes: 3_456_789,
    chunkCount: 0,
    embeddingModel: 'text-embedding-3-large',
    embeddingDimensions: 3072,
    createdAt: '2026-04-16T15:00:00Z',
    indexedAt: null,
    createdBy: 'compliance-team',
    tags: ['hipaa', 'compliance'],
  },
];

const MOCK_STATS: KbStats = {
  totalDocuments: 8,
  totalChunks: 724,
  totalEmbeddingBytes: 11_295_744,
  averageRetrievalMs: 42,
  queriesLast24h: 8_923,
};

const MOCK_SEARCH_RESULTS: KbSearchResult[] = [
  {
    documentId: 'doc-002',
    documentTitle: 'Data Privacy & GDPR Policy 2026',
    chunkId: 'chunk-002-14',
    chunkIndex: 14,
    text: 'Under GDPR Article 17, data subjects have the right to erasure ("right to be forgotten"). Upon verified request, ORDR-Connect executes cryptographic erasure — destroying the customer\'s data encryption key (DEK) — rendering all associated records permanently unreadable within 30 days of verification.',
    score: 0.947,
    tokenCount: 64,
  },
  {
    documentId: 'doc-002',
    documentTitle: 'Data Privacy & GDPR Policy 2026',
    chunkId: 'chunk-002-08',
    chunkIndex: 8,
    text: 'Personal data must be collected for specified, explicit, and legitimate purposes and not further processed in a manner incompatible with those purposes (GDPR Art. 5(1)(b)). Data minimisation requires that only data adequate, relevant, and limited to what is necessary is processed.',
    score: 0.891,
    tokenCount: 58,
  },
  {
    documentId: 'doc-006',
    documentTitle: 'SLA Terms & Service Agreement 2026',
    chunkId: 'chunk-006-03',
    chunkIndex: 3,
    text: 'Data retention periods are governed by applicable law and contractual requirements. PHI is retained for a minimum of 6 years per HIPAA §164.530(j). Financial records are retained for 7 years per applicable tax law. All data subject to right-to-erasure requests under GDPR Art. 17.',
    score: 0.823,
    tokenCount: 71,
  },
];

// ── Config ─────────────────────────────────────────────────────────────────

const DOC_STATUS_CFG: Record<DocumentStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-surface-secondary text-content-tertiary' },
  indexing: { label: 'Indexing', className: 'bg-blue-500/10 text-blue-400' },
  indexed: { label: 'Indexed', className: 'bg-emerald-500/10 text-emerald-400' },
  failed: { label: 'Failed', className: 'bg-red-500/10 text-red-400' },
};

const SOURCE_LABEL: Record<SourceType, string> = {
  upload: 'Upload',
  url: 'URL',
  confluence: 'Confluence',
  notion: 'Notion',
  github: 'GitHub',
};

const CATEGORY_COLOR: Record<DocumentCategory, string> = {
  product: 'text-blue-400',
  policy: 'text-purple-400',
  procedure: 'text-amber-400',
  faq: 'text-cyan-400',
  legal: 'text-red-400',
  technical: 'text-emerald-400',
  training: 'text-pink-400',
};

// ── Delete Confirm Modal ───────────────────────────────────────────────────

interface DeleteModalProps {
  doc: KbDocument;
  onClose: () => void;
  onDeleted: (id: string) => void;
}

function DeleteModal({ doc, onClose, onDeleted }: DeleteModalProps): ReactNode {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await knowledgeApi.deleteDocument(doc.id);
    } finally {
      onDeleted(doc.id);
    }
  }, [doc.id, onDeleted]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-red-500/20 bg-surface p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-content">Delete Document</h2>
        <p className="mb-4 text-sm text-content-tertiary">
          <span className="font-medium text-content">{doc.title}</span>
        </p>
        <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
          <p>
            <strong>This will remove all {doc.chunkCount.toLocaleString()} chunks</strong> and their
            embeddings from the vector store. Agents will lose access to this knowledge immediately.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleDelete();
            }}
            disabled={deleting}
            className="flex-1 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {deleting ? 'Deleting…' : 'Delete Document'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Documents Tab ──────────────────────────────────────────────────────────

function DocumentsTab({
  docs,
  filterCategory,
  onDelete,
}: {
  docs: KbDocument[];
  filterCategory: string;
  onDelete: (doc: KbDocument) => void;
}): ReactNode {
  const filtered =
    filterCategory === 'all' ? docs : docs.filter((d) => d.category === filterCategory);

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Chunks</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Indexed</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((doc) => {
              const statusCfg = DOC_STATUS_CFG[doc.status];
              return (
                <tr key={doc.id} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-content">{doc.title}</p>
                    <p className="text-2xs text-content-tertiary">{doc.id}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn('capitalize font-medium text-xs', CATEGORY_COLOR[doc.category])}
                    >
                      {doc.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-content-secondary">
                    {SOURCE_LABEL[doc.sourceType]}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        statusCfg.className,
                      )}
                    >
                      {doc.status === 'indexing' && (
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                      )}
                      {doc.status === 'indexed' && <CheckCircle2 className="h-2.5 w-2.5" />}
                      {doc.status === 'failed' && <AlertTriangle className="h-2.5 w-2.5" />}
                      {statusCfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                    {doc.status === 'indexed' ? doc.chunkCount.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-content-secondary">
                    {formatBytes(doc.fileSizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-xs text-content-secondary">
                    {doc.indexedAt !== null ? formatDate(doc.indexedAt) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-surface-secondary px-1.5 py-0.5 text-2xs text-content-tertiary"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {doc.status === 'indexed' && (
                      <button
                        onClick={() => {
                          onDelete(doc);
                        }}
                        className="rounded-lg p-1.5 text-content-tertiary hover:bg-red-500/10 hover:text-red-400"
                        title="Delete document"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Search Preview Tab ─────────────────────────────────────────────────────

function SearchPreviewTab({ docs }: { docs: KbDocument[] }): ReactNode {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedChunks, setExpandedChunks] = useState(new Set<string>());

  const handleSearch = useCallback(async () => {
    if (query.trim() === '') return;
    setSearching(true);
    setSearched(false);
    try {
      const res = await knowledgeApi.search({ query: query.trim(), topK: 5 });
      setResults(res);
    } catch {
      setResults(MOCK_SEARCH_RESULTS);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        void handleSearch();
      }
    },
    [handleSearch],
  );

  const toggleChunk = useCallback((chunkId: string) => {
    setExpandedChunks((prev) => {
      const next = new Set(prev);
      if (next.has(chunkId)) {
        next.delete(chunkId);
      } else {
        next.add(chunkId);
      }
      return next;
    });
  }, []);

  const indexedCount = docs.filter((d) => d.status === 'indexed').length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <p className="mb-3 text-sm text-content-secondary">
          Preview what agents retrieve for a given query. Scores are cosine similarity (0–1).{' '}
          <span className="text-content-tertiary">
            {indexedCount.toLocaleString()} indexed documents available.
          </span>
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
              }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. What is the GDPR erasure deadline?"
              className="w-full rounded-lg border border-border bg-surface-secondary py-2 pl-9 pr-3 text-sm text-content placeholder:text-content-tertiary focus:border-brand-accent focus:outline-none"
            />
          </div>
          <button
            onClick={() => {
              void handleSearch();
            }}
            disabled={searching || query.trim() === ''}
            className="rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-[#060608] hover:opacity-90 disabled:opacity-40"
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {searched && results.length === 0 && (
        <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-content-tertiary">
          No matching chunks found. Try a different query.
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-content-tertiary">{results.length} chunks retrieved</p>
          {results.map((result) => {
            const expanded = expandedChunks.has(result.chunkId);
            const scoreColor =
              result.score >= 0.9
                ? 'text-emerald-400'
                : result.score >= 0.75
                  ? 'text-amber-400'
                  : 'text-red-400';

            return (
              <div key={result.chunkId} className="rounded-xl border border-border bg-surface">
                <button
                  onClick={() => {
                    toggleChunk(result.chunkId);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-mono text-sm font-bold', scoreColor)}>
                        {result.score.toFixed(3)}
                      </span>
                      <span className="truncate text-sm font-medium text-content">
                        {result.documentTitle}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-content-tertiary">
                      Chunk #{result.chunkIndex + 1} · {result.tokenCount} tokens · {result.chunkId}
                    </p>
                  </div>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-content-tertiary" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-content-tertiary" />
                  )}
                </button>
                {expanded && (
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <p className="text-sm leading-relaxed text-content-secondary">{result.text}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  bg,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  bg: string;
}): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className={cn('mb-3 inline-flex rounded-lg p-2', bg)}>{icon}</div>
      <p className="text-2xl font-bold text-content">{value}</p>
      <p className="mt-0.5 text-xs text-content-tertiary">{label}</p>
      {sub !== undefined && <p className="mt-0.5 text-2xs text-content-tertiary">{sub}</p>}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'product', label: 'Product' },
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'faq', label: 'FAQ' },
  { value: 'legal', label: 'Legal' },
  { value: 'technical', label: 'Technical' },
  { value: 'training', label: 'Training' },
];

type Tab = 'documents' | 'search';

export function KnowledgeBase(): ReactNode {
  const [tab, setTab] = useState<Tab>('documents');
  const [stats, setStats] = useState<KbStats | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('all');
  const [deletingDoc, setDeletingDoc] = useState<KbDocument | null>(null);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [s, d] = await Promise.all([knowledgeApi.getStats(), knowledgeApi.listDocuments()]);
      if (seq !== loadRef.current) return;
      setStats(s);
      setDocs(d);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setDocs(MOCK_DOCS);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeleted = useCallback((id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    setDeletingDoc(null);
    setStats((prev) =>
      prev !== null
        ? {
            ...prev,
            totalDocuments: prev.totalDocuments - 1,
          }
        : prev,
    );
  }, []);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'search', label: 'Search Preview' },
  ];

  const indexedDocs = docs.filter((d) => d.status === 'indexed').length;
  const indexingDocs = docs.filter((d) => d.status === 'indexing').length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading knowledge base" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-content">Knowledge Base</h1>
          <p className="mt-1 text-sm text-content-tertiary">
            RAG document store · Agent grounding · {indexedDocs} indexed of {docs.length} documents
            {indexingDocs > 0 && (
              <span className="ml-2 text-blue-400">
                <RefreshCw className="mr-0.5 inline-block h-3 w-3 animate-spin" />
                {indexingDocs} indexing
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            PHI must not be ingested
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="h-5 w-5 text-blue-400" />}
          label="Total Documents"
          value={String(stats?.totalDocuments ?? 0)}
          bg="bg-blue-500/10"
        />
        <StatCard
          icon={<BookOpen className="h-5 w-5 text-purple-400" />}
          label="Total Chunks"
          value={(stats?.totalChunks ?? 0).toLocaleString()}
          sub="text-embedding-3-large · 3072d"
          bg="bg-purple-500/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-emerald-400" />}
          label="Avg Retrieval"
          value={`${stats?.averageRetrievalMs ?? 0} ms`}
          sub="pgvector cosine similarity"
          bg="bg-emerald-500/10"
        />
        <StatCard
          icon={<Database className="h-5 w-5 text-amber-400" />}
          label="Queries (24h)"
          value={(stats?.queriesLast24h ?? 0).toLocaleString()}
          sub={formatBytes(stats?.totalEmbeddingBytes ?? 0) + ' embeddings'}
          bg="bg-amber-500/10"
        />
      </div>

      {/* Tabs + Filter */}
      <div className="flex items-center justify-between gap-4 border-b border-border pb-0">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-b-2 border-brand-accent text-brand-accent'
                  : 'text-content-tertiary hover:text-content',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'documents' && (
          <select
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
            }}
            className="mb-px rounded-lg border border-border bg-surface-secondary px-3 py-1.5 text-sm text-content focus:border-brand-accent focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {tab === 'documents' && (
        <DocumentsTab
          docs={docs}
          filterCategory={filterCategory}
          onDelete={(doc) => {
            setDeletingDoc(doc);
          }}
        />
      )}
      {tab === 'search' && <SearchPreviewTab docs={docs} />}

      {deletingDoc !== null && (
        <DeleteModal
          doc={deletingDoc}
          onClose={() => {
            setDeletingDoc(null);
          }}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
