import type { ColumnDef } from '@tanstack/react-table';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable } from '../../components/admin/DataTable';

interface Row {
  name: string;
}

describe('DataTable accessibility', () => {
  it('renders sortable headers as buttons inside column headers', () => {
    const columns: ColumnDef<Row>[] = [
      {
        accessorKey: 'name',
        header: 'Name',
      },
    ];

    const html = renderToString(<DataTable columns={columns} data={[{ name: 'Adams' }]} />);
    expect(html).toContain('<th');
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain('Name');
  });
});
