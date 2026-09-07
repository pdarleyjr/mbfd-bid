'use client';
import { helpForPath } from '@/lib/admin-manual';
import { CircleHelp } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Keyboard/touch-accessible task explanations on every administrator page. */
export function FeatureHelp() {
  const path = usePathname();
  if (path === '/admin/docs' || path === '/admin/guide') return null;
  const topics = helpForPath(path);
  return (
    <details key={path} className="mb-6 rounded-lg border border-border bg-card p-4 print:hidden">
      <summary className="flex min-h-8 cursor-pointer items-center gap-2 text-sm font-semibold">
        <CircleHelp size={18} aria-hidden="true" />
        How to use this page
      </summary>
      <div className="mt-4 space-y-5 text-sm leading-6">
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
            <Link className="mt-2 inline-block underline" href={`/admin/docs#${topic.id}` as Route}>
              Read the full instructions
            </Link>
          </section>
        ))}
        {!topics.length && (
          <p>
            Review the selected member or bid context before editing. Required information and
            available actions are explained beside each form. Changes affecting approved selections
            require a reviewed correction.
          </p>
        )}
        <Link className="inline-block font-semibold underline" href={'/admin/docs' as Route}>
          Search Docs or download the complete manual
        </Link>
      </div>
    </details>
  );
}
