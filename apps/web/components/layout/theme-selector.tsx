'use client';

import { useState } from 'react';
import { Check, Palette } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { DASHBOARD_THEME_LABELS, DASHBOARD_THEMES, setTheme } from '@/lib/theme';
import type { DashboardThemeMode } from '@/types/dashboard';

type ThemeSelectorProps = {
  value: DashboardThemeMode;
  onChange: (theme: DashboardThemeMode) => void;
};

const THEME_SWATCHES: Record<DashboardThemeMode, [string, string, string]> = {
  black: ['#060b13', '#101926', '#3fc8ff'],
  gray: ['#161a22', '#2a323f', '#52b9ff'],
  white: ['#f3f6fb', '#ffffff', '#005fc0'],
  'high-contrast': ['#000000', '#ffffff', '#00e5ff'],
};

function ThemeSwatch({ theme }: { theme: DashboardThemeMode }) {
  const colors = THEME_SWATCHES[theme];

  return (
    <span className="inline-flex items-center gap-1">
      {colors.map((color) => (
        <span
          key={`${theme}-${color}`}
          className="h-2.5 w-2.5 rounded-full border border-border"
          style={{ backgroundColor: color }}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

export function ThemeSelector({ value, onChange }: ThemeSelectorProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSelect = (theme: DashboardThemeMode) => {
    onChange(theme);
    setTheme(theme);
  };

  return (
    <>
      <div className="hidden sm:block">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
          <span>Actual: {DASHBOARD_THEME_LABELS[value]}</span>
          <ThemeSwatch theme={value} />
        </div>
        <select
          className="h-10 w-full rounded-xl border border-slate-700/70 bg-slate-900/85 px-3 text-sm text-slate-100"
          value={value}
          onChange={(event) => handleSelect(event.target.value as DashboardThemeMode)}
          aria-label="Selector de tema"
        >
          {DASHBOARD_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {DASHBOARD_THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button type="button" variant="secondary" size="sm" className="w-full sm:hidden">
            <Palette className="mr-1.5 h-4 w-4" />
            Tema
          </Button>
        </SheetTrigger>
        <SheetContent className="inset-x-0 bottom-0 top-auto h-auto max-h-[80dvh] max-w-none overflow-y-auto rounded-t-2xl border-l-0 border-t border-slate-700/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader className="pr-10">
            <SheetTitle>Tema visual</SheetTitle>
            <SheetDescription>Selecciona el tema para toda la app.</SheetDescription>
          </SheetHeader>
          <div className="mt-3 grid gap-2">
            {DASHBOARD_THEMES.map((theme) => (
              <Button
                key={theme}
                type="button"
                variant={value === theme ? 'default' : 'outline'}
                className="justify-between"
                onClick={() => {
                  handleSelect(theme);
                  setMobileOpen(false);
                }}
              >
                <span className="inline-flex items-center gap-2">
                  <ThemeSwatch theme={theme} />
                  {DASHBOARD_THEME_LABELS[theme]}
                </span>
                {value === theme ? <Check className="h-4 w-4" /> : null}
              </Button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
