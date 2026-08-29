/** Every IPC channel name in one place, so main and preload cannot drift. */
export const CH = {
  // window chrome
  winMinimize: 'win:minimize',
  winMaximize: 'win:maximize',
  winClose: 'win:close',
  winIsMaximized: 'win:isMaximized',
  winMaximizeChanged: 'win:maximizeChanged',

  // vault lifecycle
  vaultPick: 'vault:pick',
  vaultCreate: 'vault:create',
  vaultOpen: 'vault:open',
  vaultCurrent: 'vault:current',
  vaultRecent: 'vault:recent',
  vaultTree: 'vault:tree',
  vaultReveal: 'vault:reveal',
  vaultOpened: 'vault:opened',
  vaultChanged: 'vault:changed',

  // notes
  noteRead: 'note:read',
  noteWrite: 'note:write',
  noteCreate: 'note:create',
  noteRename: 'note:rename',
  noteDelete: 'note:delete',
  noteCreateFolder: 'note:createFolder',
  noteExists: 'note:exists',

  // index + search
  indexGet: 'index:get',
  indexUpdated: 'index:updated',
  searchQuery: 'search:query',

  // settings, theme, snippets
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  snippetsGet: 'snippets:get',
  snippetsChanged: 'snippets:changed',
  snippetsOpenFolder: 'snippets:openFolder',

  // workspace persistence
  workspaceGet: 'workspace:get',
  workspaceSet: 'workspace:set',

  // files handed to us by the OS (double-click, "open with")
  fileOpen: 'file:open',
  fileOpened: 'file:opened',
  filePending: 'file:pending',

  // shutdown
  appFlush: 'app:flush',
  appFlushed: 'app:flushed',

  // misc
  attachmentSave: 'attachment:save',
  exportPdf: 'export:pdf',
  exportHtml: 'export:html',
  openExternal: 'shell:openExternal',
  menuCommand: 'menu:command'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
