interface SvgCapable {
  saveSVG(): Promise<{ svg: string }>;
  destroy(): void;
}

export async function docxToMarkdown(buf: ArrayBuffer): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const { default: TurndownService } = await import('turndown');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  return new TurndownService({ headingStyle: 'atx' }).turndown(html);
}

export async function bpmnToSvg(xml: string): Promise<string> {
  const { default: Viewer } = await import('bpmn-js/lib/Viewer');
  const el = document.createElement('div');
  const viewer = new Viewer({ container: el }) as unknown as SvgCapable & {
    importXML(x: string): Promise<unknown>;
  };
  try {
    await viewer.importXML(xml);
    const { svg } = await viewer.saveSVG();
    return svg;
  } finally {
    viewer.destroy();
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
