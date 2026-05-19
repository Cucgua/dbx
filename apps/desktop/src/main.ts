import { createApp } from "vue";
import { createPinia } from "pinia";
import VueVirtualScroller from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import i18n, { loadSavedLocale } from "./i18n";
import App from "./App.vue";
import "./styles/globals.css";

async function bootstrap() {
  await loadSavedLocale();

  const app = createApp(App);
  app.use(createPinia());
  app.use(i18n);
  app.use(VueVirtualScroller);
  app.mount("#root");
}

void bootstrap();
