import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_LANG, LANGS, resolveSavedLang, STRINGS, tpl, type Lang } from './strings';

export const LANG_STORAGE_KEY = 'khadma-lang';

interface LangCtx {
  lang: Lang;
  t: (k: string, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LangCtx>({
  lang: DEFAULT_LANG,
  t: (k) => k,
  setLang: () => {}
});

function readInitialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    const resolved = resolveSavedLang(saved);
    // Migrate legacy 'dar' preference to 'fr' in localStorage.
    if (saved && saved !== resolved) {
      localStorage.setItem(LANG_STORAGE_KEY, resolved);
    }
    return resolved;
  } catch {
    return DEFAULT_LANG;
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    const meta = LANGS.find((l) => l.id === lang) ?? LANGS[0];
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
  }, [lang]);

  const setLang = (l: Lang) => {
    const next = resolveSavedLang(l);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Ignore storage write errors in restricted browsing modes.
    }
    setLangState(next);
  };

  const t = (k: string, vars?: Record<string, string | number>) => {
    const s = STRINGS[lang][k] ?? STRINGS.fr[k] ?? k;
    return vars ? tpl(s, vars) : s;
  };

  return <Ctx.Provider value={{ lang, t, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
