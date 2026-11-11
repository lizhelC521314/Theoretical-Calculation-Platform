/** 与主进程通信的受控接口（由 electron/preload.cjs 注入） */

export interface CtrUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'engineer';
  createdAt: string;
  lastLoginAt: string | null;
}

export interface HistoryEntry {
  id: string;
  userId: string;
  username: string;
  /** 绑定的项目 ID；null 表示未绑定（临时计算） */
  projectId: string | null;
  formulaId: string;
  formulaTitle: string;
  domain: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  note: string;
  createdAt: string;
}

export interface Project {
  id: string;
  userId: string;
  /** 客户（项目名称的前半段，必填） */
  customer: string;
  /** 项目代号（项目名称的后半段，必填） */
  code: string;
  /** 客户 + 项目代号 自动拼接的展示名（如「长安 CS75-2025」） */
  name: string;
  /** 产品版本号（如 V1.0），用于同一产品的不同设计版本区分 */
  version: string;
  product: string;
  description: string;
  createdAt: string;
}

/** 由 customer + code 拼接项目展示名 */
export function composeProjectName(customer: string, code: string): string {
  const c = customer.trim();
  const d = code.trim();
  if (!c && !d) return '';
  if (!c) return d;
  if (!d) return c;
  return `${c} ${d}`;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
  user?: CtrUser;
}

export interface LicenseInfo {
  machineCode: string;
  activated: boolean;
  activatedAt: string | null;
}

interface CtrApi {
  auth: {
    status(): Promise<{ hasAdmin: boolean; userCount: number }>;
    register(p: { username: string; password: string; displayName?: string }): Promise<AuthResult>;
    login(p: { username: string; password: string }): Promise<AuthResult>;
    list(): Promise<CtrUser[]>;
  };
  history: {
    save(r: Omit<HistoryEntry, 'id' | 'createdAt'>): Promise<{ ok: boolean; entry: HistoryEntry }>;
    list(userId: string): Promise<HistoryEntry[]>;
    remove(id: string): Promise<{ ok: boolean }>;
  };
  project: {
    list(userId: string): Promise<Project[]>;
    create(p: { userId: string; customer: string; code: string; version?: string; product?: string; description?: string }): Promise<{ ok: boolean; message?: string; project?: Project }>;
    remove(id: string): Promise<{ ok: boolean }>;
  };
  license: {
    info(): Promise<LicenseInfo>;
    activate(code: string): Promise<{ ok: boolean; message?: string }>;
  };
  file: {
    save(p: { defaultName: string; content?: string; buffer?: ArrayBuffer; encoding?: 'base64' | 'utf8' }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; message?: string }>;
    saveDocx(p: { defaultName: string; base64: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    savePdf(p: { defaultName: string; html: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    saveXlsx(p: { defaultName: string; base64: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    /** 桌面版：把归档报告原件另存到用户指定位置 */
    copyOut(p: { srcPath: string; defaultName: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string; message?: string }>;
    /** 桌面版：取用户选择文件的真实路径（浏览器返回空串） */
    getPath(file: File): string;
  };
  pdf: {
    /** 桌面版：由主进程提取 PDF 文字层，pages 为逐页文本（用于 CAE 正文第一页取流量） */
    extractText(
      filePath: string,
    ): Promise<{ ok: boolean; text?: string; pages?: string[]; message?: string }>;
    /** 桌面版：主进程逐页 OCR（封面 + 试验项目表格所在页），返回版面行文本、表格中的试验项目与「接受标准」列流量 */
    ocrFirstPage(
      filePath: string,
    ): Promise<{ ok: boolean; text?: string; testItem?: string; flow?: string; flowUnit?: string; message?: string }>;
    /** 桌面版：内置阅读器——页数与首页尺寸（scale=1） */
    pageInfo(filePath: string): Promise<{ ok: boolean; pageCount?: number; width?: number; height?: number; message?: string }>;
    /** 桌面版：内置阅读器——渲染指定页为 PNG data URL */
    renderPage(p: {
      filePath: string;
      page: number;
      scale: number;
    }): Promise<{ ok: boolean; pageCount?: number; page?: number; width?: number; height?: number; dataUrl?: string; message?: string }>;
  };
  db: {
    archive(p: { base64: string; fileName: string; libType: 'calc' | 'test' | 'trusted' | 'cae' | 'material' | 'theory' | 'design' | 'fmea'; overwrite?: boolean }): Promise<{ ok: boolean; filePath?: string; targetDir?: string; message?: string }>;
    list(p: { libType: 'calc' | 'test' | 'trusted' | 'cae' | 'material' | 'theory' | 'design' | 'fmea' }): Promise<{ ok: boolean; dir?: string; files?: { name: string; size: number; mtime: string; fullPath: string }[]; message?: string }>;
    read(p: { fullPath: string }): Promise<{ ok: boolean; rows?: unknown[][]; sheetCount?: number; message?: string }>;
    /** 读取文本类归档；材料库 .parquet 由主进程转为 JSON 文本 */
    readText(p: { fullPath: string }): Promise<{ ok: boolean; text?: string; message?: string }>;
    pdfData(filePath: string): Promise<{ ok: boolean; fileUrl?: string; size?: number; message?: string }>;
    remove(p: { fullPath: string }): Promise<{ ok: boolean; message?: string }>;
    ping(): Promise<{ reachable: boolean; root: string; calc: string; test: string; trusted: string; cae: string; material: string; kbeRoot: string; kbeTheory: string; kbeDesign: string; kbeFmea: string; kbeTraining: string }>;
  };
  material: {
    /** 材料库：以 Apache Parquet 写入一条记录 */
    write(p: { record: unknown; fileName: string; overwrite?: boolean }): Promise<{
      ok: boolean;
      exists?: boolean;
      filePath?: string;
      targetDir?: string;
      message?: string;
    }>;
  };
  fmea: {
    /** FMEA库：一张知识卡片写入一个 Parquet 文件 */
    write(p: { record: unknown; fileName: string; overwrite?: boolean }): Promise<{
      ok: boolean;
      exists?: boolean;
      filePath?: string;
      targetDir?: string;
      message?: string;
    }>;
    /** FMEA库：按项目 id 筛选所有被该项目引用过的 FMEA 记录 */
    listByProject(p: { projectId: string }): Promise<{
      ok: boolean;
      records?: unknown[];
      message?: string;
    }>;
  };
  theory: {
    /** 知识理论：导入 PPT / Word / PDF 并统一转 PDF，返回入库记录 */
    import(p: {
      srcPath: string;
      title: string;
      author: string;
      publishedAt: string;
      category?: string;
      createdBy?: string;
      createdByDisplay?: string;
    }): Promise<{ ok: boolean; record?: unknown; pdfPath?: string; dir?: string; message?: string }>;
    /** 知识理论：列出已入库资料 */
    list(): Promise<{ ok: boolean; dir?: string; records?: unknown[]; message?: string }>;
    /** 知识理论：更新资料名 / 作者 / 日期 / 类别 */
    update(p: {
      id: string;
      title?: string;
      author?: string;
      publishedAt?: string;
      category?: string;
    }): Promise<{ ok: boolean; record?: unknown; message?: string }>;
    /** 知识理论：删除记录及归档 PDF */
    delete(p: { id: string }): Promise<{ ok: boolean; message?: string }>;
  };
  training: {
    /** 培训：导入资料并自动转 PDF，返回入库记录 */
    import(p: {
      srcPath: string;
      title: string;
      trainer: string;
      trainedAt: string;
      category?: string;
      createdBy?: string;
      createdByDisplay?: string;
    }): Promise<{ ok: boolean; record?: unknown; pdfPath?: string; dir?: string; message?: string }>;
    /** 培训：列出已入库资料 */
    list(): Promise<{ ok: boolean; dir?: string; records?: unknown[]; message?: string }>;
    /** 培训：读取资料封面文字，用于自动识别培训人与培训时间 */
    extractCover(filePath: string): Promise<{ ok: boolean; text?: string; message?: string }>;
    /** 培训：更新标题 / 培训人 / 时间 / 类别 */
    update(p: {
      id: string;
      title?: string;
      trainer?: string;
      trainedAt?: string;
      category?: string;
    }): Promise<{ ok: boolean; record?: unknown; message?: string }>;
    /** 培训：删除记录及归档 PDF */
    delete(p: { id: string }): Promise<{ ok: boolean; message?: string }>;
  };
  ppt: {
    /** 桌面版：PPT / PPTX 转文字版 PDF（PowerPoint / WPS / LibreOffice），返回临时路径与 base64 */
    toPdf(filePath: string): Promise<{ ok: boolean; pdfPath?: string; pdfBase64?: string; message?: string }>;
    /** 桌面版：清理转换产生的临时 PDF */
    cleanup(pdfPath: string): Promise<{ ok: boolean; message?: string }>;
  };
  app: {
    info(): Promise<{ version: string; dataDir: string }>;
    /** 桌面版：用系统默认程序打开文件（支持 UNC 路径） */
    openPath(filePath: string): Promise<{ ok: boolean; message?: string }>;
  };
  lab: {
    /** 读取实验库（LabStore）快照；null 表示尚无数据 */
    get(): Promise<unknown | null>;
    set(snapshot: unknown): Promise<{ ok: true } | { ok: false; error: string }>;
  };
}

/**
 * 浏览器直开（非 Electron）时的内存实现，仅用于界面调试。
 * 桌面程序内始终使用 preload 注入的真实实现。
 */
const demoUser: CtrUser = {
  id: 'demo-user',
  username: 'demo',
  displayName: '演示用户',
  role: 'engineer',
  createdAt: new Date().toISOString(),
  lastLoginAt: null,
};

// 浏览器调试用的内存数据（刷新页面即丢失，仅保证交互流程可走通）
const mem = { history: [] as HistoryEntry[], projects: [] as Project[], lab: null as unknown };

const fallback: CtrApi = {
  auth: {
    status: async () => ({ hasAdmin: true, userCount: 1 }),
    register: async () => ({ ok: false, message: '浏览器调试模式不支持注册' }),
    login: async (p) =>
      p.username === 'demo' && p.password === '123456'
        ? { ok: true, user: demoUser }
        : { ok: false, message: '演示账号：demo / 123456' },
    list: async () => [demoUser],
  },
  history: {
    save: async (r) => {
      const entry = { ...r, id: String(Date.now()), createdAt: new Date().toISOString() };
      mem.history.unshift(entry);
      return { ok: true, entry };
    },
    list: async (userId) => mem.history.filter((h) => h.userId === userId),
    remove: async (id) => {
      mem.history = mem.history.filter((h) => h.id !== id);
      return { ok: true };
    },
  },
  project: {
    list: async (userId) => mem.projects.filter((p) => p.userId === userId),
    create: async (p) => {
      const customer = p.customer.trim();
      const code = p.code.trim();
      if (!customer || !code) return { ok: false, message: '客户和项目代号均不能为空' };
      const name = composeProjectName(customer, code);
      if (mem.projects.some((x) => x.userId === p.userId && x.name === name)) {
        return { ok: false, message: '已存在同名项目' };
      }
      const project: Project = {
        id: String(Date.now()),
        userId: p.userId,
        customer,
        code,
        name,
        version: (p.version ?? '').trim(),
        product: p.product ?? '',
        description: p.description ?? '',
        createdAt: new Date().toISOString(),
      };
      mem.projects.push(project);
      return { ok: true, project };
    },
    remove: async (id) => {
      mem.projects = mem.projects.filter((p) => p.id !== id);
      for (const h of mem.history) if (h.projectId === id) h.projectId = null;
      return { ok: true };
    },
  },
  license: {
    info: async () => ({ machineCode: 'BROWSER-DEMO-00000-00000', activated: true, activatedAt: null }),
    activate: async () => ({ ok: true }),
  },
  file: {
    save: async () => ({ ok: false, canceled: true }),
    saveDocx: async () => ({ ok: false, canceled: true }),
    savePdf: async () => ({ ok: false, canceled: true }),
    saveXlsx: async () => ({ ok: false, canceled: true }),
    copyOut: async () => ({ ok: false, message: '浏览器调试模式不支持导出本地文件' }),
    getPath: () => '',
  },
  pdf: {
    extractText: async () => ({ ok: false, message: '浏览器调试模式不支持主进程解析' }),
    ocrFirstPage: async () => ({ ok: false, message: '浏览器调试模式不支持系统 OCR' }),
    pageInfo: async () => ({ ok: false, message: '浏览器调试模式不支持内置 PDF 阅读器' }),
    renderPage: async () => ({ ok: false, message: '浏览器调试模式不支持内置 PDF 阅读器' }),
  },
  db: {
    archive: async () => ({ ok: false, message: '浏览器调试模式下无法写入 UNC 路径' }),
    list: async () => ({ ok: false, files: [] }),
    read: async () => ({ ok: false, rows: [] }),
    readText: async () => ({ ok: false, message: '浏览器调试模式无法读取 UNC 路径文件' }),
    pdfData: async () => ({ ok: false, message: '浏览器调试模式无法读取 UNC 路径 PDF' }),
    remove: async () => ({ ok: false, message: '浏览器调试模式无法删除服务器文件' }),
    ping: async () => ({ reachable: false, root: '', calc: '', test: '', trusted: '', cae: '', material: '', kbeRoot: '', kbeTheory: '', kbeDesign: '', kbeFmea: '', kbeTraining: '' }),
  },
  material: {
    write: async () => ({ ok: false, message: '浏览器调试模式无法写入 UNC 路径' }),
  },
  fmea: {
    write: async () => ({ ok: false, message: '浏览器调试模式无法写入 UNC 路径' }),
    listByProject: async () => ({ ok: false, records: [], message: '浏览器调试模式无法读取 FMEA 库' }),
  },
  theory: {
    import: async () => ({ ok: false, message: '浏览器调试模式无法写入 UNC 路径' }),
    list: async () => ({ ok: false, records: [], message: '浏览器调试模式无法读取 UNC 路径' }),
    update: async () => ({ ok: false, message: '浏览器调试模式无法更新知识理论' }),
    delete: async () => ({ ok: false, message: '浏览器调试模式无法删除知识理论' }),
  },
  training: {
    import: async () => ({ ok: false, message: '浏览器调试模式无法写入 UNC 路径' }),
    list: async () => ({ ok: false, records: [], message: '浏览器调试模式无法读取 UNC 路径' }),
    extractCover: async () => ({ ok: false, message: '浏览器调试模式无法读取本地资料封面' }),
    update: async () => ({ ok: false, message: '浏览器调试模式无法更新培训资料' }),
    delete: async () => ({ ok: false, message: '浏览器调试模式无法删除培训资料' }),
  },
  ppt: {
    toPdf: async () => ({ ok: false, message: '浏览器调试模式不支持 PPT 转 PDF' }),
    cleanup: async () => ({ ok: false, message: '浏览器调试模式不支持清理临时文件' }),
  },
  app: {
    info: async () => ({ version: '0.1.0-browser', dataDir: '(浏览器调试)' }),
    openPath: async () => ({ ok: false, message: '浏览器调试模式无法调用本地程序打开文件' }),
  },
  lab: {
    get: async () => mem.lab,
    set: async (snapshot) => {
      mem.lab = snapshot ?? null;
      return { ok: true as const };
    },
  },
};

export const api: CtrApi = (window as unknown as { ctr?: CtrApi }).ctr ?? fallback;

export const isDesktop = !!(window as unknown as { ctr?: CtrApi }).ctr;
