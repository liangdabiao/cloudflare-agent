/** 共享类型 */
import type { Stage } from "./stage-router";

export interface Project {
  id: string;
  clientName: string;
  title: string;
  /** 合同总额（元） */
  total: number;
  /** 分期方案，如 "50/30/20" */
  plan: string;
  stage: Stage;
  /** 已收到的款项（元） */
  received: number;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface OpcState {
  projects: Project[];
  activeId?: string;
}

/** 建档/更新项目的入参（@callable 与工具共用） */
export interface UpsertProjectInput {
  id?: string;
  clientName: string;
  title: string;
  total: number;
  plan?: string;
  stage?: Stage;
  received?: number;
  notes?: string;
}
