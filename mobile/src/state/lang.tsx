import { getLocales } from 'expo-localization';
import Storage from 'expo-sqlite/kv-store';
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { getLang, isLang, langFromLocales, setLang, type Lang } from '@/i18n';

/** A language the user picked, or `system` to follow the phone. */
export type LangChoice = Lang | 'system';

const KEY = 'language';

function storedChoice(): LangChoice {
  try {
    const v = Storage.getItemSync(KEY);
    return isLang(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function phoneLang(): Lang {
  try {
    return langFromLocales(getLocales().map((l) => l.languageTag));
  } catch {
    return 'zh';
  }
}

const resolve = (choice: LangChoice): Lang => (choice === 'system' ? phoneLang() : choice);

/** Sets the language before anything renders: the one picked under 我的, otherwise the phone's. */
export function initLanguage(): void {
  setLang(resolve(storedChoice()));
}

type LangContextValue = { lang: Lang; choice: LangChoice; choose: (choice: LangChoice) => void };

const LangContext = createContext<LangContextValue | null>(null);

/**
 * Lets the user switch language. Everything inside is remounted on a switch, so screens, headers and module-level
 * text all read the new language; the database and the signed-in account above it stay as they are.
 */
export function LangProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<LangChoice>(storedChoice);
  const [lang, setLangState] = useState<Lang>(getLang);

  const choose = useCallback((next: LangChoice) => {
    try {
      if (next === 'system') Storage.removeItemSync(KEY);
      else Storage.setItemSync(KEY, next);
    } catch {
      // Not kept for the next launch, but the switch still happens now.
    }
    const l = resolve(next);
    setLang(l);
    setChoice(next);
    setLangState(l);
  }, []);

  const value = useMemo(() => ({ lang, choice, choose }), [lang, choice, choose]);
  return (
    <LangContext.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </LangContext.Provider>
  );
}

/** The current language and the user's choice. Outside a provider (screen tests) it reads the language and can't switch. */
export function useLang(): LangContextValue {
  return useContext(LangContext) ?? { lang: getLang(), choice: 'system', choose: () => {} };
}
