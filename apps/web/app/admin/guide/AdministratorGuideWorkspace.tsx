'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  GUIDE_CATEGORIES,
  GUIDE_SECTIONS,
  type GuideSection,
  filterGuideSections,
} from './guide-content';

const ALL_CATEGORIES = 'All topics';

function GuideSectionPanel({
  section,
  expanded,
  onToggle,
}: { section: GuideSection; expanded: boolean; onToggle: () => void }) {
  const panelId = `${section.id}-details`;
  return (
    <article id={section.id} className="scroll-mt-6 border-b border-slate-700 py-5 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-300">
            {section.category}
          </p>
          <h2 className="mt-1 font-heading text-xl text-white">{section.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{section.summary}</p>
        </div>
        <Link
          href={section.route as Route}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-slate-600 px-3 text-sm font-semibold text-slate-100 transition-colors hover:border-slate-400 hover:bg-slate-800"
        >
          Open {section.routeLabel}
        </Link>
      </div>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-slate-800 px-3 text-sm font-semibold text-white transition-colors hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
      >
        {expanded ? 'Hide details' : 'Show how to use it'}
      </button>

      {expanded ? (
        <div
          id={panelId}
          className="mt-4 grid gap-5 rounded-md border border-slate-700 bg-slate-900/60 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]"
        >
          <div>
            <h3 className="font-semibold text-white">How to use it</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-300">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-white">Buttons and controls</h3>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${section.title} controls`}>
                {section.controls.map((control) => (
                  <li
                    key={control}
                    className="rounded-full border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-slate-200"
                  >
                    {control}
                  </li>
                ))}
              </ul>
            </div>
            {section.important ? (
              <aside
                className="rounded-md border border-amber-500/60 bg-amber-950/35 p-3 text-sm leading-6 text-amber-50"
                aria-label={`${section.title} important`}
              >
                <strong className="block font-semibold">Important</strong>
                {section.important}
              </aside>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function AdministratorGuideWorkspace() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [expanded, setExpanded] = useState<string | null>('getting-started');
  const matches = useMemo(() => filterGuideSections(query), [query]);
  const visible =
    category === ALL_CATEGORIES ? matches : matches.filter((item) => item.category === category);

  function selectCategory(nextCategory: string) {
    setCategory(nextCategory);
    setExpanded(null);
  }

  return (
    <main
      aria-labelledby="administrator-guide-heading"
      className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
    >
      <header className="border-b border-slate-700 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-300">
          MBFD Bid · Administrator Help Center
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1
              id="administrator-guide-heading"
              className="font-heading text-3xl text-white sm:text-4xl"
            >
              Administrator Guide
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Find a page, understand its controls, and follow the safe operating path without
              digging through one long instruction document.
            </p>
          </div>
          <label className="block w-full max-w-xl">
            <span className="sr-only">Search the Administrator Guide</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder="Search TeleStaff, retire member, change bid order, specialty, hold presentation, CSV…"
              className="min-h-11 w-full rounded-md border border-slate-600 bg-slate-900 px-3 text-sm text-white placeholder:text-slate-400 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/30"
            />
          </label>
        </div>
      </header>

      <section aria-label="Guide categories" className="py-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg text-white">Browse by task</h2>
          <p className="text-sm text-slate-400" aria-live="polite">
            {visible.length} {visible.length === 1 ? 'topic' : 'topics'}
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[ALL_CATEGORIES, ...GUIDE_CATEGORIES].map((item) => {
            const selected = item === category;
            const count =
              item === ALL_CATEGORIES
                ? GUIDE_SECTIONS.length
                : GUIDE_SECTIONS.filter((section) => section.category === item).length;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={selected}
                onClick={() => selectCategory(item)}
                className={[
                  'min-h-12 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400',
                  selected
                    ? 'border-red-500 bg-red-700 text-white'
                    : 'border-slate-700 bg-slate-800/60 text-slate-100 hover:border-slate-500 hover:bg-slate-800',
                ].join(' ')}
              >
                <span className="block">{item}</span>
                <span
                  className={
                    selected ? 'text-xs text-red-100' : 'text-xs font-normal text-slate-400'
                  }
                >
                  {count} topics
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 border-t border-slate-700 pt-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Guide sections" className="lg:sticky lg:top-4 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            In this guide
          </p>
          <ul className="mt-2 flex max-h-48 gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
            {visible.map((section) => (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  onClick={() => setExpanded(section.id)}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400 lg:flex"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section aria-label="Administrator Guide topics">
          {visible.length > 0 ? (
            visible.map((section) => (
              <GuideSectionPanel
                key={section.id}
                section={section}
                expanded={expanded === section.id}
                onToggle={() =>
                  setExpanded((current) => (current === section.id ? null : section.id))
                }
              />
            ))
          ) : (
            <div className="rounded-md border border-slate-700 bg-slate-800/60 p-5">
              <h2 className="font-heading text-xl text-white">No guide topic found</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Try a page name, a control name, or a shorter phrase such as “TeleStaff,”
                “specialty,” or “CSV.”
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory(ALL_CATEGORIES);
                }}
                className="mt-4 min-h-11 rounded-md border border-slate-500 px-3 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Clear search
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
