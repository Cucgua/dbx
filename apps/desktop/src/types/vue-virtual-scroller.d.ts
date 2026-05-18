declare module "vue-virtual-scroller" {
  import type { DefineComponent } from "vue";
  const VueVirtualScroller: any;
  export const RecycleScroller: DefineComponent<any, any, any>;
  export const DynamicScroller: DefineComponent<any, any, any>;
  export const DynamicScrollerItem: DefineComponent<any, any, any>;
  export default VueVirtualScroller;
}
