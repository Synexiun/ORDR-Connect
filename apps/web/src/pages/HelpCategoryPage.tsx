/**
 * HelpCategoryPage — Lists articles within a specific help category.
 *
 * COMPLIANCE:
 * - No PHI in help content (Rule 6)
 * - API calls use correlation IDs (Rule 3)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Spinner } from '../components/ui/Spinner';
import { ChevronLeft, ArrowUpRight, Clock } from '../components/icons';
import { fetchArticles, mockCategories, type HelpArticle } from '../lib/help-api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function HelpCategoryPage(): ReactNode {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const category = mockCategories.find((c) => c.id === categoryId);

  const loadArticles = useCallback(async () => {
    if (categoryId === undefined || categoryId === '') return;
    setLoading(true);
    try {
      const data = await fetchArticles(categoryId);
      setArticles(data);
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    void loadArticles();
  }, [loadArticles]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading articles" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[{ label: 'Help Center', href: '/help' }, { label: category?.name ?? 'Category' }]}
      />

      <div>
        <h1 className="page-title text-xl">{category?.name ?? 'Category'}</h1>
        {category && <p className="page-subtitle mt-1">{category.description}</p>}
      </div>

      {articles.length === 0 ? (
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-content-secondary">No articles in this category yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((article) => (
            <button
              key={article.id}
              onClick={() => navigate(`/help/article/${article.slug}`)}
              className="group w-full text-left"
            >
              <Card className="transition-all duration-200 group-hover:border-border-focus">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-content group-hover:text-brand-accent">
                      {article.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-content-secondary">
                      {article.content.slice(0, 200)}...
                    </p>
                    <div className="mt-2 flex items-center gap-3 text-xs text-content-tertiary">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(article.lastUpdated)}
                      </span>
                      <span>{article.helpfulYes} found helpful</span>
                    </div>
                  </div>
                  <ArrowUpRight className="mt-1 h-4 w-4 shrink-0 text-content-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Button variant="ghost" size="sm" onClick={() => navigate('/help')}>
        <ChevronLeft className="h-4 w-4" />
        Back to Help Center
      </Button>
    </div>
  );
}
