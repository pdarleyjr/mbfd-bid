import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import type { ReactElement } from 'react';

import { ManualRetryButton } from './ManualRetryButton';

interface PortalBidRow {
  id: string;
  memberId: number;
  positionId: string;
  pickedAt: string;
  portalSyncStatus: string;
  portalSyncAttempts: number;
}

export function PortalSyncStatus({ bids }: { bids: PortalBidRow[] }): ReactElement {
  if (bids.length === 0) {
    return <p>All picks synced to portal.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Bid</TableHead>
          <TableHead>Member</TableHead>
          <TableHead>Position</TableHead>
          <TableHead>Picked</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempts</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bids.map((b) => (
          <TableRow key={b.id} data-testid={`portal-row-${b.id}`}>
            <TableCell>{b.id}</TableCell>
            <TableCell>{b.memberId}</TableCell>
            <TableCell>{b.positionId}</TableCell>
            <TableCell>{new Date(b.pickedAt).toLocaleString()}</TableCell>
            <TableCell className={`status-${b.portalSyncStatus}`}>{b.portalSyncStatus}</TableCell>
            <TableCell className="num">{b.portalSyncAttempts}</TableCell>
            <TableCell>
              <ManualRetryButton bidId={b.id} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
