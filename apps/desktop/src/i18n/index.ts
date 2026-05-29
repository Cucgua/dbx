import { createI18n } from "vue-i18n";
import zhCN from "./locales/zh-CN";
import { safeLocalStorageGet, safeLocalStorageSet } from "@/lib/safeStorage";

export type Locale = "en" | "es" | "zh-CN";
type LocaleMessages = Record<string, unknown>;
type I18nGlobal = {
  locale: { value: Locale };
  setLocaleMessage: (locale: Locale, messages: LocaleMessages) => void;
};

const supportedLocales: Locale[] = ["en", "es", "zh-CN"];
const defaultLocale: Locale = "zh-CN";
const loadedLocales = new Set<Locale>([defaultLocale]);
const localeLoaders: Record<Exclude<Locale, "zh-CN">, () => Promise<{ default: LocaleMessages }>> = {
  en: () => import("./locales/en"),
  es: () => import("./locales/es"),
};

function normalizeLocale(value: string | null): Locale {
  if (value && supportedLocales.includes(value as Locale)) {
    return value as Locale;
  }
  return defaultLocale;
}

const savedLocale = normalizeLocale(safeLocalStorageGet("dbx-locale"));

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: defaultLocale,
  messages: {
    "zh-CN": zhCN,
  },
});
const i18nGlobal = i18n.global as unknown as I18nGlobal;

export async function loadLocaleMessages(locale: Locale) {
  if (loadedLocales.has(locale)) return;
  const loader = localeLoaders[locale as Exclude<Locale, "zh-CN">];
  if (!loader) return;
  const messages = await loader();
  i18nGlobal.setLocaleMessage(locale, messages.default);
  loadedLocales.add(locale);
}

export async function loadSavedLocale() {
  await loadLocaleMessages(savedLocale);
}

export async function setLocale(locale: Locale) {
  await loadLocaleMessages(locale);
  i18nGlobal.locale.value = locale;
  safeLocalStorageSet("dbx-locale", locale);
}

export function currentLocale(): Locale {
  return i18nGlobal.locale.value;
}

export function nextLocale(current: Locale): Locale {
  const index = supportedLocales.indexOf(current);
  const nextIndex = index === -1 ? 0 : (index + 1) % supportedLocales.length;
  return supportedLocales[nextIndex];
}

export default i18n;
