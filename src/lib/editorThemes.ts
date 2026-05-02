import type { Extension } from "@codemirror/state";
import type { EditorTheme } from "@/stores/settingsStore";

/** Load a CodeMirror theme extension by theme name. */
export async function loadEditorTheme(theme: EditorTheme): Promise<Extension> {
  switch (theme) {
    case "one-dark":
      return (await import("@codemirror/theme-one-dark")).oneDark;
    case "vscode-dark":
      return (await import("@uiw/codemirror-theme-vscode")).vscodeDark;
    case "vscode-light":
      return (await import("@uiw/codemirror-theme-vscode")).vscodeLight;
    case "nord":
      return (await import("@uiw/codemirror-theme-nord")).nord;
    case "okaidia":
      return (await import("@uiw/codemirror-theme-okaidia")).okaidia;
    case "material":
      return (await import("@uiw/codemirror-theme-material")).materialDark;
    case "duotone-light":
      return (await import("@uiw/codemirror-theme-duotone")).duotoneLight;
    case "duotone-dark":
      return (await import("@uiw/codemirror-theme-duotone")).duotoneDark;
    case "xcode":
      return (await import("@uiw/codemirror-theme-xcode")).xcodeLight;
    default:
      return (await import("@codemirror/theme-one-dark")).oneDark;
  }
}

/** Build a CodeMirror theme extension for font size + font family. */
export function editorFontTheme(
  EditorView: typeof import("@codemirror/view").EditorView,
  size: number,
  family: string,
  opts?: { fixedHeight?: boolean; scrollable?: boolean },
): Extension {
  return EditorView.theme({
    "&": {
      ...(opts?.fixedHeight ? { height: "100%" } : {}),
      fontSize: `${size}px`,
    },
    ...(opts?.scrollable ? { ".cm-scroller": { overflow: "auto" } } : {}),
    ".cm-content": { fontFamily: family },
  });
}
