import { useSyncExternalStore } from 'react'
import { getPresetsSnapshot, subscribePresets } from '../utils/permissionPresetStore'

/**
 * Saved permission presets (utils/permissionPresetStore). Every component
 * that uses the hook re-renders when a preset is created, changed, applied
 * or deleted – also from another browser tab.
 */
export function usePermissionPresets() {
  return useSyncExternalStore(subscribePresets, getPresetsSnapshot, getPresetsSnapshot)
}

export default usePermissionPresets
