<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { Loader2 } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { UpdateInfo } from "@/lib/api";

const open = defineModel<boolean>("open", { required: true });

defineProps<{
  updateInfo: UpdateInfo | null
  updateCheckMessage: string
  isDownloadingUpdate: boolean
  downloadProgress: number
  updateReady: boolean
}>();

const emit = defineEmits<{
  'open-latest-release': []
  'download-and-install': []
  'restart': []
}>();

const { t } = useI18n();
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[520px]">
      <DialogHeader>
        <DialogTitle>{{ updateInfo?.update_available ? t('updates.availableTitle') : t('updates.title') }}</DialogTitle>
      </DialogHeader>
      <div class="space-y-3 text-sm">
        <p v-if="updateInfo?.update_available">
          {{ t('updates.availableMessage', { current: updateInfo.current_version, latest: updateInfo.latest_version }) }}
        </p>
        <p v-else class="text-muted-foreground">
          {{ updateCheckMessage || t('updates.upToDate', { version: updateInfo?.current_version || '' }) }}
        </p>
        <div v-if="updateInfo?.update_available && updateInfo.release_notes" class="max-h-48 overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
          {{ updateInfo.release_notes }}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="open = false">{{ t('dangerDialog.cancel') }}</Button>
        <template v-if="updateInfo?.update_available">
          <Button variant="outline" @click="emit('open-latest-release')">{{ t('updates.openRelease') }}</Button>
          <Button v-if="updateReady" @click="emit('restart')">{{ t('updates.restart') }}</Button>
          <Button v-else-if="isDownloadingUpdate" disabled>
            <Loader2 class="h-4 w-4 animate-spin" />
            {{ t('updates.downloading', { progress: downloadProgress }) }}
          </Button>
          <Button v-else @click="emit('download-and-install')">{{ t('updates.downloadAndInstall') }}</Button>
        </template>
        <Button v-else-if="updateCheckMessage" @click="emit('open-latest-release')">{{ t('updates.openRelease') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
