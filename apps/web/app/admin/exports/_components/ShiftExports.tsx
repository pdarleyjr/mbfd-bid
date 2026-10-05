'use client';

import { TaskPanel } from '@/components/admin/TaskPanel';
import { Button } from '@/components/ui/button';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef, useState } from 'react';

export type ShiftExportScope = 'A' | 'B' | 'C' | 'D' | 'ALL';
type ShiftExportFormat = 'pdf' | 'xlsx';
export type ShiftExportView = 'shift' | 'bid';

export function shiftExportScope(value: unknown): ShiftExportScope {
  return value === 'A' || value === 'B' || value === 'C' || value === 'D' ? value : 'ALL';
}

export function shiftExportHref(
  sessionId: string,
  scope: ShiftExportScope,
  format: ShiftExportFormat,
  view: ShiftExportView = 'bid',
): string {
  return `/api/admin/exports/${encodeURIComponent(sessionId)}/shifts?${new URLSearchParams({
    shift: scope,
    format,
    ...(view === 'shift' ? { view } : {}),
  })}`;
}

function downloadName(
  disposition: string | null,
  scope: ShiftExportScope,
  format: ShiftExportFormat,
) {
  const supplied = disposition?.match(/filename="([^"\r\n]+)"/i)?.[1];
  return supplied && /^[A-Za-z0-9_.-]+$/.test(supplied)
    ? supplied
    : `mbfd-bid-${scope.toLowerCase()}.${format}`;
}

async function exportError(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const code = body !== null && typeof body === 'object' && 'error' in body ? body.error : null;
  if (response.status === 401 || response.status === 403)
    return 'Your sign-in needs attention. Refresh the page, then try the download again.';
  if (response.status === 404)
    return 'This Bid session could not be found. Reopen it and try again.';
  if (code === 'browser_rendering_not_configured')
    return 'PDF export is unavailable. Try Excel, or retry PDF in a moment.';
  if (response.status === 409)
    return 'The Bid snapshot could not be read safely. Refresh the page and try again.';
  return `The download could not be prepared (${response.status}). Try again.`;
}

/** Direct exports read the current saved session without changing or publishing it. */
export function ShiftExports({
  sessionId,
  initialScope = 'ALL',
}: {
  sessionId: string;
  initialScope?: ShiftExportScope;
}) {
  const [scope, setScope] = useState<ShiftExportScope>(initialScope);
  const [format, setFormat] = useState<ShiftExportFormat>('pdf');
  const [view, setView] = useState<ShiftExportView>('shift');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);

  async function download() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(shiftExportHref(sessionId, scope, format, view), {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(await exportError(response));
      const expectedType =
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (!response.headers.get('content-type')?.toLowerCase().startsWith(expectedType))
        throw new Error('The server did not return the requested file. Try again.');
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('The exported file was empty. Try again.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadName(response.headers.get('content-disposition'), scope, format);
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Keep the object URL alive while the browser starts the file transfer.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({
        error: false,
        text: `${view === 'shift' ? 'Shift View' : 'Bid View'}: ${scope === 'ALL' ? 'All shifts' : scope === 'D' ? 'Days' : `${scope} Shift`} ${format === 'pdf' ? 'PDF' : 'Excel'} download started.`,
      });
    } catch (caught) {
      setNotice({
        error: true,
        text:
          caught instanceof TypeError
            ? 'The download could not be reached. Try again.'
            : caught instanceof Error
              ? caught.message
              : 'The download failed. Try again.',
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label="Shift exports" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {view === 'shift'
          ? 'Station boards with selected members, A-Days and open seats.'
          : 'Detailed selections, A-Days and open seats, grouped by station.'}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-col gap-1 text-sm font-semibold">
          View
          <select
            aria-label="Export view"
            value={view}
            disabled={busy}
            onChange={(event) => {
              setView(event.target.value === 'bid' ? 'bid' : 'shift');
              setNotice(null);
            }}
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
          >
            <option value="shift">Shift View</option>
            <option value="bid">Bid View</option>
          </select>
        </label>
        <label className="flex min-w-40 flex-col gap-1 text-sm font-semibold">
          Shifts
          <select
            aria-label="Export shifts"
            value={scope}
            disabled={busy}
            onChange={(event) => {
              setScope(shiftExportScope(event.target.value));
              setNotice(null);
            }}
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
          >
            <option value="ALL">All shifts</option>
            <option value="A">A Shift</option>
            <option value="B">B Shift</option>
            <option value="C">C Shift</option>
            <option value="D">Days</option>
          </select>
        </label>
        <label className="flex min-w-32 flex-col gap-1 text-sm font-semibold">
          Format
          <select
            aria-label="Export format"
            value={format}
            disabled={busy}
            onChange={(event) => {
              setFormat(event.target.value === 'xlsx' ? 'xlsx' : 'pdf');
              setNotice(null);
            }}
            className="min-h-11 rounded-md border border-input bg-background px-3 font-normal"
          >
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>
        </label>
        <Button type="button" disabled={busy} onClick={() => void download()}>
          {busy ? 'Preparing download…' : `Download ${format === 'pdf' ? 'PDF' : 'Excel'}`}
        </Button>
      </div>
      {notice ? (
        <p
          role={notice.error ? 'alert' : 'status'}
          className={`text-sm ${notice.error ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}

export function ShiftExportMenu({
  sessionId,
  currentShift = 'A',
}: { sessionId: string; currentShift?: ShiftExportScope }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    toggle.current?.focus();
  }
  return (
    <>
      <Button
        ref={toggle}
        type="button"
        size="sm"
        aria-label="Export shifts"
        onClick={() => setOpen(true)}
      >
        Export
      </Button>
      <TaskPanel
        open={open}
        onClose={close}
        title="Export shifts"
        description="Download this Mock or Real Bid at any point."
      >
        {open ? <ShiftExports sessionId={sessionId} initialScope={currentShift} /> : null}
        <Link
          className="mt-4 inline-flex min-h-11 items-center text-sm underline"
          href={
            `/admin/exports?${new URLSearchParams({ session_id: sessionId, shift: currentShift })}` as Route
          }
        >
          More reports
        </Link>
      </TaskPanel>
    </>
  );
}
