import { create } from 'zustand';

export type TourStep =
  | 'none'
  | 'dashboard_create'
  | 'dashboard_open_first_group'
  | 'group_share'
  | 'group_tab_expenses'
  | 'group_add_expense_btn'
  | 'group_tab_balances'
  | 'group_debts_list'
  | 'group_history_btn'
  | 'group_tab_stats';

export type TourProgress = {
  step: TourStep;
  /** Used to continue tour across screens (e.g. highlight inside a specific group). */
  groupId: string | null;
};

type TourProgressState = TourProgress & {
  setStep: (step: TourStep, opts?: { groupId?: string | null }) => void;
  nextGroupStep: () => void;
  clear: () => void;
};

export const useTourProgressStore = create<TourProgressState>((set) => ({
  step: 'none',
  groupId: null,

  setStep: (step, opts) => set({ step, groupId: opts?.groupId ?? null }),
  nextGroupStep: () =>
    set((s) => {
      // Grand Tour sequence:
      // 1) Menú superior
      // 2) Despeses segment
      // 3) Add (+) button
      // 4) Balanços segment
      // 5) Debts list/cards
      // 6) Historial button
      // 7) Estadístiques segment
      const order: TourStep[] = [
        'group_share',
        'group_tab_expenses',
        'group_add_expense_btn',
        'group_tab_balances',
        'group_debts_list',
        'group_history_btn',
        'group_tab_stats',
      ];
      const idx = order.indexOf(s.step);
      const next = idx >= 0 ? order[idx + 1] : undefined;
      return { step: next ?? 'none', groupId: next ? s.groupId : null };
    }),
  clear: () => set({ step: 'none', groupId: null }),
}));

