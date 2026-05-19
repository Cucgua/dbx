<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { FocusOutsideEvent, PointerDownOutsideEvent } from "reka-ui";
import { CalendarClock, ChevronDown, ChevronUp, CircleSlash } from "lucide-vue-next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatTemporalInputValue, type TemporalCellEditorKind } from "@/lib/dataGridTemporalEditor";

const props = defineProps<{
  kind: TemporalCellEditorKind;
  modelValue: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  commit: [];
  cancel: [];
}>();

const { locale } = useI18n();
const open = ref(true);
const triggerRef = ref<HTMLButtonElement | null>(null);
let closeHandled = false;

const hasDate = computed(() => props.kind !== "time");
const hasTime = computed(() => props.kind !== "date");
const displayValue = computed(() => props.modelValue || "NULL");
const monthOptions = computed(() => {
  const formatter = new Intl.DateTimeFormat(locale.value, { month: "short" });
  return Array.from({ length: 12 }, (_, index) => ({
    value: index + 1,
    label: formatter.format(new Date(2026, index, 1)),
  }));
});

const dateParts = computed(() => {
  const text = formatTemporalInputValue(props.modelValue, "date");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
});

const timeValue = computed(() => {
  if (props.kind === "time") return formatTemporalInputValue(props.modelValue, "time") || "00:00:00";
  return formatTemporalInputValue(props.modelValue, "datetime").split("T")[1] || "00:00:00";
});

const timeParts = computed(() => {
  const [hour = "00", minute = "00", second = "00"] = timeValue.value.split(":");
  return { hour, minute, second };
});

onMounted(() => {
  nextTick(() => triggerRef.value?.focus());
});

function setOpen(value: boolean) {
  open.value = value;
  if (!value && !closeHandled) finishCommit();
}

function setModelValue(value: string) {
  emit("update:modelValue", value);
}

function updateDate(part: "day" | "month" | "year", rawValue: string | number) {
  const next = { ...dateParts.value, [part]: Number(rawValue) || dateParts.value[part] };
  const maxDay = daysInMonth(next.year, next.month);
  next.day = Math.max(1, Math.min(maxDay, next.day));
  setDateTimeValue(next.year, next.month, next.day, timeValue.value);
}

function updateDateFromSelect(part: "day" | "month", rawValue: unknown) {
  if (rawValue === null || rawValue === undefined) return;
  updateDate(part, String(rawValue));
}

function stepDate(part: "year", delta: number) {
  updateDate(part, dateParts.value[part] + delta);
}

function updateTime(part: "hour" | "minute" | "second", rawValue: string | number) {
  const parts = { ...timeParts.value, [part]: normalizeTimePart(rawValue, part === "hour" ? 23 : 59) };
  const nextTime = `${parts.hour}:${parts.minute}:${parts.second}`;
  if (props.kind === "time") {
    setModelValue(nextTime);
    return;
  }
  setDateTimeValue(dateParts.value.year, dateParts.value.month, dateParts.value.day, nextTime);
}

function stepTime(part: "hour" | "minute" | "second", delta: number) {
  const max = part === "hour" ? 23 : 59;
  const current = Number(timeParts.value[part]) || 0;
  updateTime(part, (current + delta + max + 1) % (max + 1));
}

function setNull() {
  setModelValue("NULL");
}

function setNow() {
  const now = new Date();
  const dateText = [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const nextTime = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join(":");
  if (props.kind === "date") setModelValue(dateText);
  else if (props.kind === "time") setModelValue(nextTime);
  else setModelValue(`${dateText} ${nextTime}`);
}

function finishCommit() {
  closeHandled = true;
  emit("commit");
}

function finishCancel() {
  closeHandled = true;
  emit("cancel");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    finishCommit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    finishCancel();
  }
}

function onPopoverInteractOutside(event: PointerDownOutsideEvent | FocusOutsideEvent) {
  const originalEvent = event.detail.originalEvent;
  if (originalEvent instanceof FocusEvent || isSelectInteractionTarget(originalEvent.target)) {
    event.preventDefault();
  }
}

function isSelectInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-slot='select-content'], [data-slot='select-trigger']");
}

function normalizeTimePart(value: string | number, max: number): string {
  const numberValue = Math.max(0, Math.min(max, Number(value) || 0));
  return String(numberValue).padStart(2, "0");
}

function setDateTimeValue(year: number, month: number, day: number, time: string) {
  const dateText = [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join(
    "-",
  );
  if (props.kind === "date") setModelValue(dateText);
  else setModelValue(`${dateText} ${time}`);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function twoDigit(value: string | number): string {
  return String(value).padStart(2, "0");
}
</script>

<template>
  <Popover :open="open" @update:open="setOpen">
    <PopoverTrigger as-child>
      <button
        ref="triggerRef"
        type="button"
        class="cell-edit-input absolute inset-0 z-10 flex items-center gap-1 border-2 border-primary bg-background px-2 py-0.5 text-left text-xs outline-none"
        @keydown.stop="onKeydown"
        @click.stop
      >
        <CalendarClock class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate">{{ displayValue }}</span>
      </button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      side="bottom"
      class="w-auto gap-1.5 rounded-md p-1.5"
      @click.stop
      @keydown.stop="onKeydown"
      @interact-outside="onPopoverInteractOutside"
    >
      <div v-if="hasDate" class="grid grid-cols-[3.5rem_4.75rem_5rem] gap-1.5">
        <Select
          :model-value="String(dateParts.day)"
          @update:model-value="(value) => updateDateFromSelect('day', value)"
        >
          <SelectTrigger class="h-7 w-full rounded-md px-2 text-[13px] tabular-nums">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="min-w-16">
            <SelectItem
              v-for="day in daysInMonth(dateParts.year, dateParts.month)"
              :key="day"
              :value="String(day)"
              class="py-0.5 text-xs"
            >
              {{ day }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          :model-value="String(dateParts.month)"
          @update:model-value="(value) => updateDateFromSelect('month', value)"
        >
          <SelectTrigger class="h-7 w-full rounded-md px-2 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent class="min-w-20">
            <SelectItem
              v-for="month in monthOptions"
              :key="month.value"
              :value="String(month.value)"
              class="py-0.5 text-xs"
            >
              {{ month.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <div class="grid h-7 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
          <div class="flex items-center justify-center px-1 text-[13px] tabular-nums">{{ dateParts.year }}</div>
          <div class="grid border-l">
            <button type="button" class="flex items-center justify-center hover:bg-muted" @click="stepDate('year', 1)">
              <ChevronUp class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex items-center justify-center border-t hover:bg-muted"
              @click="stepDate('year', -1)"
            >
              <ChevronDown class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div v-if="hasTime" class="grid grid-cols-[3.5rem_0.5rem_3.5rem_0.5rem_3.5rem] items-center gap-1.5">
        <div class="grid h-7 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
          <div class="flex items-center justify-center px-1 text-[13px] tabular-nums">
            {{ twoDigit(timeParts.hour) }}
          </div>
          <div class="grid border-l">
            <button type="button" class="flex items-center justify-center hover:bg-muted" @click="stepTime('hour', 1)">
              <ChevronUp class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex items-center justify-center border-t hover:bg-muted"
              @click="stepTime('hour', -1)"
            >
              <ChevronDown class="h-3 w-3" />
            </button>
          </div>
        </div>
        <span class="text-center text-xs text-muted-foreground">:</span>
        <div class="grid h-7 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
          <div class="flex items-center justify-center px-1 text-[13px] tabular-nums">
            {{ twoDigit(timeParts.minute) }}
          </div>
          <div class="grid border-l">
            <button
              type="button"
              class="flex items-center justify-center hover:bg-muted"
              @click="stepTime('minute', 1)"
            >
              <ChevronUp class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex items-center justify-center border-t hover:bg-muted"
              @click="stepTime('minute', -1)"
            >
              <ChevronDown class="h-3 w-3" />
            </button>
          </div>
        </div>
        <span class="text-center text-xs text-muted-foreground">:</span>
        <div class="grid h-7 grid-cols-[1fr_1.35rem] overflow-hidden rounded-md border border-input bg-background">
          <div class="flex items-center justify-center px-1 text-[13px] tabular-nums">
            {{ twoDigit(timeParts.second) }}
          </div>
          <div class="grid border-l">
            <button
              type="button"
              class="flex items-center justify-center hover:bg-muted"
              @click="stepTime('second', 1)"
            >
              <ChevronUp class="h-3 w-3" />
            </button>
            <button
              type="button"
              class="flex items-center justify-center border-t hover:bg-muted"
              @click="stepTime('second', -1)"
            >
              <ChevronDown class="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between gap-1">
        <Button type="button" variant="ghost" size="xs" class="h-6 px-1.5 text-[11px]" @click="setNull">
          <CircleSlash class="h-3 w-3" />
          NULL
        </Button>
        <Button type="button" variant="ghost" size="xs" class="h-6 px-1.5 text-[11px]" @click="setNow">Now</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
