import { Button } from '@/components/ui/button';
interface Props {
  error: { code: string; message: string };
  onClose: () => void;
}

export function ErrorToast({ error, onClose }: Props) {
  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 rounded border border-red-700 bg-red-50 px-4 py-2 text-sm text-red-900"
    >
      <strong className="font-semibold">{error.code}</strong>: {error.message}
      <Button type="button" onClick={onClose} className="ml-3 underline">
        dismiss
      </Button>
    </div>
  );
}
