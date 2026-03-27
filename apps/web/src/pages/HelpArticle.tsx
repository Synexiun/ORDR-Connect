/**
 * HelpArticle — Single article viewer with feedback and related articles.
 *
 * COMPLIANCE:
 * - No PHI in help content (Rule 6)
 * - Feedback submissions use correlation ID (Rule 3)
 * - Error fallback to mock data (Rule 7)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Spinner } from '../components/ui/Spinner';
import { CheckCircle2, Clock, ChevronLeft, ArrowUpRight } from '../components/icons';
import {
  fetchArticle,
  submitFeedback,
  mockArticles,
  mockCategories,
  type HelpArticle as HelpArticleType,
} from '../lib/help-api';

// --- Helpers ---

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Render article content as formatted HTML paragraphs.
 * Content uses plain text with double-newlines for paragraph breaks.
 * No user-generated HTML is rendered — only structured text from our content system.
 */
function renderContent(content: string): ReactNode {
  const paragraphs = content.split('\n\n').filter((p) => p.trim());

  return (
    <div className="space-y-4">
      {paragraphs.map((para, idx) => {
        // Detect list items (lines starting with - or *)
        const lines = para.split('\n');
        const isList = lines.every((l) => l.trim().startsWith('-') || l.trim().startsWith('*'));

        if (isList) {
          return (
            <ul key={idx} className="list-disc space-y-1.5 pl-5">
              {lines.map((line, li) => (
                <li key={li} className="text-sm leading-relaxed text-content-secondary">
                  {line.replace(/^[-*]\s*/, '')}
                </li>
              ))}
            </ul>
          );
        }

        // Detect inline code (backtick-wrapped)
        const parts = para.split(/(`[^`]+`)/);
        return (
          <p key={idx} className="text-sm leading-relaxed text-content-secondary">
            {parts.map((part, pi) => {
              if (part.startsWith('`') && part.endsWith('`')) {
                return (
                  <code
                    key={pi}
                    className="rounded bg-surface-tertiary px-1.5 py-0.5 text-xs font-mono text-content"
                  >
                    {part.slice(1, -1)}
                  </code>
                );
              }
              return <span key={pi}>{part}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}

// --- Component ---

export function HelpArticlePage(): ReactNode {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [article, setArticle] = useState<HelpArticleType | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackGiven, setFeedbackGiven] = useState<'yes' | 'no' | null>(null);

  const loadArticle = useCallback(async () => {
    if (slug === undefined || slug === '') return;
    setLoading(true);
    try {
      const data = await fetchArticle(slug);
      setArticle(data);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void loadArticle();
    setFeedbackGiven(null);
  }, [loadArticle]);

  const handleFeedback = useCallback(
    async (helpful: boolean) => {
      if (!article || feedbackGiven) return;
      setFeedbackGiven(helpful ? 'yes' : 'no');
      await submitFeedback(article.id, helpful);
    },
    [article, feedbackGiven],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading article" />
      </div>
    );
  }

  if (!article) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/help')}>
          <ChevronLeft className="h-4 w-4" />
          Back to Help Center
        </Button>
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-content-secondary">Article not found.</p>
        </div>
      </div>
    );
  }

  // Find category name
  const category = mockCategories.find((c) => c.id === article.category);
  const categoryName = category?.name ?? 'Help';

  // Related articles
  const relatedArticles = article.relatedArticles
    .map((rSlug) => mockArticles.find((a) => a.slug === rSlug))
    .filter((a): a is HelpArticleType => a !== undefined);

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Help Center', href: '/help' },
          { label: categoryName, href: `/help/category/${article.category}` },
          { label: article.title },
        ]}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Main content */}
        <div className="lg:col-span-3">
          <Card>
            <div className="space-y-6">
              {/* Title and meta */}
              <div>
                <h1 className="page-title text-xl">{article.title}</h1>
                <div className="mt-2 flex items-center gap-3 text-xs text-content-tertiary">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Last updated {formatDate(article.lastUpdated)}
                  </span>
                </div>
              </div>

              {/* Article content */}
              <div className="border-t border-border pt-6">{renderContent(article.content)}</div>

              {/* Feedback */}
              <div className="border-t border-border pt-6">
                <div className="flex items-center gap-4">
                  <p className="text-sm font-medium text-content">Was this article helpful?</p>
                  {feedbackGiven ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-400">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Thanks for your feedback!</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void handleFeedback(true)}>
                        Yes ({article.helpfulYes})
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleFeedback(false)}>
                        No ({article.helpfulNo})
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Back link */}
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/help')}>
              <ChevronLeft className="h-4 w-4" />
              Back to Help Center
            </Button>
          </div>
        </div>

        {/* Sidebar — Related Articles */}
        <div className="lg:col-span-1">
          <Card title="Related Articles">
            {relatedArticles.length === 0 ? (
              <p className="text-xs text-content-tertiary">No related articles.</p>
            ) : (
              <div className="space-y-3">
                {relatedArticles.map((ra) => (
                  <button
                    key={ra.id}
                    onClick={() => navigate(`/help/article/${ra.slug}`)}
                    className="group flex w-full items-start gap-2 text-left"
                  >
                    <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-tertiary group-hover:text-brand-accent" />
                    <span className="text-xs font-medium text-content-secondary transition-colors group-hover:text-content">
                      {ra.title}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
