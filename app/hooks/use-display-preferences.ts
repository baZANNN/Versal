"use client";

import { useEffect, useState } from "react";
import type { FontStyle, VisibilityMode } from "../lib/client-types";
import {
  DISPLAY_PREFERENCES_KEY,
  FONT_SCALES,
  FONT_STYLES,
  FOCUS_ZOOMS,
  ACCENT_OPTIONS,
  VISIBILITY_MODES,
} from "../lib/client-config";

/** Validates saved values before applying them; never writes defaults over stored preferences. */
export function useDisplayPreferences() {
  const [fontScale, setFontScale] = useState(1);
  const [fontStyle, setFontStyle] = useState<FontStyle>("modern");
  const [focusZoom, setFocusZoom] = useState(1.45);
  const [activeUnderline, setActiveUnderline] = useState(true);
  const [accent, setAccent] = useState("#d8ff65");
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("balanced");
  const [displayPreferencesReady, setDisplayPreferencesReady] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(DISPLAY_PREFERENCES_KEY);
      if (stored) {
        const preferences = JSON.parse(stored) as Partial<{ fontScale: number; fontStyle: FontStyle; focusZoom: number; activeUnderline: boolean; accent: string; visibilityMode: VisibilityMode }>;
        if (FONT_SCALES.some((value) => value === preferences.fontScale)) setFontScale(preferences.fontScale!);
        if (FONT_STYLES.some((option) => option.value === preferences.fontStyle)) setFontStyle(preferences.fontStyle!);
        if (FOCUS_ZOOMS.some((value) => value === preferences.focusZoom)) setFocusZoom(preferences.focusZoom!);
        if (typeof preferences.activeUnderline === "boolean") setActiveUnderline(preferences.activeUnderline);
        if (ACCENT_OPTIONS.some((option) => option.color === preferences.accent)) setAccent(preferences.accent!);
        if (VISIBILITY_MODES.some((option) => option.value === preferences.visibilityMode)) setVisibilityMode(preferences.visibilityMode!);
      }
    } catch {
      // Keep safe defaults when browser storage is unavailable or malformed.
    } finally {
      setDisplayPreferencesReady(true);
    }
  }, []);

  useEffect(() => {
    if (!displayPreferencesReady) return;
    try {
      window.localStorage.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify({ fontScale, fontStyle, focusZoom, activeUnderline, accent, visibilityMode }));
    } catch {
      // Display preferences remain usable for the current session.
    }
  }, [accent, activeUnderline, displayPreferencesReady, focusZoom, fontScale, fontStyle, visibilityMode]);

  return {
    fontScale,
    setFontScale,
    fontStyle,
    setFontStyle,
    focusZoom,
    setFocusZoom,
    activeUnderline,
    setActiveUnderline,
    accent,
    setAccent,
    visibilityMode,
    setVisibilityMode,
  };
}

export type DisplayPreferences = ReturnType<typeof useDisplayPreferences>;
