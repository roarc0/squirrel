/**
 * Helper utility to export array of objects to downloadable CSV file
 */
export function exportToCSV<T extends Record<string, any>>(
  filename: string,
  rows: T[],
  columns: { key: string; label: string; getValue?: (row: T) => any }[]
) {
  if (!rows || rows.length === 0) return;

  const header = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const csvRows = rows.map(row => {
    return columns
      .map(c => {
        const val = c.getValue ? c.getValue(row) : row[c.key];
        const str = val === null || val === undefined ? '' : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(',');
  });

  const csvContent = [header, ...csvRows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
