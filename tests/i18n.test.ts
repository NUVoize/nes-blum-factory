import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, messages } from '../src/shared/i18n';

describe('i18n', () => {
  it('defaults to French (Blum is Québécois)', () => {
    expect(DEFAULT_LOCALE).toBe('fr');
  });

  it('has the same keys in French and English, none empty', () => {
    const fr = Object.keys(messages.fr).sort();
    const en = Object.keys(messages.en).sort();
    expect(en).toEqual(fr);
    for (const locale of ['fr', 'en'] as const) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });
});
