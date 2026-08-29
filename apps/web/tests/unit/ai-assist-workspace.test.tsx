import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AiAssistWorkspace } from '../../app/admin/ai-assist/AiAssistWorkspace';

describe('AiAssistWorkspace', () => {
  it('presents a structured advisory fallback and makes the no-authority boundary explicit', () => {
    const html = renderToString(<AiAssistWorkspace />);

    expect(html).toContain('AI Assist');
    expect(html).toContain('Deterministic fallback');
    expect(html).toContain('does not make awards');
    expect(html).toContain('does not change policy');
    expect(html).toContain('Specialty priority');
    expect(html).toContain('Explain supplied facts');
  });
});
