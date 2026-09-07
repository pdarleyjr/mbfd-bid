import { COLORS, FONTS, MOTION } from '@mbfd/shared';
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

function rgb(hex: string) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16)).join(' ');
}

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries(
          Object.keys(COLORS.ui).map((name) => [name, `rgb(var(--${name}) / <alpha-value>)`]),
        ),
        red: COLORS.brandRed,
        // NOTE: This is an OVERRIDE, not an extend. Tailwind's default slate-700 (#334155)
        // is replaced with COLORS.slate700 (#374151) — the "Authority" admin token from
        // .impeccable.md. If you need the original Tailwind slate-700, use an arbitrary
        // value (e.g., text-[#334155]) or rename the token in design-tokens.ts.
        slate: { 700: COLORS.slate700, 850: COLORS.slate850 },
        stone: COLORS.stone,
        status: COLORS.status,
      },
      fontFamily: {
        heading: [FONTS.heading, 'system-ui', 'sans-serif'],
        body: [FONTS.body, 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontVariantNumeric: {
        'tabular-nums': 'tabular-nums',
      },
      transitionDuration: {
        fast: MOTION.durationFast,
        base: MOTION.durationBase,
        slow: MOTION.durationSlow,
        reveal: MOTION.durationReveal,
      },
      transitionTimingFunction: {
        'out-quart': MOTION.easingOut,
        'in-out-quart': MOTION.easingInOut,
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': Object.fromEntries(
          Object.entries(COLORS.ui).map(([name, hex]) => [`--${name}`, rgb(hex)]),
        ),
      });
    }),
  ],
};

export default config;
