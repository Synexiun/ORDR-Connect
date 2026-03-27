/**
 * ReportFilters — Horizontal filter panel for reports.
 *
 * Includes date range, report type select, search input, Apply/Reset buttons.
 *
 * COMPLIANCE: No PHI in filter parameters.
 */

import { type ReactNode } from 'react';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { Filter, X } from '../icons';
import type { ReportType } from '../../lib/reports-api';

// --- Props ---

export interface ReportFilterValues {
  dateStart: string;
  dateEnd: string;
  type: ReportType | '';
  search: string;
}

interface ReportFiltersProps {
  values: ReportFilterValues;
  onChange: (values: ReportFilterValues) => void;
  onApply: () => void;
  onReset: () => void;
}

// --- Report type options ---

const typeOptions = [
  { value: '', label: 'All Types' },
  { value: 'operations', label: 'Operations' },
  { value: 'agent-performance', label: 'Agent Performance' },
  { value: 'compliance-audit', label: 'Compliance Audit' },
  { value: 'channel-analytics', label: 'Channel Analytics' },
  { value: 'customer-health', label: 'Customer Health' },
  { value: 'revenue', label: 'Revenue' },
  { value: 'hipaa', label: 'HIPAA' },
  { value: 'sla', label: 'SLA' },
];

// --- Component ---

export function ReportFilters({
  values,
  onChange,
  onApply,
  onReset,
}: ReportFiltersProps): ReactNode {
  const update = (partial: Partial<ReportFilterValues>): void => {
    onChange({ ...values, ...partial });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-secondary p-4 sm:flex-row sm:items-end">
      {/* Date range */}
      <div className="flex items-end gap-2">
        <Input
          label="From"
          type="date"
          value={values.dateStart}
          onChange={(e) => {
            update({ dateStart: e.target.value });
          }}
          className="w-36"
        />
        <Input
          label="To"
          type="date"
          value={values.dateEnd}
          onChange={(e) => {
            update({ dateEnd: e.target.value });
          }}
          className="w-36"
        />
      </div>

      {/* Report type */}
      <div className="min-w-[160px]">
        <Select
          label="Report Type"
          options={typeOptions}
          value={values.type}
          onChange={(v) => {
            update({ type: v as ReportType | '' });
          }}
        />
      </div>

      {/* Search */}
      <div className="flex-1">
        <Input
          label="Search"
          placeholder="Search reports..."
          value={values.search}
          onChange={(e) => {
            update({ search: e.target.value });
          }}
        />
      </div>

      {/* Buttons */}
      <div className="flex items-end gap-2">
        <Button size="sm" icon={<Filter className="h-3.5 w-3.5" />} onClick={onApply}>
          Apply
        </Button>
        <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={onReset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
