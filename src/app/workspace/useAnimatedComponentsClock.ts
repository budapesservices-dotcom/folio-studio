import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentDefinition, DesignNode } from '../../core/document/types';
import { documentHasAnyAnimations } from '../../engines/animation/svgExport';
import type { EditorTarget } from '../editorContext';

export interface UseAnimatedComponentsClockOptions {
  nodes: readonly DesignNode[];
  components: readonly ComponentDefinition[];
  activeEditorId: EditorTarget;
  motionOpen: boolean;
  motionPlaying: boolean;
  motionPreviewActive: boolean;
  motionPlayheadMs: number;
}

export function useAnimatedComponentsClock(options: UseAnimatedComponentsClockOptions) {
  const {
    nodes,
    components,
    activeEditorId,
    motionOpen,
    motionPlaying,
    motionPreviewActive,
    motionPlayheadMs,
  } = options;

  const hasAnimatedComponentsOnMain = useMemo(
    () => documentHasAnyAnimations(nodes, components, null),
    [nodes, components],
  );

  const [componentAnimPlaying, setComponentAnimPlaying] = useState(true);
  const [componentAnimTimeMs, setComponentAnimTimeMs] = useState(0);

  useEffect(() => {
    if (!hasAnimatedComponentsOnMain || !componentAnimPlaying) return;
    if (typeof requestAnimationFrame !== 'function') return;
    let rafId = 0;
    let lastStamp = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - lastStamp));
      lastStamp = now;
      setComponentAnimTimeMs((prev) => prev + dt);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [hasAnimatedComponentsOnMain, componentAnimPlaying]);

  const effectiveMainAnimationTimeMs = hasAnimatedComponentsOnMain
    ? (activeEditorId === 'main' && motionOpen && (motionPlaying || motionPreviewActive)
      ? motionPlayheadMs
      : componentAnimTimeMs)
    : undefined;

  return {
    hasAnimatedComponentsOnMain,
    componentAnimPlaying,
    toggleComponentAnimPlaying: () => setComponentAnimPlaying((playing) => !playing),
    effectiveMainAnimationTimeMs,
  };
}
