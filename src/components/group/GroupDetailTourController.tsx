import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { InteractionManager, View } from 'react-native';
import { useAuthStore } from '@/store';
import { useTourOverlayStore } from '@/store/useTourOverlayStore';
import { useTourProgressStore } from '@/store/useTourProgressStore';
import { useTourStore } from '@/store/useTourStore';

type Props = {
  groupId: string;
  headerMenuRef: React.RefObject<View | null>;
  expensesTabRef: React.RefObject<View | null>;
  balancesTabRef: React.RefObject<View | null>;
  statsTabRef: React.RefObject<View | null>;
  addExpenseBtnRef: React.RefObject<View | null>;
  debtsListRef: React.RefObject<View | null>;
  historyBtnRef: React.RefObject<View | null>;
  // Mutable ref exposed to the parent so tabs can request a measurement.
  measureRefForCurrentStepImplRef: React.MutableRefObject<(() => void) | null>;
  onSelectTab?: (idx: number) => void;
};

export default function GroupDetailTourController({
  groupId,
  headerMenuRef,
  expensesTabRef,
  balancesTabRef,
  statsTabRef,
  addExpenseBtnRef,
  debtsListRef,
  historyBtnRef,
  measureRefForCurrentStepImplRef,
  onSelectTab,
}: Props) {
  const { user } = useAuthStore();

  const tourStep = useTourProgressStore((s) => s.step);
  const tourGroupId = useTourProgressStore((s) => s.groupId);
  const nextGroupStep = useTourProgressStore((s) => s.nextGroupStep);
  const clearTourStep = useTourProgressStore((s) => s.clear);
  const showTourOverlay = useTourOverlayStore((s) => s.show);
  const hideTourOverlay = useTourOverlayStore((s) => s.hide);
  const markTourSeen = useTourStore((s) => s.markSeen);

  const [tourTarget, setTourTarget] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const isMyTour = useMemo(() => {
    return tourStep?.startsWith('group_') && !!tourGroupId && tourGroupId === groupId;
  }, [groupId, tourGroupId, tourStep]);

  const measureRefForCurrentStep = useCallback(() => {
    const ref =
      tourStep === 'group_share'
        ? headerMenuRef
        : tourStep === 'group_tab_expenses'
          ? expensesTabRef
          : tourStep === 'group_add_expense_btn'
            ? addExpenseBtnRef
            : tourStep === 'group_tab_balances'
              ? balancesTabRef
              : tourStep === 'group_debts_list'
                ? debtsListRef
                : tourStep === 'group_history_btn'
                  ? historyBtnRef
                  : tourStep === 'group_tab_stats'
                    ? statsTabRef
                    : null;

    if (!ref?.current) return;
    ref.current.measure((_x, _y, w, h, pageX, pageY) => {
      setTourTarget({ x: pageX - 4, y: pageY - 4, width: w + 8, height: h + 8 });
    });
  }, [addExpenseBtnRef, balancesTabRef, debtsListRef, expensesTabRef, headerMenuRef, historyBtnRef, statsTabRef, tourStep]);

  // Expose measurement callback for children.
  useEffect(() => {
    measureRefForCurrentStepImplRef.current = measureRefForCurrentStep;
    return () => {
      measureRefForCurrentStepImplRef.current = null;
    };
  }, [measureRefForCurrentStep, measureRefForCurrentStepImplRef]);

  // Sync segmented control so the tour always points to a visible section.
  useEffect(() => {
    if (!isMyTour) return;
    if (!onSelectTab) return;
    if (tourStep === 'group_tab_expenses' || tourStep === 'group_add_expense_btn') onSelectTab(0);
    if (tourStep === 'group_tab_balances' || tourStep === 'group_debts_list' || tourStep === 'group_history_btn')
      onSelectTab(1);
    if (tourStep === 'group_tab_stats') onSelectTab(2);
  }, [isMyTour, onSelectTab, tourStep]);

  useEffect(() => {
    // If we leave this screen, don't keep a stale overlay around.
    return () => {
      hideTourOverlay();
    };
  }, [hideTourOverlay]);

  useEffect(() => {
    if (!isMyTour) return;

    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      const t = setTimeout(() => {
        if (cancelled) return;
        measureRefForCurrentStep();
      }, 180);
      return () => clearTimeout(t);
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [isMyTour, measureRefForCurrentStep]);

  useEffect(() => {
    if (!isMyTour) return;
    if (!tourTarget) return;

    const finishTour = () => {
      hideTourOverlay();
      clearTourStep();
      if (user?.id) markTourSeen(user.id);
    };

    showTourOverlay({
      visible: true,
      title:
        tourStep === 'group_share'
          ? 'Menú superior'
          : tourStep === 'group_tab_expenses'
            ? 'Despeses'
            : tourStep === 'group_add_expense_btn'
              ? 'Afegeix una despesa'
              : tourStep === 'group_tab_balances'
                ? 'Balanços'
                : tourStep === 'group_debts_list'
                  ? 'Deutes'
                  : tourStep === 'group_history_btn'
                    ? 'Historial'
                    : tourStep === 'group_tab_stats'
                      ? 'Estadístiques'
                      : 'Tutorial',
      message:
        tourStep === 'group_share'
          ? "Menú superior: Configura el grup, convida amics o edita'n els detalls."
          : tourStep === 'group_tab_expenses'
            ? 'Aquí es veuran totes les despeses que aneu afegint al grup.'
            : tourStep === 'group_add_expense_btn'
              ? 'Prem aquí per afegir una nova despesa o escanejar un tiquet amb IA.'
              : tourStep === 'group_tab_balances'
                ? 'Pantalla de Balanços: Descobreix qui deu a qui i quadra els comptes fàcilment.'
                : tourStep === 'group_debts_list'
                  ? 'Aquí veuràs exactament qui ha de pagar a qui per quadrar els comptes fàcilment.'
                  : tourStep === 'group_history_btn'
                    ? "Consulta l'historial de tots els pagaments i deutes liquidats anteriorment."
                    : tourStep === 'group_tab_stats'
                      ? 'Analitza el viatge amb gràfics Pro i exporta resums en PDF o Excel.'
                      : '',
      buttonLabel: tourStep === 'group_tab_stats' ? 'Acabar' : 'Continuar',
      targetLayout: tourTarget,
      onFailToMount: finishTour,
      onNext: () => {
        if (tourStep === 'group_tab_stats') {
          finishTour();
          return;
        }
        hideTourOverlay();
        setTourTarget(null);
        nextGroupStep();

        InteractionManager.runAfterInteractions(() => {
          setTimeout(() => {
            measureRefForCurrentStep();
          }, 180);
        });
      },
    });
  }, [
    clearTourStep,
    hideTourOverlay,
    isMyTour,
    markTourSeen,
    measureRefForCurrentStep,
    nextGroupStep,
    showTourOverlay,
    tourTarget,
    tourStep,
    user?.id,
  ]);

  return null;
}

