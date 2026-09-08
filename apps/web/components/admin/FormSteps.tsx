'use client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Children, type ReactNode, useEffect, useRef, useState } from 'react';

/** Keep all fields mounted (and validated) while showing one manageable task. */
export function FormSteps({ labels, children }: { labels: string[]; children: ReactNode }) {
  const [step, setStep] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (validationTimer.current) clearTimeout(validationTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (
      Number(pendingFocus.current?.closest('[data-form-step]')?.getAttribute('data-form-step')) ===
      step
    ) {
      pendingFocus.current?.focus();
    }
  }, [step]);
  return (
    <div
      className="space-y-3"
      onInvalidCapture={(event) => {
        const target = event.target as HTMLInputElement;
        const index = Number(target.closest('[data-form-step]')?.getAttribute('data-form-step'));
        if (!showAll && Number.isInteger(index)) {
          event.preventDefault();
          if (!pendingFocus.current) {
            pendingFocus.current = target;
            setStep(index);
            // Native validation visits every invalid control in the same event loop.
            // Reveal and focus the first one, even when later sections also fail.
            validationTimer.current = setTimeout(() => {
              pendingFocus.current?.focus();
              pendingFocus.current = null;
            }, 0);
          }
        }
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Label className="min-w-0 text-sm">
          Edit policy section
          <NativeSelect
            value={step}
            onChange={(event) => setStep(Number(event.target.value))}
            className="mt-1 max-w-full"
          >
            {labels.map((label, index) => (
              <option key={label} value={index}>
                {index + 1}. {label}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? 'Show one section' : 'Show all sections'}
        </Button>
      </div>
      <div className="max-h-[58dvh] overflow-y-auto overscroll-contain">
        {Children.toArray(children).map((child, index) => (
          <div
            key={labels[index] ?? index}
            data-form-step={index}
            hidden={!showAll && step !== index}
            className={showAll ? 'mb-4' : ''}
          >
            {child}
          </div>
        ))}
      </div>
      {!showAll && (
        <nav
          aria-label="Policy section navigation"
          className="flex items-center justify-between gap-3"
        >
          <Button
            type="button"
            variant="secondary"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
          >
            Previous section
          </Button>
          <span className="text-sm text-muted-foreground">
            {step + 1} of {labels.length}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={step === labels.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Next section
          </Button>
        </nav>
      )}
    </div>
  );
}
