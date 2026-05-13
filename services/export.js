// GoBuddy Export Service
const WBExport = {
  // Export as Markdown file
  exportMarkdown(content, filename = 'document') {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    this._download(blob, filename + '.md');
  },

  // Export as HTML (Word compatible)
  exportDocx(content, filename = 'document') {
    // 检查内容是否已经是HTML
    const isHTML = content.trim().startsWith('<') || content.includes('<html') || content.includes('<div') || content.includes('<p>');
    let bodyContent;
    if (isHTML) {
      bodyContent = content;
    } else {
      // 如果是Markdown，转换为HTML
      bodyContent = typeof marked !== 'undefined' ? marked.parse(content) : content;
    }
    const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${filename}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; }
  h1, h2, h3 { margin-top: 24px; margin-bottom: 12px; }
  img { max-width: 100%; height: auto; }
  ul, ol { padding-left: 24px; }
  li { margin-bottom: 4px; }
</style>
</head>
<body>${bodyContent}</body>
</html>`;
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    this._download(blob, filename + '.doc');
  },

  // Export table as Excel
  exportExcel(tableData, filename = 'table') {
    if (!tableData || !tableData.headers || !tableData.rows) return;

    const ws = XLSX.utils.aoa_to_sheet([
      tableData.headers,
      ...tableData.rows
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename + '.xlsx');
  },

  // Export table as CSV
  exportCSV(tableData, filename = 'table') {
    if (!tableData || !tableData.headers || !tableData.rows) return;

    const csvContent = [
      tableData.headers.join(','),
      ...tableData.rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    this._download(blob, filename + '.csv');
  },

  // Export all data as JSON backup
  async exportBackup() {
    const data = await WBStorage.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    this._download(blob, 'gobuddy-backup-' + dayjs().format('YYYY-MM-DD') + '.json');
  },

  // Copy to clipboard
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    }
  },

  // Download helper
  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
