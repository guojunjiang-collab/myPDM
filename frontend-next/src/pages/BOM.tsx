import { useState } from 'react';
import { bomApi } from '../services/api';

export default function BOM() {
  const [mode, setMode] = useState<'compare' | 'trace' | 'docTrace'>('compare');
  const [type1, setType1] = useState<'part' | 'assembly'>('part');
  const [id1, setId1] = useState('');
  const [type2, setType2] = useState<'part' | 'assembly'>('part');
  const [id2, setId2] = useState('');
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const handleCompare = async () => {
    if (!id1 || !id2) return;
    setLoading(true);
    try {
      const response = await bomApi.compare(type1, id1, type2, id2);
      setResult(response.data);
    } catch (error) {
      console.error('BOM对比失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTrace = async () => {
    if (!id1) return;
    setLoading(true);
    try {
      const response = await bomApi.trace(type1, id1);
      setResult(response.data);
    } catch (error) {
      console.error('BOM反查失败', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">管理工具</h2>

      {/* 模式切换 */}
      <div className="flex gap-2 mb-4">
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
        <button
          onClick={() => setMode('docTrace')}
          className={`px-4 py-2 rounded-lg ${
            mode === 'docTrace'
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          图文档反查
        </button>
      </div>

      {/* 输入区域 */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-4">
        {mode === 'compare' && (
          <div className="flex gap-2 items-center">
            <select
              value={type1}
              onChange={(e) => setType1(e.target.value as 'part' | 'assembly')}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="part">零件</option>
              <option value="assembly">部件</option>
            </select>
            <input
              type="text"
              placeholder="请输入ID..."
              value={id1}
              onChange={(e) => setId1(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <span className="text-gray-500">对比</span>
            <select
              value={type2}
              onChange={(e) => setType2(e.target.value as 'part' | 'assembly')}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="part">零件</option>
              <option value="assembly">部件</option>
            </select>
            <input
              type="text"
              placeholder="请输入ID..."
              value={id2}
              onChange={(e) => setId2(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            />
            <button
              onClick={handleCompare}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              对比
            </button>
          </div>
        )}

        {mode === 'trace' && (
          <div className="flex gap-2 items-center">
            <select
              value={type1}
              onChange={(e) => setType1(e.target.value as 'part' | 'assembly')}
              className="px-3 py-2 border border-gray-300 rounded-lg"
            >
              <option value="part">零件</option>
              <option value="assembly">部件</option>
            </select>
            <input
              type="text"
              placeholder="请输入零件/部件ID..."
              value={id1}
              onChange={(e) => setId1(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg flex-1"
            />
            <button
              onClick={handleTrace}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              反查
            </button>
          </div>
        )}

        {mode === 'docTrace' && (
          <div className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="请输入图文档ID..."
              value={id1}
              onChange={(e) => setId1(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg flex-1"
            />
            <button
              onClick={handleTrace}
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              反查
            </button>
          </div>
        )}
      </div>

      {/* 结果展示 */}
      {loading && <div className="text-gray-500">加载中...</div>}
      {result && (
        <div className="bg-white p-4 rounded-lg border border-gray-200">
          <pre className="text-sm">{result}</pre>
        </div>
      )}
    </div>
  );
}