<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Settings } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useSettingsStore, EDITOR_THEMES, FONT_FAMILIES, type EditorTheme } from "@/stores/settingsStore";

const { t } = useI18n();
const settingsStore = useSettingsStore();

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

// Local edit state
const editFontFamily = ref(settingsStore.editorSettings.fontFamily);
const editFontSize = ref(settingsStore.editorSettings.fontSize);
const editTheme = ref(settingsStore.editorSettings.theme);

// Sync from store when dialog opens
watch(() => props.open, (open) => {
  if (open) {
    editFontFamily.value = settingsStore.editorSettings.fontFamily;
    editFontSize.value = settingsStore.editorSettings.fontSize;
    editTheme.value = settingsStore.editorSettings.theme;
  }
});

function hasChanges(): boolean {
  return (
    editFontFamily.value !== settingsStore.editorSettings.fontFamily ||
    editFontSize.value !== settingsStore.editorSettings.fontSize ||
    editTheme.value !== settingsStore.editorSettings.theme
  );
}

function applySettings() {
  settingsStore.updateEditorSettings({
    fontFamily: editFontFamily.value,
    fontSize: editFontSize.value,
    theme: editTheme.value,
  });
  emit("update:open", false);
}

function resetDefaults() {
  editFontFamily.value = "'JetBrains Mono', 'Fira Code', monospace";
  editFontSize.value = 13;
  editTheme.value = "one-dark";
}

function onFontFamilyChange(v: any) {
  if (typeof v === 'string') editFontFamily.value = v;
}

function onThemeChange(v: any) {
  if (typeof v === 'string') editTheme.value = v as EditorTheme;
}
</script>

<template>
  <Dialog :open="open" @update:open="(v: boolean) => emit('update:open', v)">
    <DialogContent class="sm:max-w-[480px]">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <Settings class="h-4 w-4" />
          {{ t('settings.title') }}
        </DialogTitle>
      </DialogHeader>

      <div class="space-y-5 py-2">
        <!-- Font Family -->
        <div class="space-y-2">
          <Label>{{ t('settings.fontFamily') }}</Label>
          <Select :model-value="editFontFamily" @update:model-value="onFontFamilyChange">
            <SelectTrigger>
              <SelectValue :placeholder="t('settings.selectFont')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="font in FONT_FAMILIES"
                :key="font.value"
                :value="font.value"
                :style="{ fontFamily: font.value }"
              >
                {{ font.label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground leading-relaxed font-mono" :style="{ fontFamily: editFontFamily }">
            SELECT * FROM users WHERE id = 1;
          </p>
        </div>

        <Separator />

        <!-- Font Size -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label>{{ t('settings.fontSize') }}</Label>
            <span class="text-xs text-muted-foreground tabular-nums">{{ editFontSize }}px</span>
          </div>
          <input
            type="range"
            min="10"
            max="24"
            step="1"
            :value="editFontSize"
            @input="editFontSize = Number(($event.target as HTMLInputElement).value)"
            class="w-full accent-primary"
          />
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>10px</span>
            <span class="flex-1 border-b border-dashed border-muted-foreground/30" />
            <span>24px</span>
          </div>
        </div>

        <Separator />

        <!-- Theme -->
        <div class="space-y-2">
          <Label>{{ t('settings.theme') }}</Label>
          <Select :model-value="editTheme" @update:model-value="onThemeChange">
            <SelectTrigger>
              <SelectValue :placeholder="t('settings.selectTheme')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="theme in EDITOR_THEMES"
                :key="theme.value"
                :value="theme.value"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="h-3 w-3 rounded-full border"
                    :class="theme.dark ? 'bg-foreground border-foreground/20' : 'bg-muted-foreground/30 border-muted-foreground/40'"
                  />
                  {{ theme.label }}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter class="gap-2 sm:gap-0">
        <Button variant="outline" @click="resetDefaults">
          {{ t('settings.resetDefaults') }}
        </Button>
        <div class="flex-1" />
        <Button variant="outline" @click="emit('update:open', false)">
          {{ t('common.close') }}
        </Button>
        <Button :disabled="!hasChanges()" @click="applySettings">
          {{ t('settings.apply') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
