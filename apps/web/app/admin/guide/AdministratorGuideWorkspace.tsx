'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { buildAdministratorManual } from '@/lib/admin-manual';
import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
    <article id={section.id} className="scroll-mt-6 border-b border-border py-5 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-destructive">
            {section.category}
          </p>
          <h2 className="mt-1 font-heading text-xl text-foreground">{section.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground">{section.summary}</p>
        </div>
        <Link
          href={section.route as Route}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:border-border hover:bg-card"
        >
          Open {section.routeLabel}
        </Link>
      </div>

      <Button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="mt-4 inline-flex min-h-11 items-center rounded-md bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {expanded ? 'Hide details' : 'Show how to use it'}
      </Button>

      {expanded ? (
        <div
          id={panelId}
          className="mt-4 grid gap-5 rounded-md border border-border bg-card p-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]"
        >
          <div>
            <h3 className="font-semibold text-foreground">How to use it</h3>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground">
              {section.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-foreground">Buttons and controls</h3>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label={`${section.title} controls`}>
                {section.controls.map((control) => (
                  <li
                    key={control}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-foreground"
                  >
                    {control}
                  </li>
                ))}
              </ul>
            </div>
            {section.important ? (
              <aside
                className="rounded-md border border-warning/40 bg-warning-surface p-3 text-sm leading-6 text-warning"
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
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && GUIDE_SECTIONS.some((s) => s.id === id)) {
      setExpanded(id);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
    }
  }, []);
  function downloadManual() {
    const url = URL.createObjectURL(
      new Blob([buildAdministratorManual()], { type: 'text/html;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'MBFD-Bid-Complete-Administrator-Manual.html';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
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
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <a
          href="/manual/MBFD-Bid-Administrator-Manual.pdf"
          download
          className="inline-flex min-h-11 items-center rounded border border-border px-4 py-2 font-semibold underline"
        >
          Download complete manual (PDF)
        </a>
        <Button type="button" onClick={downloadManual}>
          Download complete manual (HTML)
        </Button>
        <p className="text-sm text-muted-foreground">
          Both downloads work offline. The PDF and this Docs page use the same complete
          instructions.
        </p>
      </div>
      <header className="border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-destructive">
          MBFD Bid · Administrator Help Center
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1
              id="administrator-guide-heading"
              className="font-heading text-3xl text-foreground sm:text-4xl"
            >
              Docs & Administrator Manual
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-foreground">
              Find a page, understand its controls, and follow the safe operating path without
              digging through one long instruction document.
            </p>
          </div>
          <Label className="block w-full max-w-xl">
            <span className="sr-only">Search the Administrator Guide</span>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              type="search"
              placeholder="Search TeleStaff, retire member, change bid order, specialty, hold presentation, CSV…"
              className="min-h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-destructive/40 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </Label>
        </div>
      </header>

      <section aria-label="Guide categories" className="py-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg text-foreground">Browse by task</h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
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
              <Button
                key={item}
                type="button"
                aria-pressed={selected}
                onClick={() => selectCategory(item)}
                className={[
                  'min-h-12 rounded-md border px-3 py-2 text-left text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  selected
                    ? 'border-destructive/40 bg-destructive text-primary-foreground'
                    : 'border-border bg-card text-foreground hover:border-border hover:bg-card',
                ].join(' ')}
              >
                <span className="block">{item}</span>
                <span
                  className={
                    selected
                      ? 'text-xs text-destructive'
                      : 'text-xs font-normal text-muted-foreground'
                  }
                >
                  {count} topics
                </span>
              </Button>
            );
          })}
        </div>
      </section>

      <div className="grid gap-6 border-t border-border pt-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Guide sections" className="lg:sticky lg:top-4 lg:self-start">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            In this guide
          </p>
          <ul className="mt-2 flex max-h-48 gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
            {visible.map((section) => (
              <li key={section.id} className="shrink-0">
                <a
                  href={`#${section.id}`}
                  onClick={() => setExpanded(section.id)}
                  className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-foreground hover:bg-card hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:flex"
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
            <div className="rounded-md border border-border bg-card p-5">
              <h2 className="font-heading text-xl text-foreground">No guide topic found</h2>
              <p className="mt-2 text-sm leading-6 text-foreground">
                Try a page name, a control name, or a shorter phrase such as “TeleStaff,”
                “specialty,” or “CSV.”
              </p>
              <Button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory(ALL_CATEGORIES);
                }}
                className="mt-4 min-h-11 rounded-md border border-border px-3 text-sm font-semibold text-foreground hover:bg-muted"
              >
                Clear search
              </Button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
