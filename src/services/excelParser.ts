import * as xlsx from 'xlsx';

/**
 * Parses an Excel file and converts it to JSON for problem components.
 * Extracts problem title and embedded hyperlink (if available).
 * @param file - The uploaded Excel file (e.g. from <input type="file" />).
 * @param sheetName - Name of the sheet to parse (e.g. "Leetcode").
 * @returns Parsed array of problem objects.
 */
export async function parseExcelFileProblems(
  file: File,
  sheetName: string
): Promise<{ problems: { title: string; url: string }[]; note: string }[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = xlsx.read(data, { type: 'array' });

        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          return reject(new Error(`Sheet "${sheetName}" not found.`));
        }

        const range = xlsx.utils.decode_range(sheet['!ref']!);
        const results: { problems: { title: string; url: string }[]; note: string }[] = [];

        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          const problems: { title: string; url: string }[] = [];

          // Problem cell (assumed to be column A = index 0)
          const problemCellAddress = xlsx.utils.encode_cell({ r: row, c: 0 });
          const problemCell = sheet[problemCellAddress];
          const problemText = problemCell?.v?.toString() || "";

          const titles = problemText.split(/\r?\n/).map((t: string) => t.trim()).filter(Boolean);
          const link = problemCell?.l?.Target || null;

          for (const title of titles) {
            problems.push({
              title,
              url: link || "" // if no hyperlink, leave blank
            });
          }

          // Note cell (assumed to be column B = index 1)
          const noteCellAddress = xlsx.utils.encode_cell({ r: row, c: 1 });
          const note = sheet[noteCellAddress]?.v?.toString().trim() || "";

          if (problems.length > 0) {
            results.push({
              problems,
              note
            });
          }
        }

        resolve(results);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
export async function parseExcelFileConcepts(
  file: File,
  sheetName: string
): Promise<{ title:string; description:string }[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = xlsx.read(data, { type: 'array' });

        const sheet = workbook.Sheets[sheetName];
        if (!sheet) {
          return reject(new Error(`Sheet "${sheetName}" not found.`));
        }

        const range = xlsx.utils.decode_range(sheet['!ref']!);
        const results: { title:string; description:string }[] = [];

        for (let row = range.s.r + 1; row <= range.e.r; row++) {
          // Title cell (assumed to be column A = index 0)
          const titleCellAddress = xlsx.utils.encode_cell({ r: row, c: 0 });
          const titleCell = sheet[titleCellAddress];
          const title = titleCell?.v?.toString().trim() || "";

          // Description cell (assumed to be column B = index 1)
          const descriptionCellAddress = xlsx.utils.encode_cell({ r: row, c: 1 });
          const description = sheet[descriptionCellAddress]?.v?.toString().trim() || "";

          if (title) {
            results.push({
              title,
              description
            });
          }
        }

        resolve(results);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
