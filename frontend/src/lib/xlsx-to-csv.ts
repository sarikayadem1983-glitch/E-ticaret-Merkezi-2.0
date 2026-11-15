/**
 * Product import from .xlsx (IMP-01b). The workbook is read in the browser with exceljs and
 * turned into the same ';'-separated CSV text the backend already validates, so the server
 * gets no new upload path or parser. Only the first worksheet is read.
 *
 * Formula cells are written as "=<formula>" on purpose: the backend rejects cells starting
 * with "=" (CSV injection) and reports the row and column, so the user sees which cell to fix.
 */

/** A raw .xlsx file larger than this is refused before parsing (zip bombs, memory). */
export const XLSX_MAX_BYTES = 2_000_000;
/** Hard stop while reading rows; the backend limit is 1000 data rows. */
const MAX_SHEET_ROWS = 1_001;

export class XlsxImportError extends Error {}

/** Minimal shape of an exceljs cell value we handle (keeps tests free of exceljs types). */
type CellValue =
  | null
  | undefined
  | string
  | number
  | boolean
  | Date
  | { formula?: string; sharedFormula?: string; result?: unknown }
  | { richText: { text: string }[] }
  | { text: string; hyperlink: string }
  | { error: string };

/** Text of one cell as the user sees it, in the form the CSV validator expects. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'DOĞRU' : 'YANLIŞ';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('formula' in value || 'sharedFormula' in value) {
    return `=${value.formula ?? value.sharedFormula ?? ''}`;
  }
  if ('richText' in value) return value.richText.map((r) => r.text).join('');
  if ('text' in value) return value.text;
  if ('error' in value) return `=${value.error}`;
  return '';
}

/** One CSV field: quoted when it holds the separator, a quote or a line break. */
function field(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows of cell values (row 1 = header) to CSV text; trailing empty rows are dropped. */
export function rowsToCsv(rows: CellValue[][]): string {
  const lines = rows.map((r) => r.map((v) => field(cellText(v).trim())).join(';'));
  while (lines.length > 0 && /^;*$/.test(lines[lines.length - 1])) lines.pop();
  return lines.length > 0 ? `${lines.join('\r\n')}\r\n` : '';
}

/** Reads the first worksheet of an .xlsx file and returns it as import CSV text. */
export async function xlsxToCsv(file: Blob): Promise<string> {
  if (file.size > XLSX_MAX_BYTES) {
    throw new XlsxImportError(
      `Excel dosyası çok büyük (en çok ${Math.floor(XLSX_MAX_BYTES / 1_000_000)} MB).`,
    );
  }
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new XlsxImportError(
      'Excel dosyası okunamadı. Dosyanın .xlsx biçiminde ve bozuk olmadığını kontrol edin.',
    );
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new XlsxImportError('Excel dosyasında sayfa bulunamadı.');
  if (sheet.actualRowCount > MAX_SHEET_ROWS) {
    throw new XlsxImportError(
      `Excel sayfasında çok fazla satır var (en çok ${MAX_SHEET_ROWS - 1} ürün satırı). Dosyayı bölün.`,
    );
  }
  const width = sheet.getRow(1).cellCount;
  const rows: CellValue[][] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const cells: CellValue[] = [];
    for (let c = 1; c <= width; c++) cells.push(row.getCell(c).value as CellValue);
    rows.push(cells);
  }
  return rowsToCsv(rows);
}
