'use client';

import { useEffect } from 'react';

import { useDashboardStore } from '@/store/dashboard-store';

const THEME_CLASS = {
  Default: 'theme-default',
  iOS26: 'theme-ios26',
} as const;

export function ThemeController() {
  const themeMode = useDashboardStore((state) => state.themeMode);

  useEffect(() => {
    const target = document.body;
    target.classList.remove(THEME_CLASS.Default, THEME_CLASS.iOS26);
    target.classList.add(themeMode === 'iOS26' ? THEME_CLASS.iOS26 : THEME_CLASS.Default);
    target.dataset.themeMode = themeMode;
  }, [themeMode]);

  return null;
}
