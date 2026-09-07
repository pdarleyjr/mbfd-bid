import { COLORS } from '@mbfd/shared';
import { describe, expect, it } from 'vitest';

function luminance(hex: string) {
  const channels = [1, 3, 5].map((start) => {
    const s = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

describe('MBFD semantic palette accessibility', () => {
  const palette = COLORS.ui;
  const pairs: Array<[keyof typeof palette, keyof typeof palette]> = [
    ['foreground', 'background'],
    ['card-foreground', 'card'],
    ['muted-foreground', 'card'],
    ['muted-foreground', 'muted'],
    ['primary-foreground', 'primary'],
    ['destructive-foreground', 'destructive'],
    ['success', 'success-surface'],
    ['warning', 'warning-surface'],
    ['info', 'info-surface'],
    ['primary-foreground', 'success'],
    ['primary-foreground', 'warning'],
    ['primary-foreground', 'info'],
    ['sidebar-foreground', 'sidebar'],
    ['sidebar-muted', 'sidebar'],
    ['sidebar-foreground', 'sidebar-accent'],
    ['brand-gold', 'sidebar'],
    ['shift-a', 'card'],
    ['shift-b', 'card'],
    ['shift-c', 'card'],
    ['primary-foreground', 'shift-a'],
    ['primary-foreground', 'shift-b'],
    ['primary-foreground', 'shift-c'],
  ];
  it.each(pairs)('%s on %s meets WCAG AA normal-text contrast', (foreground, background) => {
    expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(4.5);
  });
  it('focus ring has non-text contrast on both light and navigation surfaces', () => {
    expect(contrast(palette.ring, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(palette['sidebar-foreground'], palette.sidebar)).toBeGreaterThanOrEqual(3);
  });
});
