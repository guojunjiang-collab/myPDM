import { create } from 'zustand';
import { projectApi } from '../services/projectApi';
import type { Project, ProjectTask } from '../types/project';

interface ProjectState {
  projects: Project[];
  currentProject: Project | null;
  tasks: ProjectTask[];
  loading: boolean;
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  loadTasks: (id: string) => Promise<void>;
  patchTask: (taskId: string, patch: Partial<ProjectTask>) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  projects: [],
  currentProject: null,
  tasks: [],
  loading: false,
  loadProjects: async () => {
    set({ loading: true });
    try {
      const res = await projectApi.listProjects();
      set({ projects: res.data.items });
    } finally {
      set({ loading: false });
    }
  },
  loadProject: async (id) => {
    const res = await projectApi.getProject(id);
    set({ currentProject: res.data });
  },
  loadTasks: async (id) => {
    // 不清空 tasks：编辑保存后的 reload 原地刷新不闪屏（项目切换处已显式清空）
    set({ loading: true });
    try {
      const res = await projectApi.listTasks(id);
      set({ tasks: res.data.items });
    } finally {
      set({ loading: false });
    }
  },
  patchTask: (taskId, patch) => {
    set(state => {
      // 递归更新：任务可能位于任意层级（children 子树内），保证子任务编辑后原地刷新生效
      const update = (list: ProjectTask[]): ProjectTask[] =>
        list.map(t =>
          t.id === taskId
            ? { ...t, ...patch }
            : t.children
              ? { ...t, children: update(t.children) }
              : t,
        );
      return { tasks: update(state.tasks) };
    });
  },
}));
