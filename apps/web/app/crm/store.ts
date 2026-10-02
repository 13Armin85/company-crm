import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
interface Toast {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}
interface UIState {
  workspaceSlug?: string;
  sidebarCollapsed: boolean;
  notificationOpen: boolean;
  commandOpen: boolean;
  createOpen: boolean;
  createKind: "issue" | "project";
  theme: ThemeMode;
  density: Density;
  dirtyForms: string[];
  toasts: Toast[];
  setSidebarCollapsed: (value: boolean) => void;
  setNotificationOpen: (value: boolean) => void;
  setCommandOpen: (value: boolean) => void;
  setCreateOpen: (value: boolean, kind?: "issue" | "project") => void;
  setTheme: (value: ThemeMode) => void;
  setDensity: (value: Density) => void;
  setWorkspaceSlug: (value: string) => void;
  setFormDirty: (key: string, value: boolean) => void;
  clearDirtyForms: () => void;
  toast: (message: string, kind?: Toast["kind"]) => void;
  removeToast: (id: number) => void;
}
const savedTheme = typeof window !== "undefined" ? (localStorage.getItem("hamkar-theme") as ThemeMode) : "light";
const savedDensity =
  typeof window !== "undefined" ? (localStorage.getItem("hamkar-density") as Density) : "comfortable";
export const useUIStore = create<UIState>((set, get) => ({
  workspaceSlug: typeof window !== "undefined" ? localStorage.getItem("hamkar-workspace") || undefined : undefined,
  sidebarCollapsed: false,
  notificationOpen: false,
  commandOpen: false,
  createOpen: false,
  createKind: "issue",
  theme: savedTheme || "light",
  density: savedDensity || "comfortable",
  dirtyForms: [],
  toasts: [],
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setNotificationOpen: (notificationOpen) => set({ notificationOpen }),
  setCommandOpen: (commandOpen) => set({ commandOpen }),
  setCreateOpen: (createOpen, createKind) =>
    set((state) => ({ createOpen, createKind: createKind ?? state.createKind })),
  setTheme: (theme) => {
    localStorage.setItem("hamkar-theme", theme);
    set({ theme });
  },
  setDensity: (density) => {
    localStorage.setItem("hamkar-density", density);
    set({ density });
  },
  setWorkspaceSlug: (workspaceSlug) => {
    localStorage.setItem("hamkar-workspace", workspaceSlug);
    set({ workspaceSlug });
  },
  setFormDirty: (key, value) =>
    set((state) => ({
      dirtyForms: value
        ? state.dirtyForms.includes(key)
          ? state.dirtyForms
          : [...state.dirtyForms, key]
        : state.dirtyForms.filter((item) => item !== key),
    })),
  clearDirtyForms: () => set({ dirtyForms: [] }),
  toast: (message, kind = "success") => {
    const id = Date.now();
    set({ toasts: [...get().toasts, { id, message, kind }] });
    window.setTimeout(() => get().removeToast(id), 3600);
  },
  removeToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}));
