import { useMemo } from 'react';

import { TutorialOverlay } from '@/components/TutorialOverlay';
import { useTourOverlayStore } from '@/store/useTourOverlayStore';

/**
 * Root-level tour host.
 * Renders above navigation as a pure <View>-based overlay (no Modal).
 */
export function TourHost() {
  const overlay = useTourOverlayStore((s) => s.overlay);

  const props = useMemo(() => {
    if (!overlay) return null;
    return overlay;
  }, [overlay]);

  if (!props) return null;

  return (
    <TutorialOverlay
      isVisible={props.visible}
      title={props.title}
      message={props.message}
      onNext={props.onNext}
      buttonLabel={props.buttonLabel}
      targetLayout={props.targetLayout}
      secondaryButton={props.secondaryButton}
      onFailToMount={props.onFailToMount}
    />
  );
}
