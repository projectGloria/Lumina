import { useMemo } from 'react'
import { useUi } from '@/store/uiStore'
import { useVault } from '@/store/vaultStore'
import { useWorkspace } from '@/store/workspaceStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface TagsConfig extends Record<string, unknown> {
  count: number
}

function Tags({ config }: WidgetProps<TagsConfig>): React.JSX.Element {
  const index = useVault((s) => s.index)
  const tags = useMemo(
    () =>
      Object.entries(index.tags)
        .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
        .slice(0, Math.max(1, config.count)),
    [index, config.count]
  )

  if (!tags.length) return <p className="home-widget-empty">No tags in this vault yet.</p>

  return (
    <div className="home-tags">
      {tags.map(([tag, paths]) => (
        <button
          key={tag}
          className="home-tag"
          data-tooltip={`Show notes tagged #${tag}`}
          onClick={() => {
            // Filtering alone is invisible from a board, so the explorer that
            // shows the result comes with it.
            useUi.getState().setTagFilter(tag)
            useWorkspace.getState().setLeftPanel('files')
          }}
        >
          <span className="home-tag-name">#{tag}</span>
          <span className="home-tag-count">{paths.length}</span>
        </button>
      ))}
    </div>
  )
}

function TagsSettings({ config, setConfig }: WidgetSettingsProps<TagsConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Tags shown</span>
      <input
        type="number"
        min={1}
        max={60}
        value={config.count}
        onChange={(e) => setConfig({ count: Number(e.target.value) || 1 })}
      />
    </label>
  )
}

export const tagsWidget = defineWidget<TagsConfig>({
  type: 'tags',
  name: 'Tags',
  description: 'The vault’s tags, most used first',
  icon: 'tag',
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  defaultConfig: { count: 14 },
  Component: Tags,
  Settings: TagsSettings
})
