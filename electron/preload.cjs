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
    /** 导出报告原件副本（另存归档文件） */
    copyOut: (payload) => ipcRenderer.invoke('file:copyOut', payload),
    getPath: (file) => webUtils.getPathForFile(file),
  },
  pdf: {
    extractText: (filePath) => ipcRenderer.invoke('test:pdfText', filePath),
    ocrFirstPage: (filePath) => ipcRenderer.invoke('pdf:ocrFirstPage', filePath),
    /** 内置阅读器：页数与尺寸 */
    pageInfo: (filePath) => ipcRenderer.invoke('pdf:pageInfo', filePath),
    /** 内置阅读器：渲染指定页为 PNG data URL */
    renderPage: (p) => ipcRenderer.invoke('pdf:renderPage', p),
  },
  material: {
    write: (p) => ipcRenderer.invoke('material:write', p),
  },
  fmea: {
    write: (p) => ipcRenderer.invoke('fmea:write', p),
    listByProject: (p) => ipcRenderer.invoke('fmea:listByProject', p),
  },
  theory: {
    import: (p) => ipcRenderer.invoke('theory:import', p),
    list: () => ipcRenderer.invoke('theory:list'),
    update: (p) => ipcRenderer.invoke('theory:update', p),
    delete: (p) => ipcRenderer.invoke('theory:delete', p),
  },
  training: {
    import: (p) => ipcRenderer.invoke('training:import', p),
    list: () => ipcRenderer.invoke('training:list'),
    extractCover: (filePath) => ipcRenderer.invoke('training:extractCover', filePath),
    update: (p) => ipcRenderer.invoke('training:update', p),
    delete: (p) => ipcRenderer.invoke('training:delete', p),
  },
  db: {
    archive: (p) => ipcRenderer.invoke('db:archive', p),
    list: (p) => ipcRenderer.invoke('db:list', p),
    read: (p) => ipcRenderer.invoke('db:read', p),
    readText: (p) => ipcRenderer.invoke('db:readText', p),
    pdfData: (filePath) => ipcRenderer.invoke('db:pdfData', filePath),
    remove: (p) => ipcRenderer.invoke('db:delete', p),
    ping: () => ipcRenderer.invoke('db:ping'),
  },
  ppt: {
    /** CAE 报告：PPT / PPTX 转文字版 PDF，返回临时路径与 base64 */
    toPdf: (filePath) => ipcRenderer.invoke('ppt:toPdf', filePath),
    /** 清理转换产生的临时 PDF */
    cleanup: (pdfPath) => ipcRenderer.invoke('ppt:cleanup', pdfPath),
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
