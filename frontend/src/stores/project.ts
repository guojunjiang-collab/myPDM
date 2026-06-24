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
    set({ loading: true });
    try {
      const res = await projectApi.listTasks(id);
      set({ tasks: res.data.items });
    } finally {
      set({ loading: false });
    }
  },
}));
