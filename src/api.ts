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
    save(p: { defaultName: string; content: string }): Promise<{ ok: boolean; canceled?: boolean }>;
    saveDocx(p: { defaultName: string; base64: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    savePdf(p: { defaultName: string; html: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    saveXlsx(p: { defaultName: string; base64: string }): Promise<{ ok: boolean; canceled?: boolean; filePath?: string }>;
    /** 桌面版：取用户选择文件的真实路径（浏览器返回空串） */
    getPath(file: File): string;
  };
  pdf: {
    /** 桌面版：由主进程提取 PDF 文字层 */
    extractText(filePath: string): Promise<{ ok: boolean; text?: string; message?: string }>;
  };
  db: {
    archive(p: { base64: string; fileName: string; libType: 'calc' | 'test' | 'trusted' | 'theory' | 'design' | 'fmea' }): Promise<{ ok: boolean; filePath?: string; targetDir?: string; message?: string }>;
    list(p: { libType: 'calc' | 'test' | 'trusted' | 'theory' | 'design' | 'fmea' }): Promise<{ ok: boolean; dir?: string; files?: { name: string; size: number; mtime: string; fullPath: string }[]; message?: string }>;
    read(p: { fullPath: string }): Promise<{ ok: boolean; rows?: unknown[][]; sheetCount?: number; message?: string }>;
    pdfData(filePath: string): Promise<{ ok: boolean; fileUrl?: string; size?: number; message?: string }>;
    ping(): Promise<{ reachable: boolean; root: string; calc: string; test: string; trusted: string; kbeRoot: string; kbeTheory: string; kbeDesign: string; kbeFmea: string }>;
  };
  app: {
    info(): Promise<{ version: string; dataDir: string }>;
    /** 桌面版：用系统默认程序打开文件（支持 UNC 路径） */
    openPath(filePath: string): Promise<{ ok: boolean; message?: string }>;
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
const mem = { history: [] as HistoryEntry[], projects: [] as Project[] };

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
    getPath: () => '',
  },
  pdf: {
    extractText: async () => ({ ok: false, message: '浏览器调试模式不支持主进程解析' }),
  },
  db: {
    archive: async () => ({ ok: false, message: '浏览器调试模式下无法写入 UNC 路径' }),
    list: async () => ({ ok: false, files: [] }),
    read: async () => ({ ok: false, rows: [] }),
    pdfData: async () => ({ ok: false, message: '浏览器调试模式无法读取 UNC 路径 PDF' }),
    ping: async () => ({ reachable: false, root: '', calc: '', test: '', trusted: '', kbeRoot: '', kbeTheory: '', kbeDesign: '', kbeFmea: '' }),
  },
  app: {
    info: async () => ({ version: '0.1.0-browser', dataDir: '(浏览器调试)' }),
    openPath: async () => ({ ok: false, message: '浏览器调试模式无法调用本地程序打开文件' }),
  },
};

export const api: CtrApi = (window as unknown as { ctr?: CtrApi }).ctr ?? fallback;

export const isDesktop = !!(window as unknown as { ctr?: CtrApi }).ctr;
