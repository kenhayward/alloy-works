import { valueProblem, type ValueType } from '@alloy-works/domain';

import { timeOfDay } from '../from-text.js';
import { plainDecimal, type Cell } from './cells.js';

/**
 * A spreadsheet number as a date or a time (data.md, "The fetch"; ADR-0035; the D6 plan, D6-I): a
 * serial count of days in the workbook's date system, the time of day its fraction. In the 1900
 * system serial 1 is 1900-01-01 and serial 60 is 1900-02-29, a day that never was (Lotus 1-2-3's bug,
 * kept by Excel), refused `nonexistent_date`; serials 1 to 59 are a day out against 61 onward. In the
 * 1904 system serial 0 is 1904-01-01. A serial is a double, so a time is recovered to the declared
 * precision only where the double can tell adjacent units apart there - about 0.63 microseconds at
 * 2026's dates, 1.26 from 2079 - and refused `precision_not_carried` where it cannot; a serial holding
 * a finer time than declared is `precision_lost`, and a date with a time in it the same. A serial has
 * no zone, so an instant is `zone_missing`.
 */

const DAY_MS = 86_400_000;
const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A whole serial's calendar date in the date system, or why it names none. */
function dateOf(days: number, date1904: boolean): Cell {
  if (date1904) {
    if (days < 0) return { refused: 'value_unrepresentable' };
  } else {
    if (days === 60) return { refused: 'nonexistent_date' };
    if (days < 1) return { refused: 'value_unrepresentable' };
  }
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 60 ? 31 : 30);
  const at = new Date(epoch + days * DAY_MS);
  const text = `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return valueProblem({ base: 'date' }, text) === null
    ? { value: text }
    : { refused: 'value_unrepresentable' };
}

/**
 * A serial's day and its time of day in units of the declared precision, or why the double cannot
 * say. A writer rounds the time it meant to the nearest double, so it is recovered by rounding to the
 * declared unit where the double's spacing there is finer than one unit; and the time recovered must
 * be the one the serial holds, to within that spacing, or the serial held more than was declared.
 */
function parts(
  serial: number,
  fraction: number,
): { readonly days: number; readonly units: number } | Cell {
  const perDay = 86_400 * 10 ** fraction;
  const spacing = serial === 0 ? 0 : 2 ** (Math.floor(Math.log2(serial)) - 52);
  if (spacing * perDay >= 1) return { refused: 'precision_not_carried' };
  let days = Math.floor(serial);
  let units = Math.round((serial - days) * perDay);
  if (Math.abs(days + units / perDay - serial) > 2 * spacing + Number.EPSILON) {
    return { refused: 'precision_lost' };
  }
  if (units >= perDay) {
    units -= perDay;
    days += 1;
  }
  return { days, units };
}

/** A time of day from units of the declared precision, as canonical text. */
function clock(units: number, fraction: number): Cell {
  const scale = 10 ** fraction;
  const seconds = Math.floor(units / scale);
  const text =
    `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}` +
    (fraction > 0 ? `.${String(units % scale).padStart(fraction, '0')}` : '');
  const taken = timeOfDay(text, fraction);
  return 'refused' in taken ? { refused: taken.refused } : { value: taken.value };
}

/** A number cell's text as a value of a declared date or time type, read as a serial. */
export function fromSerial(text: string, type: ValueType, date1904: boolean): Cell {
  if (type.base === 'instant') return { refused: 'zone_missing' };
  const plain = plainDecimal(text);
  const serial = Number(text);
  if (plain === undefined || !Number.isFinite(serial) || serial < 0) {
    return { refused: 'value_unrepresentable' };
  }
  switch (type.base) {
    case 'date':
      return Number.isInteger(serial) ? dateOf(serial, date1904) : { refused: 'precision_lost' };
    case 'time': {
      const split = parts(serial, type.fraction);
      if ('refused' in split || 'value' in split) return split;
      // A time of day is a serial under one day; 24:00:00 is no time of day.
      if (split.days !== 0) return { refused: 'value_unrepresentable' };
      return clock(split.units, type.fraction);
    }
    case 'localDateTime': {
      const split = parts(serial, type.fraction);
      if ('refused' in split || 'value' in split) return split;
      const date = dateOf(split.days, date1904);
      if ('refused' in date) return date;
      const time = clock(split.units, type.fraction);
      if ('refused' in time) return time;
      return { value: `${date.value as string}T${time.value as string}` };
    }
    default:
      return { refused: 'result_mismatch' };
  }
}
