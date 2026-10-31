import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { STRINGS, LANGS, tpl, type Lang } from './strings';

const KEY = 'khadma-lang';

interface LangCtx {
  lang: Lang;
  t: (k: string, vars?: Record<string, string | number>) => string;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<LangCtx>({
  lang: 'dar',
  t: (k) => k,
  setLang: () => {}
});

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(KEY);
    return saved === 'dar' || saved === 'fr' || saved === 'ar' ? saved : 'dar';
  });

  useEffect(() => {
    const meta = LANGS.find((l) => l.id === lang) ?? LANGS[0];
    document.documentElement.lang = meta.htmlLang;
    document.documentElement.dir = meta.dir;
  }, [lang]);

  const setLang = (l: Lang) => {
    localStorage.setItem(KEY, l);
    setLangState(l);
  };

  const t = (k: string, vars?: Record<string, string | number>) => {
    const s = STRINGS[lang][k] ?? STRINGS.dar[k] ?? k;
    return vars ? tpl(s, vars) : s;
  };

  return <Ctx.Provider value={{ lang, t, setLang }}>{children}</Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);
