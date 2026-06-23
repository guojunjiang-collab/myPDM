// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { previewAttachment } from './attachmentPreview';

describe('previewAttachment office 分发', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('alert', vi.fn());
  });

  it('docx/xlsx/xls 触发 onOffice，不触发 onArchive', async () => {
    for (const name of ['a.docx', 'b.xlsx', 'c.xls', 'D.DOCX']) {
      const onOffice = vi.fn();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive, onOffice });
      expect(onOffice).toHaveBeenCalledWith('att-1', name);
      expect(onArchive).not.toHaveBeenCalled();
    }
  });

  it('pptx/doc/ppt 降级下载提示，不触发 onOffice', async () => {
    for (const name of ['a.pptx', 'b.doc', 'c.ppt']) {
      const onOffice = vi.fn();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive, onOffice });
      expect(onOffice).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('该格式暂不支持在线预览，请下载查看');
    }
  });

  it('压缩包仍触发 onArchive', async () => {
    const onOffice = vi.fn();
    const onArchive = vi.fn();
    await previewAttachment('att-1', 'x.zip', { onArchive, onOffice });
    expect(onArchive).toHaveBeenCalledWith('att-1', 'x.zip');
    expect(onOffice).not.toHaveBeenCalled();
  });
});
