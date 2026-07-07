import type { AssemblyInstance } from '../../services/api';

export interface InstanceIndex {
  pathsByBomItem: Map<string, Set<string>>;
  leafBomItemByPath: Map<string, string>;
}

export function buildInstanceIndex(instances: AssemblyInstance[]): InstanceIndex {
  const pathsByBomItem = new Map<string, Set<string>>();
  const leafBomItemByPath = new Map<string, string>();
  for (const inst of instances) {
    for (const bomId of inst.bom_path) {
      const set = pathsByBomItem.get(bomId) ?? new Set<string>();
      set.add(inst.path);
      pathsByBomItem.set(bomId, set);
    }
    const leaf = inst.bom_path[inst.bom_path.length - 1];
    if (leaf) leafBomItemByPath.set(inst.path, leaf);
  }
  return { pathsByBomItem, leafBomItemByPath };
}
