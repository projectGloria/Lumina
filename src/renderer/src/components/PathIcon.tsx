import { Icon, type IconName } from './Icon'
import { vaultUrl } from '../editor/resources'
import { useSettings } from '../store/settingsStore'

/**
 * The visual identity of one vault path.
 *
 * FileTree used to be the only place that knew about uploaded icons, built-in
 * overrides and colours. Keeping that knowledge here lets tabs, pickers,
 * breadcrumbs and starred notes render the exact same path consistently.
 */
export default function PathIcon({
  path,
  kind = 'file',
  size = 14,
  className
}: {
  path: string
  kind?: 'file' | 'folder'
  size?: number
  className?: string
}): React.JSX.Element {
  const iconOverride = useSettings((s) => s.settings.iconOverrides[path]) as IconName | undefined
  const colorOverride = useSettings((s) => s.settings.colorOverrides[path])
  const customIcon = useSettings((s) => s.settings.customIcons[path])

  if (customIcon) {
    return (
      <img
        src={vaultUrl(customIcon)}
        className={`path-icon-custom${className ? ` ${className}` : ''}`}
        style={{ width: size, height: size }}
        alt=""
        draggable={false}
      />
    )
  }

  return (
    <Icon
      name={iconOverride ?? kind}
      size={size}
      className={className}
      style={{ color: colorOverride ?? (kind === 'folder' ? 'var(--lum-folder)' : undefined) }}
    />
  )
}
