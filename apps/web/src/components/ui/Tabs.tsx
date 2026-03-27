import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface TabDef {
  id: string;
  label: string;
  icon?: ReactNode;
}

type TabVariant = 'underline' | 'pill';

interface TabsProps {
  tabs: TabDef[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: TabVariant;
  className?: string;
}

interface TabPanelProps {
  id: string;
  activeTab: string;
  children: ReactNode;
  className?: string;
}

const underlineStyles = {
  container: 'border-b border-border',
  tab: 'px-4 py-2.5 text-sm font-medium transition-colors duration-150',
  active: 'border-b-2 border-brand-accent text-content',
  inactive: 'text-content-secondary hover:text-content',
};

const pillStyles = {
  container: 'inline-flex gap-1 rounded-lg bg-surface-tertiary p-1',
  tab: 'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
  active: 'bg-surface-secondary text-content shadow-sm',
  inactive: 'text-content-secondary hover:text-content',
};

export function Tabs({
  tabs,
  activeTab,
  onChange,
  variant = 'underline',
  className,
}: TabsProps): ReactNode {
  const styles = variant === 'underline' ? underlineStyles : pillStyles;

  return (
    <div className={cn(styles.container, className)} role="tablist" aria-orientation="horizontal">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => {
              onChange(tab.id);
            }}
            className={cn(
              styles.tab,
              'inline-flex items-center gap-2',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent/50',
              isActive ? styles.active : styles.inactive,
            )}
          >
            {tab.icon !== undefined && tab.icon !== null && tab.icon !== false && (
              <span className="shrink-0" aria-hidden="true">
                {tab.icon}
              </span>
            )}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, activeTab, children, className }: TabPanelProps): ReactNode {
  if (id !== activeTab) return null;

  return (
    <div
      id={`panel-${id}`}
      role="tabpanel"
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
      className={className}
    >
      {children}
    </div>
  );
}
