import { COLORS, FONTS, MOTION } from '@mbfd/shared';
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        red: COLORS.brandRed,
        slate: { 700: COLORS.slate700, 850: COLORS.slate850 },
        stone: COLORS.stone,
        status: COLORS.status,
      },
      fontFamily: {
        heading: [FONTS.heading],
        body: [FONTS.body],
        mono: [FONTS.mono],
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
  plugins: [],
};

export default config;
