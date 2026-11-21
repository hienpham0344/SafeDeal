import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight, Clock } from "lucide-react";

export interface DeadlinePreset {
  readonly label: string;
  readonly offsetHours: number;
}

interface DeadlinePickerProps {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (nextValue: string) => void;
  readonly presets: readonly DeadlinePreset[];
  readonly anchorEpochMs?: number;
  readonly minDate?: Date;
  readonly error?: string;
  readonly errorId?: string;
  readonly "aria-invalid"?: boolean;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] as const;
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_STEPS = [0, 15, 30, 45] as const;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalDateTimeString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function parseLocalDateTime(raw: string): Date {
  const ts = Date.parse(raw);
  if (!Number.isNaN(ts)) {
    return new Date(ts);
  }
  return new Date();
}

function formatReadableDeadline(raw: string): string {
  const ts = Date.parse(raw);
  if (Number.isNaN(ts)) return "Select date & time";
  const d = new Date(ts);
  const datePart = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${datePart} · ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Custom dark-themed date & 24h time picker with 1-click duration presets,
 * replacing the unstyled native browser `datetime-local` popup.
 */
export function DeadlinePicker({
  id,
  label,
  value,
  onChange,
  presets,
  anchorEpochMs,
  minDate,
  error,
  errorId,
  "aria-invalid": ariaInvalid,
}: DeadlinePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedDate = useMemo(() => parseLocalDateTime(value), [value]);
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1)
  );

  useEffect(() => {
    if (!open) return;
    setViewMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<Date | null> = [];
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push(null);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(new Date(year, month, day));
    }
    return cells;
  }, [viewMonth]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const minDay = useMemo(() => (minDate ? startOfDay(minDate) : today), [minDate, today]);

  const activePresetLabel = useMemo(() => {
    const selectedMs = Date.parse(value);
    if (Number.isNaN(selectedMs)) return null;
    const baseMs = anchorEpochMs ?? Date.now();
    const diffHours = (selectedMs - baseMs) / 3_600_000;
    const matched = presets.find((p) => Math.abs(diffHours - p.offsetHours) < 0.25);
    return matched?.label ?? null;
  }, [value, anchorEpochMs, presets]);

  function applyPreset(offsetHours: number) {
    const baseMs = anchorEpochMs ?? Date.now();
    const target = new Date(baseMs + offsetHours * 3_600_000);
    onChange(toLocalDateTimeString(target));
    setOpen(false);
  }

  function selectCalendarDay(day: Date) {
    const next = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      selectedDate.getHours(),
      selectedDate.getMinutes()
    );
    onChange(toLocalDateTimeString(next));
  }

  function updateHour(hour: number) {
    const next = new Date(selectedDate);
    next.setHours(hour);
    onChange(toLocalDateTimeString(next));
  }

  function updateMinute(minute: number) {
    const next = new Date(selectedDate);
    next.setMinutes(minute);
    onChange(toLocalDateTimeString(next));
  }

  const monthHeading = viewMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const currentMinute = selectedDate.getMinutes();
  const minuteOptions = useMemo(() => {
    const set = new Set<number>(MINUTE_STEPS);
    set.add(currentMinute);
    return Array.from(set).sort((a, b) => a - b);
  }, [currentMinute]);

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-white">
          {label}
        </label>
        <div className="flex flex-wrap gap-1">
          {presets.map((preset) => {
            const isActive = activePresetLabel === preset.label;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.offsetHours)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors ${
                  isActive
                    ? "border-sd-accent/60 bg-sd-accent/15 text-white"
                    : "border-sd-lineStrong bg-sd-inset text-sd-inkMuted hover:border-white/30 hover:text-white"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hidden synced text input preserves label association and test fireEvent.change compatibility */}
      <input
        id={id}
        type="text"
        value={value}
        aria-invalid={ariaInvalid}
        aria-describedby={error && errorId ? errorId : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
        className={`mt-1.5 flex w-full items-center justify-between rounded-xl border bg-sd-inset px-3.5 py-2.5 text-left text-sm text-white transition-colors hover:border-white/30 focus:border-sd-accent focus:outline-none focus:ring-1 focus:ring-sd-accent/40 ${
          error ? "border-red-400/60" : "border-sd-lineStrong"
        }`}
      >
        <span className="font-mono tabular-nums">{formatReadableDeadline(value)}</span>
        <Calendar size={16} className="shrink-0 text-sd-inkMuted" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} picker`}
          className="absolute left-0 z-40 mt-2 w-full min-w-[290px] max-w-sm rounded-xl border border-sd-lineStrong bg-[#111114] p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between pb-3">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))
              }
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-sd-line text-sd-inkMuted transition-colors hover:border-white/30 hover:text-white"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-medium text-white">{monthHeading}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))
              }
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-sd-line text-sd-inkMuted transition-colors hover:border-white/30 hover:text-white"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-mono text-sd-inkSubtle">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-1">
                {day}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1 text-center text-xs">
            {calendarDays.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} />;
              }
              const isDisabled = day < minDay;
              const isSelected = isSameDay(day, selectedDate);
              const isToday = isSameDay(day, today);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => selectCalendarDay(day)}
                  className={`flex h-8 w-full items-center justify-center rounded-lg font-mono tabular-nums transition-colors ${
                    isSelected
                      ? "bg-white font-semibold text-[#09090b]"
                      : isDisabled
                        ? "cursor-not-allowed text-sd-inkSubtle/30"
                        : isToday
                          ? "border border-sd-accent/50 text-white hover:bg-white/10"
                          : "text-sd-ink hover:bg-white/10"
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-sd-line pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-sd-inkMuted">
              <Clock size={13} aria-hidden="true" />
              <span>Time (24h)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <select
                aria-label={`${label} hour`}
                value={selectedDate.getHours()}
                onChange={(e) => updateHour(Number(e.target.value))}
                className="rounded-lg border border-sd-lineStrong bg-sd-inset px-2 py-1 font-mono text-xs text-white tabular-nums focus:border-sd-accent focus:outline-none"
              >
                {HOURS_24.map((h) => (
                  <option key={h} value={h}>
                    {pad2(h)}
                  </option>
                ))}
              </select>
              <span className="font-mono text-xs text-sd-inkMuted">:</span>
              <select
                aria-label={`${label} minute`}
                value={currentMinute}
                onChange={(e) => updateMinute(Number(e.target.value))}
                className="rounded-lg border border-sd-lineStrong bg-sd-inset px-2 py-1 font-mono text-xs text-white tabular-nums focus:border-sd-accent focus:outline-none"
              >
                {minuteOptions.map((m) => (
                  <option key={m} value={m}>
                    {pad2(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {error && errorId && (
        <p id={errorId} className="mt-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

