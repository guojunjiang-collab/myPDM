import { useState, useEffect, useCallback, useRef } from 'react';
import { cadBridge } from '../services/cadBridge';
import { useAuthStore } from '../stores/auth';

export interface CATIAStatus {
  active: boolean;
  has_document?: boolean;
  doc_name?: string;
  doc_type?: string;
  doc_path?: string;
}

export interface AssemblyTreeNode {
  instance_name: string;
  path: string;
  level: number;
  is_assembly: boolean;
  children: AssemblyTreeNode[];
  matrix?: number[] | null;
  properties?: {
    builtin: Record<string, string>;
    user_properties: Record<string, string>;
  };
}

export function useCADBridge() {
  const [connected, setConnected] = useState(false);
  const [catiaStatus, setCatiaStatus] = useState<CATIAStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useAuthStore((s) => s.token) || '';
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    cadBridge.setStatusCallback(setConnected);
    return () => {
      cadBridge.disconnect();
    };
  }, []);

  const ensureConnected = useCallback(async (): Promise<void> => {
    if (connected) return;
    setLoading(true);
    try {
      await cadBridge.connect(tokenRef.current);
    } catch (e: any) {
      throw new Error('无法连接到 CAD 桥接服务，请确认服务已启动');
    } finally {
      setLoading(false);
    }
  }, [connected]);

  const ping = useCallback(async (): Promise<boolean> => {
    try {
      const result = await cadBridge.call('catia.ping', {}, tokenRef.current);
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }, []);

  const detectCATIA = useCallback(async (): Promise<CATIAStatus> => {
    await ensureConnected();
    const result = await cadBridge.call('catia.detect', {}, tokenRef.current);
    setCatiaStatus(result);
    return result;
  }, [ensureConnected]);

  const readAssemblyTree = useCallback(async (): Promise<AssemblyTreeNode> => {
    await ensureConnected();
    return cadBridge.call('catia.assembly.read_tree', {}, tokenRef.current);
  }, [ensureConnected]);

  const readProperties = useCallback(async (path: string): Promise<AssemblyTreeNode['properties']> => {
    await ensureConnected();
    return cadBridge.call('catia.assembly.read_properties', { path }, tokenRef.current);
  }, [ensureConnected]);

  const writeProperty = useCallback(async (path: string, propName: string, value: string): Promise<void> => {
    await ensureConnected();
    return cadBridge.call('catia.property.write', { path, prop_name: propName, value }, tokenRef.current);
  }, [ensureConnected]);

  const getFieldMapping = useCallback(async (): Promise<{
    builtin: Record<string, string>;
    properties: Record<string, string>;
  }> => {
    await ensureConnected();
    return cadBridge.call('mapping.get', {}, tokenRef.current);
  }, [ensureConnected]);

  const downloadFile = useCallback(async (attachmentId: string, code: string, version: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.download', { attachment_id: attachmentId, code, version }, tokenRef.current);
  }, [ensureConnected]);

  const uploadFile = useCallback(async (filePath: string, revisionId: string, category: 'cad' | 'production', overwrite = false, includeDrawing = false): Promise<any> => {
    await ensureConnected();
    // 大文件上传较慢，超时放宽到 3 分钟
    return cadBridge.call('workspace.upload', { file_path: filePath, revision_id: revisionId, category, overwrite, include_drawing: includeDrawing }, tokenRef.current, 180000);
  }, [ensureConnected]);

  const exportStpUpload = useCallback(async (path: string, fileName: string, revisionId: string): Promise<any> => {
    await ensureConnected();
    // STP 导出大装配较慢，超时放宽到 3 分钟
    return cadBridge.call('workspace.export_stp_upload', { path, file_name: fileName, revision_id: revisionId }, tokenRef.current, 180000);
  }, [ensureConnected]);

  return {
    connected,
    catiaStatus,
    loading,
    ping,
    detectCATIA,
    readAssemblyTree,
    readProperties,
    writeProperty,
    getFieldMapping,
    downloadFile,
    uploadFile,
    exportStpUpload,
  };
}
