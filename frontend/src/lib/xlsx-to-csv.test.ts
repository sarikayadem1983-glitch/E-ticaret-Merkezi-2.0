import { describe, expect, it } from 'vitest';
import { cellText, rowsToCsv, xlsxToCsv, XLSX_MAX_BYTES, XlsxImportError } from './xlsx-to-csv';

describe('cellText', () => {
  it('converts plain values', () => {
    expect(cellText(null)).toBe('');
    expect(cellText('Tişört')).toBe('Tişört');
    expect(cellText(249.9)).toBe('249.9');
    expect(cellText(8690000000017)).toBe('8690000000017');
    expect(cellText(new Date('2026-11-15T00:00:00Z'))).toBe('2026-11-15');
  });

  it('keeps formulas visible so the backend rejects them by row and column', () => {
    expect(cellText({ formula: 'SUM(A1:A2)', result: 3 })).toBe('=SUM(A1:A2)');
    expect(cellText({ sharedFormula: 'A1', result: 1 })).toBe('=A1');
    expect(cellText({ error: '#REF!' })).toBe('=#REF!');
  });

  it('flattens rich text and hyperlinks', () => {
    expect(cellText({ richText: [{ text: 'Pamuklu ' }, { text: 'Tişört' }] })).toBe('Pamuklu Tişört');
    expect(cellText({ text: 'site', hyperlink: 'https://example.test' })).toBe('site');
  });
});

describe('rowsToCsv', () => {
  it('quotes separators and quotes, drops trailing empty rows', () => {
    const csv = rowsToCsv([
      ['urun_adi', 'sku'],
      ['Kupa; "Büyük"', 'K-1'],
      [null, null],
    ]);
    expect(csv).toBe('urun_adi;sku\r\n"Kupa; ""Büyük""";K-1\r\n');
  });

  it('returns empty text for an empty sheet', () => {
    expect(rowsToCsv([[null], []])).toBe('');
  });
});

describe('xlsxToCsv', () => {
  it('refuses files over the size limit before parsing', async () => {
    const big = { size: XLSX_MAX_BYTES + 1 } as Blob;
    await expect(xlsxToCsv(big)).rejects.toBeInstanceOf(XlsxImportError);
  });

  it('reads the first worksheet of a real workbook', async () => {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Ürünler');
    ws.addRow(['urun_adi', 'sku', 'barkod', 'kdv_orani', 'liste_fiyati', 'para_birimi']);
    ws.addRow(['Pamuklu Tişört', 'TS-001-S', 8690000000017, 20, 249.9, 'TRY']);
    ws.addRow(['Pamuklu Tişört', 'TS-001-M', null, 20, { formula: 'E2', result: 249.9 }, 'TRY']);
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    const csv = await xlsxToCsv(new Blob([buf]));
    expect(csv).toBe(
      'urun_adi;sku;barkod;kdv_orani;liste_fiyati;para_birimi\r\n' +
        'Pamuklu Tişört;TS-001-S;8690000000017;20;249.9;TRY\r\n' +
        'Pamuklu Tişört;TS-001-M;;20;=E2;TRY\r\n',
    );
  });

  it('reports a broken file in Turkish', async () => {
    await expect(xlsxToCsv(new Blob(['bu bir excel değil']))).rejects.toThrow(/okunamadı/);
  });
});
