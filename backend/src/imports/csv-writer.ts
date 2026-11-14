/**
 * CSV output for exports (IMP-04): ';' separated with a UTF-8 BOM so Excel (Turkish) opens
 * it directly. Every cell that a spreadsheet would run as a formula (=, +, -, @, tab, CR at
 * the start) is prefixed with an apostrophe (OWASP CSV injection guidance), so exported data
 * typed by any user can never execute on the reader's machine.
 */
export function csvCell(value: string | number | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  header: readonly string[],
  rows: (string | number | null)[][],
): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** "249.90" → "249,90" (Turkish Excel); the import accepts both forms. */
export const trAmount = (amount: string) => amount.replace('.', ',');
