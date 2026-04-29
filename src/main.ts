import { createApp } from "vue";
import { createPinia } from "pinia";
import VueVirtualScroller from "vue-virtual-scroller";
import "vue-virtual-scroller/dist/vue-virtual-scroller.css";
import i18n from "./i18n";
import App from "./App.vue";
import "./styles/globals.css";

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(VueVirtualScroller);
app.mount("#root");
