interface Props {
  status: 'connecting' | 'closed';
}

export function ReconnectingOverlay({ status }: Props) {
  return (
    <div className="fixed bottom-4 right-4 rounded bg-stone-900 px-4 py-2 text-sm text-stone-50">
      {status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
    </div>
  );
}
