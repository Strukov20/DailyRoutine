import i18n, { DEFAULT_LANGUAGE, initI18n, SUPPORTED_LANGUAGES } from './index';

describe('i18n', () => {
  beforeAll(() => {
    initI18n();
  });

  it('initializes with a supported language and the expected namespaces', () => {
    expect(SUPPORTED_LANGUAGES).toContain(i18n.language.split('-')[0]);
    expect(i18n.hasResourceBundle(DEFAULT_LANGUAGE, 'common')).toBe(true);
    expect(i18n.hasResourceBundle(DEFAULT_LANGUAGE, 'navigation')).toBe(true);
  });

  it('translates the same key differently across en and uk', async () => {
    await i18n.changeLanguage('en');
    const english = i18n.t('common:actions.save');

    await i18n.changeLanguage('uk');
    const ukrainian = i18n.t('common:actions.save');

    expect(english).toBe('Save');
    expect(ukrainian).toBe('Зберегти');
    expect(english).not.toBe(ukrainian);
  });

  it('has matching keys in every namespace across both locales', () => {
    for (const namespace of ['common', 'navigation', 'screens', 'auth', 'tasks', 'errors']) {
      const enKeys = collectKeys(i18n.getResourceBundle('en', namespace));
      const ukKeys = collectKeys(i18n.getResourceBundle('uk', namespace));
      expect(ukKeys.sort()).toEqual(enKeys.sort());
    }
  });
});

function collectKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) {
    return [prefix];
  }
  return Object.entries(obj).flatMap(([key, value]) =>
    collectKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}
