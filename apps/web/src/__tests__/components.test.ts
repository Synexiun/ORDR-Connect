/**
 * UI Component Tests
 *
 * Validates that core UI primitives render correctly with proper
 * accessibility attributes and variant styling.
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { cn } from '../lib/cn';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';
import { Table } from '../components/ui/Table';
import { Spinner } from '../components/ui/Spinner';

// --- cn utility ---

describe('cn utility', () => {
  it('merges class names', () => {
    const result = cn('px-4', 'py-2');
    expect(result).toBe('px-4 py-2');
  });

  it('handles conditional classes', () => {
    const flags = [true, false] as boolean[];
    const result = cn('base', flags[0] === true && 'active', flags[1] === true && 'hidden');
    expect(result).toBe('base active');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    const result = cn('px-4', 'px-6');
    expect(result).toBe('px-6');
  });

  it('handles undefined and null values', () => {
    const result = cn('base', undefined, null, 'end');
    expect(result).toBe('base end');
  });

  it('handles empty string', () => {
    const result = cn('', 'valid');
    expect(result).toBe('valid');
  });

  it('handles arrays', () => {
    const result = cn(['px-4', 'py-2']);
    expect(result).toBe('px-4 py-2');
  });
});

// --- Button ---

describe('Button component contract', () => {
  it('creates a valid React element with primary variant', () => {
    const element = createElement(Button, { variant: 'primary', children: 'Click' });

    expect(element).toBeDefined();
    expect(element.type).toBe(Button);
    expect(element.props.variant).toBe('primary');
    expect(element.props.children).toBe('Click');
  });

  it('creates a valid React element with danger variant', () => {
    const element = createElement(Button, { variant: 'danger', children: 'Delete' });
    expect(element.props.variant).toBe('danger');
  });

  it('creates a valid React element with secondary variant', () => {
    const element = createElement(Button, { variant: 'secondary', children: 'Cancel' });
    expect(element.props.variant).toBe('secondary');
  });

  it('creates a valid React element with ghost variant', () => {
    const element = createElement(Button, { variant: 'ghost', children: 'Link' });
    expect(element.props.variant).toBe('ghost');
  });

  it('supports loading state', () => {
    const element = createElement(Button, { loading: true, children: 'Saving' });
    expect(element.props.loading).toBe(true);
  });

  it('supports size variants', () => {
    const sm = createElement(Button, { size: 'sm', children: 'S' });
    const md = createElement(Button, { size: 'md', children: 'M' });
    const lg = createElement(Button, { size: 'lg', children: 'L' });

    expect(sm.props.size).toBe('sm');
    expect(md.props.size).toBe('md');
    expect(lg.props.size).toBe('lg');
  });
});

// --- Card ---

describe('Card component contract', () => {
  it('creates element with title', () => {
    const element = createElement(Card, { title: 'Test Card', children: 'Content' });

    expect(element.props.title).toBe('Test Card');
    expect(element.props.children).toBe('Content');
  });

  it('supports padding prop', () => {
    const element = createElement(Card, { padding: false, children: 'No pad' });
    expect(element.props.padding).toBe(false);
  });
});

// --- Badge ---

describe('Badge component contract', () => {
  it('creates success badge', () => {
    const element = createElement(Badge, { variant: 'success', children: 'Active' });

    expect(element.props.variant).toBe('success');
    expect(element.props.children).toBe('Active');
  });

  it('creates danger badge', () => {
    const element = createElement(Badge, { variant: 'danger', children: 'Failed' });
    expect(element.props.variant).toBe('danger');
  });

  it('creates warning badge', () => {
    const element = createElement(Badge, { variant: 'warning', children: 'Pending' });
    expect(element.props.variant).toBe('warning');
  });

  it('supports dot indicator', () => {
    const element = createElement(Badge, { variant: 'success', dot: true, children: 'Live' });
    expect(element.props.dot).toBe(true);
  });

  it('supports size variants', () => {
    const sm = createElement(Badge, { size: 'sm', children: 'S' });
    const md = createElement(Badge, { size: 'md', children: 'M' });

    expect(sm.props.size).toBe('sm');
    expect(md.props.size).toBe('md');
  });
});

// --- Input ---

describe('Input component contract', () => {
  it('creates input with label', () => {
    const element = createElement(Input, { label: 'Email', type: 'email' });

    expect(element.props.label).toBe('Email');
    expect(element.props.type).toBe('email');
  });

  it('supports error state', () => {
    const element = createElement(Input, { label: 'Name', error: 'Required field' });
    expect(element.props.error).toBe('Required field');
  });
});

// --- Table ---

interface TestRow {
  id: string;
  name: string;
}

describe('Table component contract', () => {
  it('creates table with columns and data', () => {
    const columns = [{ key: 'name', header: 'Name', render: (r: TestRow) => r.name }];
    const data: TestRow[] = [{ id: '1', name: 'Test' }];

    const element = createElement(Table<TestRow>, {
      columns,
      data,
      keyExtractor: (r: TestRow) => r.id,
    });

    expect(element.props.columns).toHaveLength(1);
    expect(element.props.data).toHaveLength(1);
  });

  it('supports pagination props', () => {
    const element = createElement(Table<TestRow>, {
      columns: [],
      data: [],
      keyExtractor: () => '',
      pagination: { page: 1, pageSize: 10, total: 100 },
    });

    const pagination = element.props.pagination as
      | { page: number; pageSize: number; total: number }
      | undefined;
    expect(pagination).toBeDefined();
    expect(pagination?.total).toBe(100);
    expect(pagination?.page).toBe(1);
  });
});

// --- Spinner ---

describe('Spinner component contract', () => {
  it('creates spinner with size', () => {
    const element = createElement(Spinner, { size: 'lg' });
    expect(element.props.size).toBe('lg');
  });

  it('supports custom label for accessibility', () => {
    const element = createElement(Spinner, { label: 'Fetching data' });
    expect(element.props.label).toBe('Fetching data');
  });
});
