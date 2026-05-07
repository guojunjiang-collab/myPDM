import { useEffect, useState } from 'react';
import { boardApi, partsApi, assembliesApi, documentsApi } from '../services/api';

interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  shared: boolean;
}

interface BoardItem {
  id: string;
  item_type: string;
  item_id: string;
  item_name?: string;
  item_code?: string;
}

export default function Board() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addItemType, setAddItemType] = useState<'part' | 'assembly' | 'document'>('part');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);

  // TODO: implement folder editing
  void editingFolder;
  void setEditingFolder;

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    if (selectedFolder) {
      loadItems(selectedFolder);
    } else {
      setItems([]);
    }
  }, [selectedFolder]);

  const loadFolders = async () => {
    try {
      const response = await boardApi.getFolders();
      setFolders(response.data || []);
    } catch (error) {
      console.error('加载文件夹失败', error);
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (folderId: string) => {
    try {
      const response = await boardApi.getItems(folderId);
      setItems(response.data || []);
    } catch (error) {
      console.error('加载收藏项失败', error);
    }
  };

  const handleCreateFolder = async () => {
    const name = prompt('请输入文件夹名称：');
    if (!name) return;
    try {
      await boardApi.createFolder({ name });
      loadFolders();
    } catch (error) {
      alert('创建失败');
    }
  };

  const handleRenameFolder = async (folder: Folder) => {
    const name = prompt('请输入新的文件夹名称：', folder.name);
    if (!name || name === folder.name) return;
    try {
      await boardApi.updateFolder(folder.id, { name });
      loadFolders();
    } catch (error) {
      alert('重命名失败');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('确定要删除该文件夹吗？')) return;
    try {
      await boardApi.deleteFolder(id);
      loadFolders();
      if (selectedFolder === id) {
        setSelectedFolder(null);
        setItems([]);
      }
    } catch (error) {
      alert('删除失败');
    }
  };

  const handleShareFolder = async (folder: Folder) => {
    try {
      await boardApi.shareFolder(folder.id, { shared: !folder.shared });
      loadFolders();
    } catch (error) {
      alert('操作失败');
    }
  };

  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      let response;
      if (addItemType === 'part') {
        response = await partsApi.list({ search: searchKeyword });
        setSearchResults((response.data.items || []).map((item: any) => ({
          ...item,
          _type: 'part',
          _typeLabel: '零件',
        })));
      } else if (addItemType === 'assembly') {
        response = await assembliesApi.list({ search: searchKeyword });
        setSearchResults((response.data.items || []).map((item: any) => ({
          ...item,
          _type: 'assembly',
          _typeLabel: '部件',
        })));
      } else {
        response = await documentsApi.list({ search: searchKeyword });
        setSearchResults((response.data.items || []).map((item: any) => ({
          ...item,
          _type: 'document',
          _typeLabel: '图文档',
        })));
      }
    } catch (error) {
      console.error('搜索失败', error);
    }
  };

  const handleAddItem = async (item: any) => {
    if (!selectedFolder) {
      alert('请先选择一个文件夹');
      return;
    }
    try {
      await boardApi.addItem(selectedFolder, {
        item_type: item._type,
        item_id: item.id,
      });
      setShowAddModal(false);
      setSearchKeyword('');
      setSearchResults([]);
      loadItems(selectedFolder);
    } catch (error) {
      alert('添加失败');
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedFolder || !confirm('确定要取消收藏吗？')) return;
    try {
      await boardApi.removeItem(selectedFolder, itemId);
      loadItems(selectedFolder);
    } catch (error) {
      alert('取消收藏失败');
    }
  };

  const getItemTypeIcon = (type: string) => {
    const icons: Record<string, string> = {
      part: '🔧',
      assembly: '📦',
      document: '📄',
    };
    return icons[type] || '📋';
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">用户看板</h2>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setSelectedFolder(null);
              setShowAddModal(true);
            }}
            disabled={folders.length === 0}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            + 添加收藏
          </button>
          <button
            onClick={handleCreateFolder}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            新建文件夹
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* 文件夹列表 */}
        <div className="w-64 bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">我的文件夹</h3>
          {folders.length === 0 ? (
            <p className="text-sm text-gray-500">暂无文件夹</p>
          ) : (
            <ul className="space-y-1">
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer group ${
                    selectedFolder === folder.id
                      ? 'bg-primary-50 text-primary-600'
                      : 'hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedFolder(folder.id)}
                >
                  <div className="flex items-center gap-2">
                    <span>{folder.shared ? '🔗' : '📁'}</span>
                    <span className="text-sm truncate">{folder.name}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleShareFolder(folder); }}
                      className="p-1 text-gray-400 hover:text-primary-600"
                      title={folder.shared ? '取消共享' : '共享'}
                    >
                      {folder.shared ? '🔗' : '🔓'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRenameFolder(folder); }}
                      className="p-1 text-gray-400 hover:text-primary-600"
                      title="重命名"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                      className="p-1 text-gray-400 hover:text-red-600"
                      title="删除"
                    >
                      🗑️
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 收藏项列表 */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 p-4">
          {selectedFolder ? (
            <>
              <h3 className="text-sm font-medium text-gray-500 mb-2">
                收藏项 ({items.length})
              </h3>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">暂无收藏项，点击"添加收藏"来添加</p>
              ) : (
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-100 hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{getItemTypeIcon(item.item_type)}</span>
                        <div>
                          <p className="text-sm font-medium">{item.item_code || item.item_type}</p>
                          <p className="text-xs text-gray-500">{item.item_name || item.item_type}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-2 text-gray-400 hover:text-red-600"
                        title="取消收藏"
                      >
                        🗑️
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">请选择一个文件夹，或点击"添加收藏"选择目标文件夹</p>
          )}
        </div>
      </div>

      {/* 添加收藏 Modal */}
      <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 ${showAddModal ? '' : 'hidden'}`}>
        <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-semibold">添加收藏</h3>
            <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          <div className="p-6">
            {/* 文件夹选择 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">目标文件夹</label>
              <select
                value={selectedFolder || ''}
                onChange={(e) => setSelectedFolder(e.target.value || null)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="">选择文件夹...</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
            </div>

            {/* 类型选择 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
              <div className="flex gap-2">
                {(['part', 'assembly', 'document'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => { setAddItemType(type); setSearchResults([]); }}
                    className={`px-4 py-2 rounded-lg ${
                      addItemType === type
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {type === 'part' ? '🔧 零件' : type === 'assembly' ? '📦 部件' : '📄 图文档'}
                  </button>
                ))}
              </div>
            </div>

            {/* 搜索 */}
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="搜索..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={handleSearch}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
              >
                搜索
              </button>
            </div>

            {/* 搜索结果 */}
            <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">
              {searchResults.length === 0 ? (
                <p className="p-4 text-center text-gray-500">搜索零件、部件或图文档</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {searchResults.map((item) => (
                    <li
                      key={item.id}
                      onClick={() => handleAddItem(item)}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                    >
                      <span className="text-lg">{getItemTypeIcon(item._type)}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{item.code || item._type}</p>
                        <p className="text-xs text-gray-500">{item.name}</p>
                      </div>
                      <span className="text-xs text-gray-400">{item._typeLabel}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}