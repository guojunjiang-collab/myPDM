import { useState, useEffect } from 'react';
import { bomApi, assembliesApi } from '../services/api';
import { Modal } from '../components/Modal';

interface BOMNode {
  id: string;
  code: string;
  name: string;
  type: 'part' | 'assembly';
  quantity: number;
  children?: BOMNode[];
  expanded?: boolean;
}

interface SelectOption {
  id: string;
  code: string;
  name: string;
}

export default function BOM() {
  const [mode, setMode] = useState<'tree' | 'compare' | 'trace'>('tree');

  // BOM 树模式
  const [assemblies, setAssemblies] = useState<SelectOption[]>([]);
  const [selectedAssembly, setSelectedAssembly] = useState('');
  const [bomTree, setBomTree] = useState<BOMNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailModal, setDetailModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BOMNode | null>(null);

  // BOM 对比模式
  const [compareLeft, setCompareLeft] = useState<SelectOption | null>(null);
  const [compareRight, setCompareRight] = useState<SelectOption | null>(null);
  const [compareResult, setCompareResult] = useState<string>('');

  // BOM 反查模式
  const [traceType, setTraceType] = useState<'part' | 'assembly'>('part');
  const [traceId, setTraceId] = useState('');
  const [traceResult, setTraceResult] = useState<BOMNode[]>([]);

  // 加载部件列表用于选择
  useEffect(() => {
    loadAssemblies();
  }, []);

  const loadAssemblies = async () => {
    try {
      const response = await assembliesApi.list({ status: 'released' });
      const items = response.data.items || [];
      setAssemblies(items.map((a: { id: string; code: string; name: string }) => ({
        id: a.id,
        code: a.code,
        name: a.name,
      })));
    } catch (error) {
      console.error('加载部件失败', error);
    }
  };

  // 加载 BOM 树
  const loadBomTree = async (assemblyId: string) => {
    setLoading(true);
    try {
      const response = await bomApi.getTree('assembly', assemblyId);
      const items = response.data || [];

      // 构建树形结构
      const tree = await buildTree(items);
      setBomTree(tree);
    } catch (error) {
      console.error('加载BOM树失败', error);
    } finally {
      setLoading(false);
    }
  };

  // 递归构建树
  const buildTree = async (items: any[]): Promise<BOMNode[]> => {
    const result: BOMNode[] = [];
    for (const item of items) {
      const childDetail = item.child_detail;
      if (!childDetail) continue;

      const node: BOMNode = {
        id: item.child_id,
        code: childDetail.code,
        name: childDetail.name,
        type: childDetail.type,
        quantity: item.quantity || 1,
      };

      // 如果是部件，递归加载子节点
      if (childDetail.type === 'assembly') {
        try {
          const children = await bomApi.getTree('assembly', item.child_id);
          node.children = await buildTree(children.data || []);
        } catch {
          node.children = [];
        }
      }

      result.push(node);
    }
    return result;
  };

  // 展开/折叠节点
  const toggleExpand = (node: BOMNode) => {
    node.expanded = !node.expanded;
    setBomTree([...bomTree]);
  };

  // 显示详情
  const showDetail = (node: BOMNode) => {
    setSelectedItem(node);
    setDetailModal(true);
  };

  // 执行 BOM 对比
  const handleCompare = async () => {
    if (!compareLeft || !compareRight) return;
    setLoading(true);
    try {
      const response = await bomApi.compare(
        'assembly', compareLeft.id,
        'assembly', compareRight.id
      );
      setCompareResult(JSON.stringify(response.data, null, 2));
    } catch (error) {
      setCompareResult('对比失败: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 执行 BOM 反查
  const handleTrace = async () => {
    if (!traceId) return;
    setLoading(true);
    try {
      const response = await bomApi.trace(traceType, traceId);
      setTraceResult(response.data || []);
    } catch (error) {
      console.error('反查失败', error);
    } finally {
      setLoading(false);
    }
  };

  // 渲染树节点
  const renderTreeNode = (node: BOMNode, level: number = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    return (
      <div key={node.id} style={{ marginLeft: level * 20 }}>
        <div
          className="flex items-center gap-2 py-2 px-3 hover:bg-gray-50 rounded cursor-pointer border-b border-gray-100"
          onClick={() => showDetail(node)}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(node); }}
              className="w-5 h-5 flex items-center justify-center text-gray-500 hover:bg-gray-200 rounded"
            >
              {node.expanded ? '▼' : '▶'}
            </button>
          ) : (
            <span className="w-5 h-5" />
          )}
          <span className={`px-2 py-0.5 text-xs rounded ${
            node.type === 'assembly' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'
          }`}>
            {node.type === 'assembly' ? '部件' : '零件'}
          </span>
          <span className="font-medium text-sm">{node.code}</span>
          <span className="text-gray-600 text-sm">{node.name}</span>
          <span className="text-gray-400 text-xs">×{node.quantity}</span>
        </div>
        {node.expanded && hasChildren && (
          <div>
            {node.children!.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">BOM 管理</h2>

      {/* 模式切换 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('tree')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'tree'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 树
        </button>
        <button
          onClick={() => setMode('compare')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'compare'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 对比
        </button>
        <button
          onClick={() => setMode('trace')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'trace'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          BOM 反查
        </button>
      </div>

      {/* BOM 树模式 */}
      {mode === 'tree' && (
        <div>
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="flex gap-4 items-center">
              <select
                value={selectedAssembly}
                onChange={(e) => setSelectedAssembly(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg flex-1"
              >
                <option value="">请选择部件...</option>
                {assemblies.map(a => (
                  <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                ))}
              </select>
              <button
                onClick={() => loadBomTree(selectedAssembly)}
                disabled={!selectedAssembly || loading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                加载 BOM
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : bomTree.length > 0 ? (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-600">
                  共 {bomTree.length} 个顶层项
                </span>
              </div>
              <div className="p-2">
                {bomTree.map(node => renderTreeNode(node))}
              </div>
            </div>
          ) : selectedAssembly ? (
            <div className="text-center py-8 text-gray-500">暂无 BOM 数据</div>
          ) : null}
        </div>
      )}

      {/* BOM 对比模式 */}
      {mode === 'compare' && (
        <div>
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">左侧部件</label>
                <select
                  value={compareLeft?.id || ''}
                  onChange={(e) => {
                    const a = assemblies.find(x => x.id === e.target.value);
                    setCompareLeft(a || null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">选择部件...</option>
                  {assemblies.map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">右侧部件</label>
                <select
                  value={compareRight?.id || ''}
                  onChange={(e) => {
                    const a = assemblies.find(x => x.id === e.target.value);
                    setCompareRight(a || null);
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="">选择部件...</option>
                  {assemblies.map(a => (
                    <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              onClick={handleCompare}
              disabled={!compareLeft || !compareRight || loading}
              className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              开始对比
            </button>
          </div>

          {compareResult && (
            <div className="bg-white p-4 rounded-lg border border-gray-200">
              <pre className="text-sm whitespace-pre-wrap">{compareResult}</pre>
            </div>
          )}
        </div>
      )}

      {/* BOM 反查模式 */}
      {mode === 'trace' && (
        <div>
          <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
            <div className="flex gap-2 items-center">
              <select
                value={traceType}
                onChange={(e) => setTraceType(e.target.value as 'part' | 'assembly')}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              >
                <option value="part">零件</option>
                <option value="assembly">部件</option>
              </select>
              <input
                type="text"
                placeholder="请输入ID..."
                value={traceId}
                onChange={(e) => setTraceId(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg flex-1"
              />
              <button
                onClick={handleTrace}
                disabled={!traceId || loading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                反查
              </button>
            </div>
          </div>

          {traceResult.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="p-3 border-b border-gray-200 bg-gray-50">
                <span className="text-sm text-gray-600">
                  找到 {traceResult.length} 个关联项
                </span>
              </div>
              <div className="p-2">
                {traceResult.map((item: any) => (
                  <div key={item.id} className="py-2 px-3 border-b border-gray-100">
                    <span className="font-medium">{item.code}</span> - {item.name}
                    <span className="text-gray-400 text-sm ml-2">
                      ({item.parent_type === 'assembly' ? '被部件引用' : '被零件引用'})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 详情 Modal */}
      <Modal
        open={detailModal}
        title="BOM 项详情"
        onClose={() => setDetailModal(false)}
        width="md"
      >
        {selectedItem && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-500">类型</label>
                <p className="font-medium">
                  {selectedItem.type === 'assembly' ? '部件' : '零件'}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-500">数量</label>
                <p className="font-medium">{selectedItem.quantity}</p>
              </div>
            </div>
            <div>
              <label className="text-sm text-gray-500">编号</label>
              <p className="font-medium">{selectedItem.code}</p>
            </div>
            <div>
              <label className="text-sm text-gray-500">名称</label>
              <p className="font-medium">{selectedItem.name}</p>
            </div>
            {selectedItem.children && selectedItem.children.length > 0 && (
              <div>
                <label className="text-sm text-gray-500">子节点数量</label>
                <p className="font-medium">{selectedItem.children.length}</p>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}