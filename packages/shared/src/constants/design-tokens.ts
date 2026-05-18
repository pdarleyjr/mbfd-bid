// Mirror of MBFD_Hub/.impeccable.md — bid app variant
// Any change here MUST be reflected in tailwind.config.ts via this module.

export const COLORS = {
  // Brand
  brandRed: { 700: '#B91C1C', 600: '#DC2626', 50: '#FEF2F2' },
  // Authority (admin)
  slate850: '#1e293b',
  slate700: '#374151',
  // Warm neutrals (replace ALL cold grays)
  stone: {
    50: '#FAFAF9',
    100: '#F5F5F4',
    200: '#E7E5E3',
    400: '#A8A29E',
    600: '#78716C',
    800: '#292524',
  },
  // Semantic status (for live bid board parity with incident feed colors)
  status: {
    active: '#B91C1C',
    enroute: '#D97706',
    onscene: '#16A34A',
    clear: '#64748B',
  },
} as const;

export const FONTS = {
  heading: 'Plus Jakarta Sans, system-ui, sans-serif',
  body: 'Source Sans 3, system-ui, sans-serif',
  mono: 'JetBrains Mono, ui-monospace, monospace',
} as const;

export const MOTION = {
  durationFast: '150ms',
  durationBase: '200ms',
  durationSlow: '300ms',
  durationReveal: '400ms',
  easingOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easingInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const TYPE = {
  tabularNums: 'tabular-nums',
} as const;
