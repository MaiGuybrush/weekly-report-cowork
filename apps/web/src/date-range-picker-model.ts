export type DatePickerMode = 'range' | 'single';

export interface ParsedDate {
  year: number;
  month: number;
  day: number;
}

export function parseDateIso(iso: string | null | undefined): ParsedDate | null {
  if (!iso || typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function formatDateIso(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayIso(): string {
  const d = new Date();
  return formatDateIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function formatDateDisplay(
  start: string | null | undefined,
  end: string | null | undefined,
  mode: DatePickerMode = 'range'
): string {
  if (mode === 'single') {
    return start || '';
  }
  if (!start && !end) return '';
  if (start && end) return `${start} ～ ${end}`;
  if (start) return `${start} ～`;
  return `～ ${end}`;
}

/** mm-dd~mm-dd; yy-mm-dd~yy-mm-dd when not entirely within `today`'s year. */
export function formatCompactDate(
  start: string | null | undefined,
  end: string | null | undefined,
  mode: DatePickerMode = 'range',
  today: string = getTodayIso()
): string {
  const dates = (mode === 'single' ? [start] : [start, end]).filter(Boolean) as string[];
  if (!dates.length) return '—';
  const thisYear = today.slice(0, 4);
  const full = dates.some((d) => d.slice(0, 4) !== thisYear);
  const f = (d: string | null | undefined) => (d ? (full ? d.slice(2) : d.slice(5)) : '');
  return mode === 'single' ? f(start) : `${f(start)}~${f(end)}`;
}

export interface CalendarDay {
  dateString: string;
  year: number;
  month: number;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
  title: string;
  weeks: CalendarDay[][];
}

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function generateCalendarMonth(year: number, month: number, todayIso = getTodayIso()): CalendarMonth {
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevMonthInfo = prevMonth(year, month);
  const prevMonthDays = new Date(prevMonthInfo.year, prevMonthInfo.month, 0).getDate();
  const nextMonthInfo = nextMonth(year, month);

  const days: CalendarDay[] = [];

  // Padding from previous month
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const dateString = formatDateIso(prevMonthInfo.year, prevMonthInfo.month, d);
    days.push({
      dateString,
      year: prevMonthInfo.year,
      month: prevMonthInfo.month,
      day: d,
      isCurrentMonth: false,
      isToday: dateString === todayIso,
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const dateString = formatDateIso(year, month, d);
    days.push({
      dateString,
      year,
      month,
      day: d,
      isCurrentMonth: true,
      isToday: dateString === todayIso,
    });
  }

  // Padding to complete trailing week
  let nextDay = 1;
  while (days.length % 7 !== 0) {
    const dateString = formatDateIso(nextMonthInfo.year, nextMonthInfo.month, nextDay);
    days.push({
      dateString,
      year: nextMonthInfo.year,
      month: nextMonthInfo.month,
      day: nextDay,
      isCurrentMonth: false,
      isToday: dateString === todayIso,
    });
    nextDay++;
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return {
    year,
    month,
    title: `${year} 年 ${month} 月`,
    weeks,
  };
}

export interface DateSelectionState {
  startDate: string | null;
  endDate: string | null;
  isSelectingRange: boolean;
}

export interface SelectionResult extends DateSelectionState {
  completed: boolean;
}

export function applyDateSelection(
  current: DateSelectionState,
  clickedDate: string,
  mode: DatePickerMode = 'range'
): SelectionResult {
  if (mode === 'single') {
    return {
      startDate: clickedDate,
      endDate: null,
      isSelectingRange: false,
      completed: true,
    };
  }

  // Range mode
  if (!current.isSelectingRange || !current.startDate) {
    // First click: sets start date, waiting for second click
    return {
      startDate: clickedDate,
      endDate: null,
      isSelectingRange: true,
      completed: false,
    };
  }

  // Second click:
  const firstDate = current.startDate;
  if (clickedDate < firstDate) {
    // Reverse selection: automatically adjust earlier to start, later to end
    return {
      startDate: clickedDate,
      endDate: firstDate,
      isSelectingRange: false,
      completed: true,
    };
  }

  return {
    startDate: firstDate,
    endDate: clickedDate,
    isSelectingRange: false,
    completed: true,
  };
}

export function clearSelection(): SelectionResult {
  return {
    startDate: null,
    endDate: null,
    isSelectingRange: false,
    completed: true,
  };
}

export function isDateInRange(
  date: string,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): boolean {
  if (!startDate || !endDate) return false;
  return date >= startDate && date <= endDate;
}

export function isDateInHoverRange(
  date: string,
  startDate: string | null | undefined,
  hoverDate: string | null | undefined,
  isSelectingRange: boolean
): boolean {
  if (!isSelectingRange || !startDate || !hoverDate) return false;
  const min = startDate < hoverDate ? startDate : hoverDate;
  const max = startDate < hoverDate ? hoverDate : startDate;
  return date >= min && date <= max;
}

export function getPreviewRange(
  startDate: string | null | undefined,
  hoverDate: string | null | undefined
): { previewStart: string | null; previewEnd: string | null } {
  if (!startDate) return { previewStart: null, previewEnd: null };
  if (!hoverDate) return { previewStart: startDate, previewEnd: null };
  if (hoverDate < startDate) {
    return { previewStart: hoverDate, previewEnd: startDate };
  }
  return { previewStart: startDate, previewEnd: hoverDate };
}




