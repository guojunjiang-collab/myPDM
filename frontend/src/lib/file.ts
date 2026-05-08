export const formatFileSize = (bytes: number | undefined | null): string => {
  if (!bytes || bytes === 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
};

export const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
};

export const isImageFile = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
};

export const isPdfFile = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  return ext === 'pdf';
};

export const isExcelFile = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  return ['xlsx', 'xls', 'csv'].includes(ext);
};

export const isDocFile = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  return ['doc', 'docx'].includes(ext);
};

export const getFileIcon = (filename: string): string => {
  if (isImageFile(filename)) return '🖼️';
  if (isPdfFile(filename)) return '📕';
  if (isExcelFile(filename)) return '📊';
  if (isDocFile(filename)) return '📝';
  return '📄';
};