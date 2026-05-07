import { useEffect, useState } from 'react';
import { boardApi } from '../services/api';

interface Folder {
  id: string;
  name: string;
  parent_id?: string;
  shared: boolean;
  created: string;
}

interface BoardItem {
  id: string;
  item_type: string;
  item_id: string;
}

export default function Board() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [items, setItems] = useState<BoardItem[]>([]);

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    if (selectedFolder) {
      loadItems(selectedFolder);
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

  const handleRemoveItem = async (itemId: string) => {
    if (!selectedFolder || !confirm('确定要取消收藏吗？')) return;
    try {
      await boardApi.removeItem(selectedFolder, itemId);
      loadItems(selectedFolder);
    } catch (error) {
      alert('取消收藏失败');
    }
  };

  if (loading) {
    return <div className="text-gray-500">加载中...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">用户看板</h2>
        <button
          onClick={handleCreateFolder}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700"
        >
          新建文件夹
        </button>
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
                  className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer ${
                    selectedFolder === folder.id
                      ? 'bg-primary-50 text-primary-600'
                      : 'hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedFolder(folder.id)}
                >
                  <span className="text-sm">📁 {folder.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFolder(folder.id);
                    }}
                    className="text-gray-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 收藏项列表 */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 p-4">
          {selectedFolder ? (
            <>
              <h3 className="text-sm font-medium text-gray-500 mb-2">收藏项</h3>
              {items.length === 0 ? (
                <p className="text-sm text-gray-500">暂无收藏项</p>
              ) : (
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50"
                    >
                      <span className="text-sm">{item.item_type}</span>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-gray-400 hover:text-red-600"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500">请选择一个文件夹</p>
          )}
        </div>
      </div>
    </div>
  );
}