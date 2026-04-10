import { create } from 'zustand';

import type { TargetLayout } from '@/components/TutorialOverlay';

export type TourOverlayModel = {
  visible: boolean;
  title: string;
  message: string;
  buttonLabel?: string;
  targetLayout?: TargetLayout | null;
  secondaryButton?: { label: string; onPress: () => void };
  onNext: () => void;
  onFailToMount?: () => void;
};

type TourOverlayState = {
  overlay: TourOverlayModel | null;
  show: (model: TourOverlayModel) => void;
  hide: () => void;
};

export const useTourOverlayStore = create<TourOverlayState>((set) => ({
  overlay: null,
  show: (model) => set({ overlay: model }),
  hide: () => set({ overlay: null }),
}));

