<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, shallowRef } from "vue";
import type { EditorView as EditorViewType } from "@codemirror/view";

const props = defineProps<{
  modelValue: string;
  dialect?: "mysql" | "postgres";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  execute: [];
}>();

const editorRef = ref<HTMLDivElement>();
const view = shallowRef<EditorViewType | null>(null);

onMounted(async () => {
  if (!editorRef.value) return;

  const [
    { EditorView, keymap },
    { EditorState },
    { sql, MySQL, PostgreSQL },
    { basicSetup },
    { oneDark },
  ] = await Promise.all([
    import("@codemirror/view"),
    import("@codemirror/state"),
    import("@codemirror/lang-sql"),
    import("codemirror"),
    import("@codemirror/theme-one-dark"),
  ]);

  const dialect = props.dialect === "postgres" ? PostgreSQL : MySQL;

  const runKeymap = keymap.of([
    {
      key: "Mod-Enter",
      run: () => {
        emit("execute");
        return true;
      },
    },
  ]);

  const state = EditorState.create({
    doc: props.modelValue,
    extensions: [
      basicSetup,
      sql({ dialect }),
      oneDark,
      runKeymap,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit("update:modelValue", update.state.doc.toString());
        }
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: "13px" },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
      }),
    ],
  });

  view.value = new EditorView({ state, parent: editorRef.value });
});

watch(
  () => props.modelValue,
  (val) => {
    if (view.value && val !== view.value.state.doc.toString()) {
      view.value.dispatch({
        changes: { from: 0, to: view.value.state.doc.length, insert: val },
      });
    }
  }
);

onBeforeUnmount(() => {
  view.value?.destroy();
});
</script>

<template>
  <div ref="editorRef" class="h-full w-full overflow-hidden" />
</template>
