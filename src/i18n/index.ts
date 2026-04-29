import { createI18n } from "vue-i18n";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

export type Locale = "en" | "zh-CN";

const savedLocale = (localStorage.getItem("dbx-locale") as Locale) || "zh-CN";

const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: "en",
  messages: {
    en,
    "zh-CN": zhCN,
  },
});

export function setLocale(locale: Locale) {
  i18n.global.locale.value = locale;
  localStorage.setItem("dbx-locale", locale);
}

export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale;
}

export default i18n;
