import type { DisplayPreferences } from "../hooks/use-display-preferences";
import { FONT_STYLES, FONT_SCALES, FOCUS_ZOOMS, VISIBILITY_MODES, ACCENT_OPTIONS } from "../lib/client-config";

export function DisplaySettings({ preferences, onClose }: { preferences: DisplayPreferences; onClose: () => void }) {
  const {
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
  } = preferences;
  return (
    <aside className="settings-card" aria-label="Display settings">
      <div className="settings-heading"><strong>Display</strong><button onClick={() => onClose()} aria-label="Close settings">×</button></div>
      <label>Typeface</label>
      <div className="segment-control font-control">
        {FONT_STYLES.map((option) => <button className={`${fontStyle === option.value ? "selected " : ""}font-preview-${option.value}`} onClick={() => setFontStyle(option.value)} key={option.value}>{option.label}</button>)}
      </div>
      <label>Lyrics size</label>
      <div className="segment-control">
        {FONT_SCALES.map((size, index) => <button className={fontScale === size ? "selected" : ""} onClick={() => setFontScale(size)} key={size}>{["Small", "Medium", "Large"][index]}</button>)}
      </div>
      <label>Active line zoom</label>
      <div className="segment-control">
        {FOCUS_ZOOMS.map((zoom, index) => <button className={focusZoom === zoom ? "selected" : ""} onClick={() => setFocusZoom(zoom)} key={zoom}>{["Subtle", "Cabin", "Back seat"][index]}</button>)}
      </div>
      <label>Active line underline</label>
      <div className="segment-control binary-control">
        <button className={activeUnderline ? "selected" : ""} onClick={() => setActiveUnderline(true)}>Show</button>
        <button className={!activeUnderline ? "selected" : ""} onClick={() => setActiveUnderline(false)}>Hide</button>
      </div>
      <label>Cabin visibility</label>
      <div className="segment-control visibility-control">
        {VISIBILITY_MODES.map((mode) => <button className={visibilityMode === mode.value ? "selected" : ""} onClick={() => setVisibilityMode(mode.value)} key={mode.value}>{mode.label}</button>)}
      </div>
      <label>Highlight</label>
      <div className="swatches">
        {ACCENT_OPTIONS.map((option) => <button style={{ background: option.color }} className={accent === option.color ? "selected" : ""} onClick={() => setAccent(option.color)} aria-label={`Use ${option.label} theme`} title={option.label} key={option.color} />)}
      </div>
    </aside>
  );
}
