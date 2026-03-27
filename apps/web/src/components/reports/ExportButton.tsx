/**
 * ExportButton — Dropdown button for exporting reports in CSV, PDF, or JSON.
 *
 * Uses the existing Dropdown component pattern with Download icon trigger.
 *
 * COMPLIANCE: Export triggers server-side generation with audit logging.
 * No PHI is rendered in the button or dropdown items.
 */

import { type ReactNode } from 'react';
import { Dropdown } from '../ui/Dropdown';
import { Button } from '../ui/Button';
import { Download, FileText } from '../icons';
import type { ReportFormat } from '../../lib/reports-api';

// --- Props ---

interface ExportButtonProps {
  onExport: (format: ReportFormat) => void;
  disabled?: boolean;
}

// --- Component ---

export function ExportButton({ onExport, disabled = false }: ExportButtonProps): ReactNode {
  if (disabled) {
    return (
      <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />} disabled>
        Export
      </Button>
    );
  }

  return (
    <Dropdown
      trigger={
        <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
          Export
        </Button>
      }
      items={[
        {
          label: 'Export as CSV',
          icon: <FileText className="h-4 w-4" />,
          onClick: () => {
            onExport('csv');
          },
        },
        {
          label: 'Export as PDF',
          icon: <FileText className="h-4 w-4" />,
          onClick: () => {
            onExport('pdf');
          },
        },
        {
          label: 'Export as JSON',
          icon: <FileText className="h-4 w-4" />,
          onClick: () => {
            onExport('json');
          },
        },
      ]}
      align="right"
    />
  );
}
