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
    <table>
      <thead>
        <tr>
          <th>Bid</th>
          <th>Member</th>
          <th>Position</th>
          <th>Picked</th>
          <th>Status</th>
          <th>Attempts</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {bids.map((b) => (
          <tr key={b.id} data-testid={`portal-row-${b.id}`}>
            <td>{b.id}</td>
            <td>{b.memberId}</td>
            <td>{b.positionId}</td>
            <td>{new Date(b.pickedAt).toLocaleString()}</td>
            <td className={`status-${b.portalSyncStatus}`}>{b.portalSyncStatus}</td>
            <td className="num">{b.portalSyncAttempts}</td>
            <td>
              <ManualRetryButton bidId={b.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
