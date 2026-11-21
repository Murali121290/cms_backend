import type { WorkspaceItem } from "../types";
import { addDays, DAY_MS, dayKeyOf, dayStart, toDayKey } from "./dates";

export type ScheduleWeeks = 2 | 4;

export interface ScheduleRange {
  start: Date; // local midnight of the first day
  days: number;
  startKey: string;
  endKey: string; // last day shown (inclusive)
}

/** 2 weeks = 6 days back + today + 7 ahead; 4 weeks = 13 back + today + 14 ahead. */
export function makeRange(today: Date, weeks: ScheduleWeeks): ScheduleRange {
  const back = weeks === 4 ? 13 : 6;
  const days = weeks * 7;
  const start = addDays(dayStart(toDayKey(today)), -back);
  return { start, days, startKey: toDayKey(start), endKey: toDayKey(addDays(start, days - 1)) };
}

export interface BarGeometry {
  left: number; // %
  width: number; // %
  clippedStart: boolean;
  clippedEnd: boolean;
}

/** Position of [startMs, endMs) inside the range, in percent. null = entirely outside. */
export function barGeometry(range: ScheduleRange, startMs: number, endMs: number): BarGeometry | null {
  const t0 = range.start.getTime();
  const span = addDays(range.start, range.days).getTime() - t0;
  const rawL = ((startMs - t0) / span) * 100;
  const rawR = ((endMs - t0) / span) * 100;
  const left = Math.max(0, rawL);
  const right = Math.min(100, rawR);
  if (right <= left) return null;
  return { left, width: right - left, clippedStart: rawL < 0, clippedEnd: rawR > 100 };
}

/** Planned window: planned start day → end of the planned end day. */
export function plannedWindow(item: WorkspaceItem): [number, number] | null {
  const endKey = dayKeyOf(item.planned_end_date);
  if (!endKey) return null;
  const startKey = dayKeyOf(item.planned_start_date) ?? endKey;
  const s = dayStart(startKey <= endKey ? startKey : endKey).getTime();
  return [s, addDays(dayStart(endKey), 1).getTime()];
}

/** Actual work: assigned/started → completed (or now). At least a third of a day so it stays visible. */
export function actualWindow(item: WorkspaceItem, nowMs: number): [number, number] | null {
  if (!item.actual_start_date) return null;
  const s = new Date(item.actual_start_date).getTime();
  if (Number.isNaN(s)) return null;
  const e = item.actual_end_date ? new Date(item.actual_end_date).getTime() : nowMs;
  return [s, Math.max(e, s + DAY_MS / 3)];
}

export interface DayCell {
  key: string;
  date: Date;
  weekend: boolean;
  today: boolean;
  monthLabel: string;
}

export function dayCells(range: ScheduleRange, todayKey: string): DayCell[] {
  return Array.from({ length: range.days }, (_, i) => {
    const date = addDays(range.start, i);
    const key = toDayKey(date);
    return {
      key,
      date,
      weekend: date.getDay() === 0 || date.getDay() === 6,
      today: key === todayKey,
      monthLabel: i === 0 || date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: "short" }) : "",
    };
  });
}

/** Percent offset of a moment inside the range (for the today line). */
export function offsetPct(range: ScheduleRange, ms: number): number {
  const t0 = range.start.getTime();
  const span = addDays(range.start, range.days).getTime() - t0;
  return ((ms - t0) / span) * 100;
}
