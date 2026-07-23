import { useState, useEffect, useCallback, useRef } from 'react';
import { cadBridge } from '../services/cadBridge';
import { useAuthStore } from '../stores/auth';

export interface CADStatus {
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

export type CADType = 'catia' | 'solidworks';

export function useCADBridge(cadType: CADType = 'catia') {
  const [connected, setConnected] = useState(false);
  const [cadStatus, setCadStatus] = useState<CADStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const token = useAuthStore((s) => s.token) || '';
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const ns = cadType === 'catia' ? 'catia' : 'sw';

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
      const result = await cadBridge.call(`${ns}.ping`, {}, tokenRef.current);
      return result?.status === 'ok';
    } catch {
      return false;
    }
  }, [ns]);

  const detectCAD = useCallback(async (): Promise<CADStatus> => {
    await ensureConnected();
    const result = await cadBridge.call(`${ns}.detect`, {}, tokenRef.current);
    setCadStatus(result);
    return result;
  }, [ensureConnected, ns]);

  const readAssemblyTree = useCallback(async (): Promise<AssemblyTreeNode> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.assembly.read_tree`, {}, tokenRef.current, 300000);
  }, [ensureConnected, ns]);

  const readProperties = useCallback(async (path: string): Promise<AssemblyTreeNode['properties']> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.assembly.read_properties`, { path }, tokenRef.current);
  }, [ensureConnected, ns]);

  const writeProperty = useCallback(async (path: string, propName: string, value: string): Promise<void> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.property.write`, { path, prop_name: propName, value }, tokenRef.current);
  }, [ensureConnected, ns]);

  const getFieldMapping = useCallback(async (): Promise<{
    builtin: Record<string, string>;
    properties: Record<string, string>;
  }> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.mapping.get`, {}, tokenRef.current);
  }, [ensureConnected, ns]);

  const pdmUrlRef = useRef(window.location.origin + '/api');
  pdmUrlRef.current = window.location.origin + '/api';

  const downloadFile = useCallback(async (attachmentId: string, code: string, version: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.download', { attachment_id: attachmentId, code, version, pdm_url: pdmUrlRef.current }, tokenRef.current);
  }, [ensureConnected]);

  const uploadFile = useCallback(async (filePath: string, revisionId: string, category: 'cad' | 'production', overwrite = false, includeDrawing = false): Promise<any> => {
    await ensureConnected();
    return cadBridge.call('workspace.upload', { file_path: filePath, revision_id: revisionId, category, overwrite, include_drawing: includeDrawing, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected]);

  const exportStpUpload = useCallback(async (path: string, fileName: string, revisionId: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.workspace.export_stp_upload`, { path, file_name: fileName, revision_id: revisionId, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected, ns]);

  const exportPdfUpload = useCallback(async (path: string, fileName: string, revisionId: string): Promise<any> => {
    await ensureConnected();
    return cadBridge.call(`${ns}.workspace.export_pdf_upload`, { path, file_name: fileName, revision_id: revisionId, pdm_url: pdmUrlRef.current }, tokenRef.current, 180000);
  }, [ensureConnected, ns]);

  return {
    connected,
    cadStatus,
    loading,
    ping,
    detectCAD,
    readAssemblyTree,
    readProperties,
    writeProperty,
    getFieldMapping,
    downloadFile,
    uploadFile,
    exportStpUpload,
    exportPdfUpload,
  };
}
