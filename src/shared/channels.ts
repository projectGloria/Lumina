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
  fontsList: 'fonts:list',
  settingsProfilesList: 'settingsProfiles:list',
  settingsProfilesSave: 'settingsProfiles:save',
  settingsProfilesDelete: 'settingsProfiles:delete',
  settingsProfilesImport: 'settingsProfiles:import',
  settingsProfilesExport: 'settingsProfiles:export',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  snippetsGet: 'snippets:get',
  snippetsChanged: 'snippets:changed',
  snippetsOpenFolder: 'snippets:openFolder',

  // workspace persistence
  workspaceGet: 'workspace:get',
  workspaceSet: 'workspace:set',

  // the home dashboard's widget layout
  homeGet: 'home:get',
  homeSet: 'home:set',

  // files handed to us by the OS (double-click, "open with")
  fileOpen: 'file:open',
  fileOpened: 'file:opened',
  filePending: 'file:pending',

  // link banners
  linkPreview: 'link:preview',

  // the OS-wide quick note
  quickNote: 'quickNote:requested',
  quickNotePending: 'quickNote:pending',
  quickNoteStatus: 'quickNote:status',

  // shutdown
  appFlush: 'app:flush',
  appFlushed: 'app:flushed',

  // profiles
  profileList: 'profile:list',
  profileCreate: 'profile:create',
  profileRename: 'profile:rename',
  profileDelete: 'profile:delete',
  profileSetVault: 'profile:setVault',
  profileSetPassword: 'profile:setPassword',
  profileUnlock: 'profile:unlock',
  profileSwitch: 'profile:switch',
  profileSignOut: 'profile:signOut',

  // the web clipper
  clipArrived: 'clip:arrived',
  clipPending: 'clip:pending',
  clipStatus: 'clip:status',
  clipRegenerateToken: 'clip:regenerateToken',
  clipSaveImage: 'clip:saveImage',
  clipDone: 'clip:done',

  // voice notes and dictation
  voiceStatus: 'voice:status',
  voiceTranscribe: 'voice:transcribe',
  voiceLiveStart: 'voice:liveStart',
  voiceLiveChunk: 'voice:liveChunk',
  voiceLiveStop: 'voice:liveStop',
  speechPacks: 'speech:packs',
  speechInstall: 'speech:install',
  speechImport: 'speech:import',
  speechRemove: 'speech:remove',
  speechProgress: 'speech:progress',

  // misc
  attachmentSave: 'attachment:save',
  exportPdf: 'export:pdf',
  exportHtml: 'export:html',
  openExternal: 'shell:openExternal',
  menuCommand: 'menu:command'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
