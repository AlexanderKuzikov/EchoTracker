interface SvgCapable {
  saveSVG(): Promise<{ svg: string }>;
  destroy(): void;
}

interface HeadlessViewer extends SvgCapable {
  importXML(x: string): Promise<unknown>;
  get(name: string): { zoom(mode: string): void };
}

export async function docxToMarkdown(buf: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const { default: TurndownService } = await import('turndown');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const { text, tables } = extractTables(html);
  const td = new TurndownService({ headingStyle: 'atx' });
  let md = td.turndown(text);
  tables.forEach((t, i) => {
    md = md.replace(`@@TABLE${i}@@`, `\n${t}\n`);
  });
  return md;
}

function tableToPipe(tableHtml: string): string {
  const doc = new DOMParser().parseFromString(tableHtml, 'text/html');
  const rows = Array.from(doc.querySelectorAll('tr')).map(
    (tr) =>
      `| ${Array.from(tr.querySelectorAll('th, td'))
        .map((c) => (c.textContent ?? '').trim().replace(/\|/g, '\\|').replace(/\s+/g, ' '))
        .join(' | ')} |`,
  );
  if (rows.length === 0) return '';
  const cols = Math.max(1, (rows[0] as string).split('|').length - 2);
  rows.splice(1, 0, `| ${Array(cols).fill('---').join(' | ')} |`);
  return rows.join('\n');
}

function extractTables(html: string): { text: string; tables: string[] } {
  const tables: string[] = [];
  const text = html.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
    tables.push(tableToPipe(m));
    return `\n\n@@TABLE${tables.length - 1}@@\n\n`;
  });
  return { text, tables };
}

export function hasBpmnLayout(xml: string): boolean {
  return /BPMNDiagram/i.test(xml);
}

export function svgHasContent(svg: string): boolean {
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/gi, '');
  return /<(path|rect|circle|text|polygon|ellipse|line|polyline)[\s>/]/i.test(body);
}

export async function bpmnToSvg(xml: string): Promise<string> {
  const { default: Viewer } = await import('bpmn-js/lib/Viewer');
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:800px;';
  document.body.appendChild(el);
  const viewer = new Viewer({ container: el }) as unknown as HeadlessViewer;
  try {
    await viewer.importXML(xml);
    const { svg } = await viewer.saveSVG();
    return svg;
  } finally {
    viewer.destroy();
    el.remove();
  }
}

export function svgToPng(svg: string, width = 480): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      try {
        const scale = width / (img.width || width);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = Math.max(1, Math.round((img.height || width) * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('svg raster failed'));
    };
    img.src = url;
  });
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? name : name.slice(0, i);
}
