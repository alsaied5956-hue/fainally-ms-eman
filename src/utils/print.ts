/**
 * Robust Printing & PDF Export Engine
 * 
 * Works seamlessly in Google Chrome, inside iframes/web containers,
 * or as standalone new tabs.
 */

export interface PrintOptions {
  title?: string;
  orientation?: "portrait" | "landscape";
  customCss?: string;
}

export function generatePrintableHtml(
  clonedContentHtml: string,
  options: PrintOptions = {}
): string {
  const orientation = options.orientation || "portrait";
  const title = options.title || "تقرير منظومة الأستاذة إيمان الدمشيتي";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&family=Amiri:wght@700&display=swap" rel="stylesheet">
    <style>
      @page {
        size: A4 ${orientation};
        margin: 8mm;
      }
      * {
        box-sizing: border-box;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      body {
        margin: 0;
        padding: 0;
        background-color: #f8fafc;
        color: #0f172a;
        font-family: 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        direction: rtl;
        text-align: right;
      }
      .print-container {
        max-width: 1000px;
        margin: 20px auto;
        background: #ffffff;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      }
      @media print {
        body {
          background-color: #ffffff !important;
        }
        .print-container {
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          border-radius: 0 !important;
        }
        .no-print-bar {
          display: none !important;
        }
      }
      .no-print-bar {
        position: sticky;
        top: 0;
        z-index: 9999;
        background: #0f172a;
        color: #f8fafc;
        padding: 12px 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        border-bottom: 2px solid #b38728;
      }
      .btn-print {
        background: linear-gradient(135deg, #f59e0b, #d97706);
        color: #000;
        font-weight: 900;
        font-size: 14px;
        border: none;
        padding: 8px 18px;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .btn-print:hover {
        background: #d97706;
      }
      .btn-close {
        background: #334155;
        color: #cbd5e1;
        font-weight: 700;
        font-size: 13px;
        border: none;
        padding: 8px 14px;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
      }
      .page-break-grade {
        page-break-after: always !important;
        break-after: page !important;
        margin-bottom: 1.5rem !important;
        padding-bottom: 1rem !important;
      }
      .page-break-grade:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
        margin-bottom: 0 !important;
      }
      .page-break-avoid {
        page-break-inside: avoid !important;
        break-inside: avoid !important;
      }
      table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin-top: 8px;
        margin-bottom: 8px;
        font-size: 11px;
      }
      th, td {
        border: 1px solid #cbd5e1 !important;
        padding: 6px 8px !important;
        text-align: right;
      }
      th {
        background-color: #f1f5f9 !important;
        color: #7c5b16 !important;
        font-weight: 800;
      }
      .no-print {
        display: none !important;
      }
      .text-center { text-align: center !important; }
      .text-right { text-align: right !important; }
      .text-left { text-align: left !important; }
      .font-bold { font-weight: 700 !important; }
      .font-extrabold, .font-black { font-weight: 900 !important; }
      .font-mono { font-family: monospace !important; }
      .text-emerald-700 { color: #047857 !important; }
      .text-rose-700 { color: #be123c !important; }
      .text-amber-700 { color: #b45309 !important; }
      .text-amber-600, .text-amber-400 { color: #d97706 !important; }
      .bg-amber-100 { background-color: #fef3c7 !important; }
      .bg-slate-50 { background-color: #f8fafc !important; }
      .bg-slate-100 { background-color: #f1f5f9 !important; }
      .border-b-2 { border-bottom: 2px solid #b38728 !important; }
      .border-b-4 { border-bottom: 4px dashed #cbd5e1 !important; }
      .border-t { border-top: 1px solid #e2e8f0 !important; }
      .rounded-full { border-radius: 9999px !important; }
      .rounded-lg, .rounded-xl, .rounded-2xl { border-radius: 8px !important; }
      .flex { display: flex !important; }
      .items-center { align-items: center !important; }
      .justify-between { justify-content: space-between !important; }
      .p-2 { padding: 8px !important; }
      .p-4 { padding: 16px !important; }
      .p-8 { padding: 24px !important; }
      .mb-4 { margin-bottom: 16px !important; }
      .mt-4 { margin-top: 16px !important; }
      .pt-6 { padding-top: 24px !important; }
      .pb-4 { padding-bottom: 16px !important; }
      ${options.customCss || ""}
    </style>
  </head>
  <body>
    <div class="no-print-bar">
      <div style="font-weight: 800; font-size: 14px; color: #fbbf24;">
        📑 ${title}
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-print" onclick="window.print()">
          🖨️ بدء الطباعة / حفظ PDF الآن (Ctrl + P)
        </button>
        <button class="btn-close" onclick="window.close()">
          ✖ إغلاق
        </button>
      </div>
    </div>

    <div class="print-container">
      ${clonedContentHtml}
    </div>

    <script>
      // Automatically attempt to trigger print dialog after page renders
      window.addEventListener('load', function() {
        setTimeout(function() {
          try {
            window.print();
          } catch(e) {
            console.error(e);
          }
        }, 500);
      });
    </script>
  </body>
</html>`;
}

export function printElement(
  elementOrId: HTMLElement | string,
  options: PrintOptions = {}
): boolean {
  try {
    let targetEl: HTMLElement | null = null;
    if (typeof elementOrId === "string") {
      targetEl = document.getElementById(elementOrId);
    } else {
      targetEl = elementOrId;
    }

    if (!targetEl) {
      console.warn("Print target element not found, falling back to window.print()");
      window.print();
      return true;
    }

    const title = options.title || "تقرير منظومة الأستاذة إيمان الدمشيتي";
    const fullHtml = generatePrintableHtml(targetEl.outerHTML, options);

    // Try opening a new tab/window in Google Chrome
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.open();
      printWindow.document.write(fullHtml);
      printWindow.document.close();
      printWindow.focus();
      return true;
    }

    // Fallback if popup was blocked: Use direct window print
    window.print();
    return true;
  } catch (error) {
    console.error("Print utility error:", error);
    window.print();
    return false;
  }
}

/**
 * Downloads a standalone HTML document that can be opened in Google Chrome
 * and printed or saved as PDF anytime offline.
 */
export function downloadPrintableHtml(
  elementOrId: HTMLElement | string,
  filename: string,
  options: PrintOptions = {}
): void {
  try {
    let targetEl: HTMLElement | null = null;
    if (typeof elementOrId === "string") {
      targetEl = document.getElementById(elementOrId);
    } else {
      targetEl = elementOrId;
    }

    if (!targetEl) return;

    const fullHtml = generatePrintableHtml(targetEl.outerHTML, {
      ...options,
      title: filename.replace(".html", ""),
    });

    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".html") ? filename : `${filename}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to download HTML document:", e);
  }
}
