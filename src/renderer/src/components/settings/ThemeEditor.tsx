import { useCallback, useEffect, useState } from 'react'
import type { ThemeFile } from '@shared/types'
import { Icon } from '../Icon'
import { PRESETS, THEME_GROUPS, useSettings } from '../../store/settingsStore'
import { toast } from '../../store/uiStore'

/** Read what a token currently resolves to, override or stylesheet default. */
function computedToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--lum-${token}`).trim()
}

/** `<input type="color">` only speaks `#rrggbb`; everything else falls back. */
function asHex(value: string): string | null {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i)
  if (!m) return null
  const hex = (n: string): string => Number(n).toString(16).padStart(2, '0')
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
}

export default function ThemeEditor(): React.JSX.Element {
  const settings = useSettings((s) => s.settings)
  const theme = useSettings((s) => s.theme)
  const mode = useSettings((s) => s.mode)
  const snippets = useSettings((s) => s.snippets)
  const patch = useSettings((s) => s.patch)
  const setToken = useSettings((s) => s.setToken)
  const clearToken = useSettings((s) => s.clearToken)
  const resetTheme = useSettings((s) => s.resetTheme)
  const setPreset = useSettings((s) => s.setPreset)
  const importTheme = useSettings((s) => s.importTheme)

  // Colours differ per mode, so the editor always edits the one on screen.
  const editing = mode

  return (
    <div className="settings-body">
      <section className="settings-section">
        <h3 className="settings-heading">Theme</h3>

        <div className="field-row">
          <div>
            <div className="field-label">Appearance</div>
            <div className="field-hint">
              Following the system switches with Windows light and dark mode.
            </div>
          </div>
          <div className="field-control seg">
            <button className="setting-default" onClick={() => patch({ themeMode: 'system' })}>Default</button>
            {(['light', 'dark', 'system'] as const).map((option) => (
              <button
                key={option}
                className={`seg-btn${settings.themeMode === option ? ' is-active' : ''}`}
                data-tooltip={`Set theme to ${option}`}
                onClick={() => patch({ themeMode: option })}
              >
                {option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <div>
            <div className="field-label">Preset</div>
            <div className="field-hint">The palette your own colour edits sit on top of.</div>
          </div>
          <div className="field-control seg">
            <button className="setting-default" onClick={() => setPreset('claude')}>Default</button>
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                className={`seg-btn${theme.preset === preset.id ? ' is-active' : ''}`}
                data-tooltip={`Use ${preset.label} preset`}
                onClick={() => setPreset(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section">
        <div className="settings-heading-row">
          <h3 className="settings-heading">Colours — {editing} mode</h3>
          <button className="btn btn-ghost btn-small" data-tooltip="Reset theme to defaults" onClick={resetTheme}>
            Reset all
          </button>
        </div>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Editing the theme you can see. Switch to {editing === 'dark' ? 'light' : 'dark'} above to
          adjust the other one; the two are stored separately.
        </p>

        {THEME_GROUPS.map((group) => (
          <div key={group.label} className="token-group">
            <div className="panel-subtitle">{group.label}</div>
            {group.tokens.map((token) => (
              <TokenRow
                key={token.name}
                token={token.name}
                label={token.label}
                overridden={theme[editing]?.[token.name] !== undefined}
                onChange={(value) => setToken(editing, token.name, value)}
                onReset={() => clearToken(editing, token.name)}
              />
            ))}
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Shape</h3>
        <SliderRow
          label="Corner radius"
          hint="Applies to cards, buttons, popovers and code blocks."
          value={parseInt(theme[editing]?.radius ?? computedToken('radius'), 10) || 10}
          min={0}
          max={20}
          step={1}
          suffix="px"
          defaultValue={10}
          onChange={(v) => setToken(editing, 'radius', `${v}px`)}
        />
      </section>

      <section className="settings-section">
        <div className="settings-heading-row">
          <h3 className="settings-heading">CSS snippets</h3>
          <button
            className="btn btn-ghost btn-small"
            data-tooltip="Open the snippets folder in your file manager"
            onClick={() => void window.lumina.snippets.openFolder()}
          >
            <Icon name="external" size={13} />
            Open folder
          </button>
        </div>
        <p className="field-hint" style={{ marginBottom: 12 }}>
          Drop a <code>.css</code> file into the snippets folder and it loads immediately. Every
          colour and dimension above is a <code>--lum-*</code> variable you can override.
        </p>

        {snippets.length ? (
          snippets.map((snippet) => {
            const on = settings.snippets[snippet.name] !== false
            return (
              <div key={snippet.name} className="field-row">
                <div>
                  <div className="field-label">{snippet.name}</div>
                  <div className="field-hint">{snippet.css.split('\n').length} lines</div>
                </div>
                <div className="field-control">
                  <button
                    className="setting-default"
                    onClick={() => patch({ snippets: { ...settings.snippets, [snippet.name]: true } })}
                  >Default</button>
                  <button
                    className={`switch${on ? ' on' : ''}`}
                    role="switch"
                    aria-checked={on}
                    aria-label={`Enable ${snippet.name}`}
                    onClick={() =>
                      patch({ snippets: { ...settings.snippets, [snippet.name]: !on } })
                    }
                  />
                </div>
              </div>
            )
          })
        ) : (
          <p className="field-hint">No snippets yet.</p>
        )}
      </section>

      <section className="settings-section">
        <h3 className="settings-heading">Share a theme</h3>
        <div className="settings-row-buttons">
          <button
            className="btn"
            data-tooltip="Copy the current theme settings to your clipboard"
            onClick={() => {
              void navigator.clipboard.writeText(JSON.stringify(theme, null, 2))
              toast('Theme copied to the clipboard')
            }}
          >
            <Icon name="download" size={14} />
            Copy theme JSON
          </button>
          <button
            className="btn"
            data-tooltip="Paste theme settings from your clipboard"
            onClick={() => {
              void navigator.clipboard.readText().then((text) => {
                try {
                  const parsed = JSON.parse(text) as ThemeFile
                  if (!parsed || typeof parsed !== 'object' || !('light' in parsed)) {
                    throw new Error('not a theme')
                  }
                  importTheme({
                    preset: parsed.preset ?? 'claude',
                    light: parsed.light ?? {},
                    dark: parsed.dark ?? {}
                  })
                  toast('Theme applied')
                } catch {
                  toast('The clipboard does not contain a Lumina theme', 'error')
                }
              })
            }}
          >
            Paste theme JSON
          </button>
        </div>
      </section>
    </div>
  )
}

function TokenRow({
  token,
  label,
  overridden,
  onChange,
  onReset
}: {
  token: string
  label: string
  overridden: boolean
  onChange: (value: string) => void
  onReset: () => void
}): React.JSX.Element {
  const [value, setValue] = useState('')

  // Re-read whenever the theme moves under us: preset change, reset, or a
  // snippet redefining the same variable.
  const sync = useCallback(() => setValue(computedToken(token)), [token])
  useEffect(sync, [sync, overridden])

  const hex = asHex(value)

  return (
    <div className="token-row">
      <label className="token-swatch" style={{ background: value || 'transparent' }}>
        <input
          type="color"
          value={hex ?? '#000000'}
          aria-label={label}
          onChange={(e) => {
            setValue(e.target.value)
            onChange(e.target.value)
          }}
        />
      </label>
      <span className="token-label">{label}</span>
      <input
        className="token-input"
        type="text"
        value={value}
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => onChange(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(value)
        }}
      />
      <button
        className="icon-btn token-reset"
        data-tooltip={overridden ? 'Reset to the preset value' : 'Unchanged'}
        aria-label="Reset"
        disabled={!overridden}
        style={{ opacity: overridden ? 1 : 0.25 }}
        onClick={() => {
          onReset()
          requestAnimationFrame(sync)
        }}
      >
        <Icon name="refresh" size={13} />
      </button>
    </div>
  )
}

export function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  suffix,
  defaultValue,
  onChange
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  suffix?: string
  defaultValue?: number
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint ? <div className="field-hint">{hint}</div> : null}
      </div>
      <div className="field-control">
        {defaultValue !== undefined ? (
          <button
            className="setting-default"
            data-tooltip="Restore default"
            aria-label={`Restore default ${label}`}
            onClick={() => onChange(defaultValue)}
          >
            Default
          </button>
        ) : null}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="field-value">
          {value}
          {suffix ?? ''}
        </span>
      </div>
    </div>
  )
}
