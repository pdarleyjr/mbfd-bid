'use client';
import { streamAdviseDeep } from '@/lib/ai-sse-client';
import { useState } from 'react';

export function AIAskDeepDialog({ bidSessionId }: { bidSessionId: string }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);

  async function submit() {
    setStreaming(true);
    setOutput('');
    try {
      for await (const ev of streamAdviseDeep({ sessionId: bidSessionId, question })) {
        if (ev.type === 'token') {
          setOutput((s) => s + ev.text);
        } else if (ev.type === 'done') {
          break;
        } else if (ev.type === 'error') {
          setOutput((s) => `${s}\n\n[error: ${ev.message}]`);
          break;
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="ai-ask-deep-trigger"
        onClick={() => setOpen(true)}
        className="text-sm underline"
      >
        Ask deeper question
      </button>
      {open && (
        <div
          className="fixed inset-0 bg-stone-950/50 flex items-center justify-center"
          // biome-ignore lint/a11y/useSemanticElements: lightweight modal — full dialog element is a Plan 09 polish
          role="dialog"
          aria-modal="true"
          aria-label="Ask the AI advisor"
        >
          <div className="bg-white rounded-lg p-6 w-[640px] max-w-[90vw] flex flex-col gap-3">
            <h3 className="font-semibold">Ask the AI advisor</h3>
            <textarea
              data-testid="ai-ask-deep-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="border rounded p-2 h-24"
            />
            <button
              type="button"
              data-testid="ai-ask-deep-submit"
              disabled={streaming}
              onClick={submit}
              className="bg-red-700 text-white rounded px-3 py-1 self-end"
            >
              Ask
            </button>
            <pre
              data-testid="ai-ask-deep-output"
              className="border rounded p-2 text-sm whitespace-pre-wrap min-h-[6em]"
            >
              {output}
            </pre>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-stone-500 self-end"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
