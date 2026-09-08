'use client';
import { Button } from '@/components/ui/button';
import { helpForPath } from '@/lib/admin-manual';
import { CircleHelp } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { TaskPanel } from './TaskPanel';

/** Keyboard/touch-accessible task explanations on every administrator page. */
export function FeatureHelp() {
  const path = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  if (path === '/admin/docs' || path === '/admin/guide') return null;
  const topics = helpForPath(path);
  return (
    <div className="flex shrink-0 print:hidden">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={openPath === path}
        aria-label="How to use this page"
        onClick={() => setOpenPath(path)}
        className="gap-2"
      >
        <CircleHelp size={18} aria-hidden="true" />
        <span className="hidden lg:inline">How to use this page</span>
      </Button>
      <TaskPanel
        open={openPath === path}
        onClose={() => setOpenPath(null)}
        title="How to use this page"
        description="Instructions for the current task, its controls and the next steps."
      >
        <div className="space-y-5 text-sm leading-6">
          {topics.map((topic) => (
            <section key={topic.id}>
              <h2 className="font-semibold">{topic.title}</h2>
              <p>{topic.summary}</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                {topic.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="mt-3">
                <strong>Controls on this page: </strong>
                {topic.controls.join(' · ')}
              </p>
              {topic.important && (
                <p className="mt-2 rounded border border-border p-3">{topic.important}</p>
              )}
              <Link
                className="mt-2 inline-block underline"
                href={`/admin/docs#${topic.id}` as Route}
              >
                Read the full instructions
              </Link>
            </section>
          ))}
          {!topics.length && (
            <p>
              Review the selected member or bid context before editing. Required information and
              available actions are explained beside each form. Changes affecting approved
              selections require a reviewed correction.
            </p>
          )}
          <Link className="inline-block font-semibold underline" href={'/admin/docs' as Route}>
            Search Docs or download the complete manual
          </Link>
        </div>
      </TaskPanel>
    </div>
  );
}
