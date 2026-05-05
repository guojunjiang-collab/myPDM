/**
 * 文件上传工具类 - 支持分块上传
 */

const API_BASE = '/api/v2';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB 每块
const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB 最大文件大小

/**
 * 获取认证头
 * @returns {Object} 包含 Authorization 的 headers
 */
function _getAuthHeaders() {
  const headers = {};
  const token = localStorage.getItem('bom_api_token');
  if (token) {
    headers['Authorization'] = 'Bearer ' + token;
  }
  return headers;
}

/**
 * 文件上传器
 */
class FileUploader {
  constructor(options = {}) {
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.maxFileSize = options.maxFileSize || MAX_FILE_SIZE;
    this.onProgress = options.onProgress || (() => {});
    this.onComplete = options.onComplete || (() => {});
    this.onError = options.onError || (() => {});
  }

  /**
   * 上传文件（自动选择直接上传或分块上传）
   * @param {File} file - 文件对象
   * @param {string} entityType - 实体类型 (document, part, assembly)
   * @param {string} entityId - 实体ID
   * @returns {Promise<Object>} 上传结果
   */
  async upload(file, entityType, entityId) {
    // 检查文件大小
    if (file.size > this.maxFileSize) {
      throw new Error(`文件大小 ${this._formatSize(file.size)} 超过限制 ${this._formatSize(this.maxFileSize)}`);
    }

    // 小文件直接上传
    if (file.size <= this.chunkSize * 2) {
      return await this._directUpload(file, entityType, entityId);
    }

    // 大文件分块上传
    return await this._chunkedUpload(file, entityType, entityId);
  }

  /**
   * 直接上传（小文件）
   * @param {File} file - 文件对象
   * @param {string} entityType - 实体类型
   * @param {string} entityId - 实体ID
   * @returns {Promise<Object>} 上传结果
   */
  async _directUpload(file, entityType, entityId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', entityType);
    formData.append('entity_id', entityId);

    const response = await fetch(`${API_BASE}/attachments/upload`, {
      method: 'POST',
      headers: _getAuthHeaders(),
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '上传失败');
    }

    const result = await response.json();
    
    // 如果服务器建议使用分块上传
    if (result.status === 'suggest_chunked') {
      return await this._chunkedUpload(file, entityType, entityId);
    }

    this.onComplete(result);
    return result;
  }

  /**
   * 分块上传（大文件）
   * @param {File} file - 文件对象
   * @param {string} entityType - 实体类型
   * @param {string} entityId - 实体ID
   * @returns {Promise<Object>} 上传结果
   */
  async _chunkedUpload(file, entityType, entityId) {
    const totalChunks = Math.ceil(file.size / this.chunkSize);
    
    // 1. 初始化上传
    const initResponse = await fetch(`${API_BASE}/attachments/chunk/init`, {
      method: 'POST',
      headers: { ..._getAuthHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        filename: file.name,
        file_size: file.size,
        entity_type: entityType,
        entity_id: entityId,
      }),
    });

    if (!initResponse.ok) {
      const error = await initResponse.json();
      throw new Error(error.detail || '初始化上传失败');
    }

    const { upload_id, total_chunks } = await initResponse.json();
    
    // 2. 上传所有分块
    const uploadedChunks = [];
    
    for (let i = 0; i < total_chunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, file.size);
      const chunk = file.slice(start, end);
      
      const chunkFormData = new FormData();
      chunkFormData.append('upload_id', upload_id);
      chunkFormData.append('chunk_index', i);
      chunkFormData.append('chunk', chunk);
      
      const chunkResponse = await fetch(`${API_BASE}/attachments/chunk/upload`, {
        method: 'POST',
        headers: _getAuthHeaders(),
        body: chunkFormData,
      });

      if (!chunkResponse.ok) {
        const error = await chunkResponse.json();
        throw new Error(error.detail || `分块 ${i} 上传失败`);
      }

      const chunkResult = await chunkResponse.json();
      uploadedChunks.push(i);
      
      // 更新进度
      this.onProgress({
        upload_id,
        uploaded_chunks: uploadedChunks,
        total_chunks,
        progress: (uploadedChunks.length / total_chunks) * 100,
        current_chunk: i,
      });
    }

    // 3. 完成上传
    const completeResponse = await fetch(`${API_BASE}/attachments/chunk/complete`, {
      method: 'POST',
      headers: { ..._getAuthHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        upload_id,
      }),
    });

    if (!completeResponse.ok) {
      const error = await completeResponse.json();
      throw new Error(error.detail || '完成上传失败');
    }

    const result = await completeResponse.json();
    this.onComplete(result);
    return result;
  }

  /**
   * 获取上传状态
   * @param {string} uploadId - 上传ID
   * @returns {Promise<Object>} 上传状态
   */
  async getStatus(uploadId) {
    const response = await fetch(`${API_BASE}/attachments/chunk/status/${uploadId}`, {
      headers: _getAuthHeaders(),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '获取状态失败');
    }

    return await response.json();
  }

  /**
   * 取消上传
   * @param {string} uploadId - 上传ID
   * @returns {Promise<Object>} 取消结果
   */
  async cancel(uploadId) {
    const response = await fetch(`${API_BASE}/attachments/chunk/cancel/${uploadId}`, {
      method: 'DELETE',
      headers: _getAuthHeaders(),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || '取消上传失败');
    }

    return await response.json();
  }

  /**
   * 格式化文件大小
   * @param {number} bytes - 字节数
   * @returns {string} 格式化后的大小
   */
  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
}

/**
 * 上传文件（便捷方法）
 * @param {File} file - 文件对象
 * @param {string} entityType - 实体类型
 * @param {string} entityId - 实体ID
 * @param {Object} options - 选项
 * @returns {Promise<Object>} 上传结果
 */
async function uploadFile(file, entityType, entityId, options = {}) {
  const uploader = new FileUploader(options);
  return await uploader.upload(file, entityType, entityId);
}

/**
 * 下载文件（流式下载，比 base64 更快）
 * @param {string} attachmentId - 附件ID
 * @param {string} filename - 文件名（用于保存时的默认文件名）
 * @returns {Promise<void>}
 */
async function downloadFile(attachmentId, filename) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5分钟超时

  try {
    const response = await fetch(`${API_BASE}/attachments/${attachmentId}/stream`, {
      headers: _getAuthHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: '下载失败' }));
      throw new Error(error.detail || '下载失败');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'attachment';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 获取文件流式 URL（用于预览等场景）
 * @param {string} attachmentId - 附件ID
 * @returns {string} blob URL
 */
async function getFileBlobUrl(attachmentId) {
  const response = await fetch(`${API_BASE}/attachments/${attachmentId}/stream`, {
    headers: _getAuthHeaders(),
  });
  if (!response.ok) {
    throw new Error('文件加载失败');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// 导出
window.FileUploader = FileUploader;
window.uploadFile = uploadFile;
window.downloadFile = downloadFile;
window.getFileBlobUrl = getFileBlobUrl;
