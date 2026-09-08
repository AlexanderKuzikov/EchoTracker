import { useEffect, useRef } from 'react';

interface CanvasCapable {
  importXML(x: string): Promise<unknown>;
  get(name: string): { zoom(mode: string): void };
  destroy(): void;
}

export default function BpmnView({ xml }: { xml: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let viewer: CanvasCapable | null = null;
    let dead = false;
    (async () => {
      const { default: Viewer } = await import('bpmn-js/lib/Viewer');
      if (dead || !ref.current) return;
      viewer = new Viewer({ container: ref.current }) as unknown as CanvasCapable;
      await viewer.importXML(xml);
      if (dead) return;
      viewer.get('canvas').zoom('fit-viewport');
    })().catch((e: unknown) => console.error(e));
    return () => {
      dead = true;
      viewer?.destroy();
    };
  }, [xml]);
  return <div ref={ref} className="bpmnview" />;
}
