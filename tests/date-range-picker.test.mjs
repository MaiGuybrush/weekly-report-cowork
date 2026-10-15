import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDateDisplay,
  parseDateIso,
  formatDateIso,
  getTodayIso,
  generateCalendarMonth,
  prevMonth,
  nextMonth,
  applyDateSelection,
  clearSelection,
  isDateInRange,
  isDateInHoverRange,
  getPreviewRange,
} from '../apps/web/src/date-range-picker-model.ts';

test('formatDateDisplay: single mode and range mode display formatting', () => {
  // empty
  assert.equal(formatDateDisplay(null, null, 'range'), '');
  assert.equal(formatDateDisplay(null, null, 'single'), '');
  
  // single mode
  assert.equal(formatDateDisplay('2026-10-15', null, 'single'), '2026-10-15');
  
  // range mode
  assert.equal(formatDateDisplay('2026-10-01', '2026-10-20', 'range'), '2026-10-01 ～ 2026-10-20');
  assert.equal(formatDateDisplay('2026-10-01', null, 'range'), '2026-10-01 ～');
  assert.equal(formatDateDisplay(null, '2026-10-20', 'range'), '～ 2026-10-20');
  
  // same day range
  assert.equal(formatDateDisplay('2026-10-15', '2026-10-15', 'range'), '2026-10-15 ～ 2026-10-15');
});

test('parseDateIso, formatDateIso, getTodayIso', () => {
  const parsed = parseDateIso('2026-10-05');
  assert.equal(parsed?.year, 2026);
  assert.equal(parsed?.month, 10);
  assert.equal(parsed?.day, 5);

  assert.equal(parseDateIso('invalid'), null);
  assert.equal(parseDateIso(null), null);

  assert.equal(formatDateIso(2026, 10, 5), '2026-10-05');
  assert.equal(formatDateIso(2026, 3, 9), '2026-03-09');

  const today = getTodayIso();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test('generateCalendarMonth: creates correct grid for a given year/month', () => {
  const cal = generateCalendarMonth(2026, 10, '2026-10-15');
  assert.equal(cal.year, 2026);
  assert.equal(cal.month, 10);
  assert.equal(cal.title, '2026 年 10 月');
  assert.ok(cal.weeks.length >= 4 && cal.weeks.length <= 6);
  
  // Every week must have 7 days
  for (const week of cal.weeks) {
    assert.equal(week.length, 7);
  }

  // Find 2026-10-01: it is a Thursday (index 4 of first week)
  const firstWeek = cal.weeks[0];
  assert.equal(firstWeek[4].dateString, '2026-10-01');
  assert.equal(firstWeek[4].isCurrentMonth, true);
  assert.equal(firstWeek[3].isCurrentMonth, false); // Sept 30

  // Check today marker
  const todayCell = cal.weeks.flatMap((w) => w).find((d) => d.dateString === '2026-10-15');
  assert.ok(todayCell);
  assert.equal(todayCell.isToday, true);

  const notTodayCell = cal.weeks.flatMap((w) => w).find((d) => d.dateString === '2026-10-14');
  assert.equal(notTodayCell?.isToday, false);
});

test('prevMonth and nextMonth navigation', () => {
  assert.deepEqual(nextMonth(2026, 10), { year: 2026, month: 11 });
  assert.deepEqual(nextMonth(2026, 12), { year: 2027, month: 1 });
  assert.deepEqual(prevMonth(2026, 10), { year: 2026, month: 9 });
  assert.deepEqual(prevMonth(2026, 1), { year: 2025, month: 12 });
});

test('applyDateSelection in single mode: sets date directly and completes', () => {
  const initial = { startDate: null, endDate: null, isSelectingRange: false };
  const res = applyDateSelection(initial, '2026-10-15', 'single');
  assert.deepEqual(res, {
    startDate: '2026-10-15',
    endDate: null,
    isSelectingRange: false,
    completed: true,
  });
});

test('applyDateSelection in range mode: 2-step selection with chronological auto-correction', () => {
  const initial = { startDate: null, endDate: null, isSelectingRange: false };
  
  // First click: sets start date, waiting for second click
  const step1 = applyDateSelection(initial, '2026-10-10', 'range');
  assert.deepEqual(step1, {
    startDate: '2026-10-10',
    endDate: null,
    isSelectingRange: true,
    completed: false,
  });

  // Second click (later date): normal range
  const step2Normal = applyDateSelection(step1, '2026-10-25', 'range');
  assert.deepEqual(step2Normal, {
    startDate: '2026-10-10',
    endDate: '2026-10-25',
    isSelectingRange: false,
    completed: true,
  });

  // Second click (earlier date): auto-adjust order so earlier date becomes startDate
  const step2Reverse = applyDateSelection(step1, '2026-10-02', 'range');
  assert.deepEqual(step2Reverse, {
    startDate: '2026-10-02',
    endDate: '2026-10-10',
    isSelectingRange: false,
    completed: true,
  });

  // Second click (same date): single-day range
  const step2Same = applyDateSelection(step1, '2026-10-10', 'range');
  assert.deepEqual(step2Same, {
    startDate: '2026-10-10',
    endDate: '2026-10-10',
    isSelectingRange: false,
    completed: true,
  });
});

test('clearSelection resets all dates and range selection state', () => {
  assert.deepEqual(clearSelection(), {
    startDate: null,
    endDate: null,
    isSelectingRange: false,
    completed: true,
  });
});

test('isDateInRange: checks if a date falls strictly between start and end (inclusive)', () => {
  assert.equal(isDateInRange('2026-10-10', '2026-10-10', '2026-10-20'), true);
  assert.equal(isDateInRange('2026-10-15', '2026-10-10', '2026-10-20'), true);
  assert.equal(isDateInRange('2026-10-20', '2026-10-10', '2026-10-20'), true);
  assert.equal(isDateInRange('2026-10-09', '2026-10-10', '2026-10-20'), false);
  assert.equal(isDateInRange('2026-10-21', '2026-10-10', '2026-10-20'), false);
  // Incomplete range returns false
  assert.equal(isDateInRange('2026-10-15', '2026-10-10', null), false);
  assert.equal(isDateInRange('2026-10-15', null, '2026-10-20'), false);
});

test('isDateInHoverRange: dynamically calculates preview range while selecting', () => {
  // Not currently selecting range -> always false
  assert.equal(isDateInHoverRange('2026-10-15', '2026-10-10', '2026-10-20', false), false);

  // Hovering forward: start = 10-10, hover = 10-20
  assert.equal(isDateInHoverRange('2026-10-15', '2026-10-10', '2026-10-20', true), true);
  assert.equal(isDateInHoverRange('2026-10-10', '2026-10-10', '2026-10-20', true), true);
  assert.equal(isDateInHoverRange('2026-10-20', '2026-10-10', '2026-10-20', true), true);
  assert.equal(isDateInHoverRange('2026-10-25', '2026-10-10', '2026-10-20', true), false);

  // Hovering backward: start = 10-10, hover = 10-05
  assert.equal(isDateInHoverRange('2026-10-07', '2026-10-10', '2026-10-05', true), true);
  assert.equal(isDateInHoverRange('2026-10-05', '2026-10-10', '2026-10-05', true), true);
  assert.equal(isDateInHoverRange('2026-10-10', '2026-10-10', '2026-10-05', true), true);
  assert.equal(isDateInHoverRange('2026-10-04', '2026-10-10', '2026-10-05', true), false);
});

test('getPreviewRange: correctly orders preview endpoints regardless of hover direction', () => {
  // Forward hover
  assert.deepEqual(getPreviewRange('2026-10-10', '2026-10-20'), {
    previewStart: '2026-10-10',
    previewEnd: '2026-10-20',
  });

  // Backward hover: hover date becomes previewStart, original start becomes previewEnd
  assert.deepEqual(getPreviewRange('2026-10-10', '2026-10-05'), {
    previewStart: '2026-10-05',
    previewEnd: '2026-10-10',
  });

  // Same day hover
  assert.deepEqual(getPreviewRange('2026-10-10', '2026-10-10'), {
    previewStart: '2026-10-10',
    previewEnd: '2026-10-10',
  });

  // No hover
  assert.deepEqual(getPreviewRange('2026-10-10', null), {
    previewStart: '2026-10-10',
    previewEnd: null,
  });
});




