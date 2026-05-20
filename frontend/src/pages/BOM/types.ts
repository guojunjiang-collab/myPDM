import type { BOMTraceItem } from '../../types';

export interface SelectOption {
  id: string;
  code: string;
  name: string;
}

export interface TraceTreeNode {
  item: BOMTraceItem;
  level: number;
  children: TraceTreeNode[];
  expanded: boolean;
}
