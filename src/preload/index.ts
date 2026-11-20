import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC, type AppState, type MokkanApi } from '../shared/api'

// 画面から使える操作。ファイルには直接触らせず、裏方に頼む
const api: MokkanApi = {
  getState: () => ipcRenderer.invoke(IPC.getState),
  onStateChange: (listener) => {
    const handler = (_: Electron.IpcRendererEvent, state: AppState): void => listener(state)
    ipcRenderer.on(IPC.stateChanged, handler)
    return () => ipcRenderer.removeListener(IPC.stateChanged, handler)
  },
  chooseFolder: () => ipcRenderer.invoke(IPC.chooseFolder),
  initFolder: () => ipcRenderer.invoke(IPC.initFolder),
  createTicket: (tags, template) =>
    ipcRenderer.invoke(IPC.createTicket, tags ?? [], template ?? null),
  createNote: (request) => ipcRenderer.invoke(IPC.createNote, request ?? {}),
  listTemplates: () => ipcRenderer.invoke(IPC.listTemplates),
  getTemplateChoice: (kind) => ipcRenderer.invoke(IPC.getTemplateChoice, kind),
  setTemplateChoice: (kind, name) => ipcRenderer.invoke(IPC.setTemplateChoice, kind, name),
  getAiService: () => ipcRenderer.invoke(IPC.getAiService),
  setAiService: (service) => ipcRenderer.invoke(IPC.setAiService, service),
  createNoteFolder: (parent, name) => ipcRenderer.invoke(IPC.createNoteFolder, parent, name),
  moveNote: (fileName, folder) => ipcRenderer.invoke(IPC.moveNote, fileName, folder),
  createTicketFromNote: (noteFileName, noteBase, title, options) =>
    ipcRenderer.invoke(IPC.createTicketFromNote, noteFileName, noteBase, title, options ?? {}),
  checkRuleFiles: () => ipcRenderer.invoke(IPC.checkRuleFiles),
  updateRuleFiles: (names) => ipcRenderer.invoke(IPC.updateRuleFiles, names),
  createNextRepeat: (fileName) => ipcRenderer.invoke(IPC.createNextRepeat, fileName),
  readTicket: (fileName) => ipcRenderer.invoke(IPC.readTicket, fileName),
  saveTicket: (fileName, baseText, newText, force) =>
    ipcRenderer.invoke(IPC.saveTicket, fileName, baseText, newText, force === true),
  discardIfEmpty: (fileName) => ipcRenderer.invoke(IPC.discardIfEmpty, fileName),
  archiveTicket: (fileName) => ipcRenderer.invoke(IPC.archiveTicket, fileName),
  restoreTicket: (fileName) => ipcRenderer.invoke(IPC.restoreTicket, fileName),
  archiveDoneBefore: (cutoff) => ipcRenderer.invoke(IPC.archiveDoneBefore, cutoff),
  deleteTicket: (fileName) => ipcRenderer.invoke(IPC.deleteTicket, fileName),
  openExternal: (fileName) => ipcRenderer.invoke(IPC.openExternal, fileName),
  revealFolder: () => ipcRenderer.invoke(IPC.revealFolder),
  getListSort: () => ipcRenderer.invoke(IPC.getListSort),
  setListSort: (sort) => ipcRenderer.invoke(IPC.setListSort, sort),
  copyHelpPrompt: (id) => ipcRenderer.invoke(IPC.copyHelpPrompt, id),
  copyTasksDir: () => ipcRenderer.invoke(IPC.copyTasksDir),
  getPaneWidths: () => ipcRenderer.invoke(IPC.getPaneWidths),
  setPaneWidth: (view, width) => ipcRenderer.invoke(IPC.setPaneWidth, view, width),
  getUserName: () => ipcRenderer.invoke(IPC.getUserName),
  setUserName: (userName) => ipcRenderer.invoke(IPC.setUserName, userName),
  setTagColor: (tag, hue) => ipcRenderer.invoke(IPC.setTagColor, tag, hue),
  getOnboarding: () => ipcRenderer.invoke(IPC.getOnboarding),
  dismissOnboarding: () => ipcRenderer.invoke(IPC.dismissOnboarding),
  search: (query, options) => ipcRenderer.invoke(IPC.search, query, options),
  lint: () => ipcRenderer.invoke(IPC.lint),
  backlinks: (fileName) => ipcRenderer.invoke(IPC.backlinks, fileName),
  fixLink: (fileName, href) => ipcRenderer.invoke(IPC.fixLink, fileName, href),
  copyLintReport: () => ipcRenderer.invoke(IPC.copyLintReport),
  suggestTasksFromNote: (noteFileName, noteBase, options) =>
    ipcRenderer.invoke(IPC.suggestTasksFromNote, noteFileName, noteBase, options),
  cancelSuggestTasks: () => ipcRenderer.invoke(IPC.cancelSuggestTasks)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
