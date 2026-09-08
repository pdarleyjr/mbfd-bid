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
  // Canonical semantic UI palette. CSS variables and Tailwind both consume this map.
  ui: {
    background: '#F7F8FA',
    foreground: '#172338',
    card: '#FFFFFF',
    'card-foreground': '#172338',
    popover: '#FFFFFF',
    'popover-foreground': '#172338',
    primary: '#B91C1C',
    'primary-foreground': '#FFFFFF',
    secondary: '#EDF1F6',
    'secondary-foreground': '#172338',
    muted: '#EDF1F6',
    'muted-foreground': '#526176',
    accent: '#E8EFF8',
    'accent-foreground': '#164B87',
    border: '#DCE3EB',
    input: '#C9D3DF',
    ring: '#1D5DA8',
    destructive: '#B91C1C',
    'destructive-foreground': '#FFFFFF',
    'destructive-surface': '#FEF2F2',
    success: '#166534',
    'success-surface': '#EFFAF3',
    warning: '#854D0E',
    'warning-surface': '#FFF8E6',
    info: '#164B87',
    'info-surface': '#EDF4FD',
    sidebar: '#14283E',
    'sidebar-foreground': '#ECF2FA',
    'sidebar-muted': '#B6C7DA',
    'sidebar-accent': '#1C4E86',
    'sidebar-border': '#30465E',
    'brand-gold': '#D4AB43',
    // Roster identity colors are presentation only, never operational status.
    'shift-a': '#285D48',
    'shift-a-surface': '#E9F1EC',
    'shift-b': '#345780',
    'shift-b-surface': '#EAF0F7',
    'shift-c': '#87414A',
    'shift-c-surface': '#F6ECEE',
    'shift-d': '#755B30',
    'shift-d-surface': '#F3EFE6',
    'unit-engine': '#594C78',
    'unit-engine-surface': '#EFECF5',
    'unit-ladder': '#854B50',
    'unit-ladder-surface': '#F5ECED',
    'unit-rescue': '#52632D',
    'unit-rescue-surface': '#EFF2E6',
    'unit-float': '#805432',
    'unit-float-surface': '#F6EEE5',
    'unit-marine': '#326373',
    'unit-marine-surface': '#E8F1F4',
    'unit-command': '#485A70',
    'unit-command-surface': '#EBEFF4',
    'station-header': '#EDF0F4',
  },
} as const;

export const FONTS = {
  heading: 'Plus Jakarta Sans Variable',
  body: 'Source Sans 3 Variable',
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
