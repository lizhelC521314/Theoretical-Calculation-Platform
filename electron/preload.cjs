const { contextBridge, ipcRenderer, webUtils } = require('electron');

// 通过预加载脚本暴露受控接口，渲染进程不直接接触 Node API
const bridge = {
  auth: {
    status: () => ipcRenderer.invoke('auth:status'),
    register: (p) => ipcRenderer.invoke('auth:register', p),
    login: (p) => ipcRenderer.invoke('auth:login', p),
    list: () => ipcRenderer.invoke('auth:list'),
  },
  history: {
    save: (r) => ipcRenderer.invoke('history:save', r),
    list: (userId) => ipcRenderer.invoke('history:list', userId),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
  },
  project: {
    list: (userId) => ipcRenderer.invoke('project:list', userId),
    create: (p) => ipcRenderer.invoke('project:create', p),
    remove: (id) => ipcRenderer.invoke('project:remove', id),
  },
  license: {
    info: () => ipcRenderer.invoke('license:info'),
    activate: (code) => ipcRenderer.invoke('license:activate', code),
  },
  file: {
    save: (payload) => ipcRenderer.invoke('export:save', payload),
    saveDocx: (payload) => ipcRenderer.invoke('export:docx', payload),
    savePdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
    saveXlsx: (payload) => ipcRenderer.invoke('export:xlsx', payload),
    getPath: (file) => webUtils.getPathForFile(file),
  },
  pdf: {
    extractText: (filePath) => ipcRenderer.invoke('test:pdfText', filePath),
  },
  db: {
    archive: (p) => ipcRenderer.invoke('db:archive', p),
    list: (p) => ipcRenderer.invoke('db:list', p),
    read: (p) => ipcRenderer.invoke('db:read', p),
    pdfData: (filePath) => ipcRenderer.invoke('db:pdfData', filePath),
    remove: (p) => ipcRenderer.invoke('db:delete', p),
    ping: () => ipcRenderer.invoke('db:ping'),
  },
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openPath: (filePath) => ipcRenderer.invoke('app:openPath', filePath),
  },
  lab: {
    get: () => ipcRenderer.invoke('lab:get'),
    set: (snapshot) => ipcRenderer.invoke('lab:set', snapshot),
  },
};

contextBridge.exposeInMainWorld('ctr', bridge);
