// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/api', () => ({
  mediaApi: { token: vi.fn(async () => 'tok-123') },
}));

import { previewAttachment } from './attachmentPreview';
import { mediaApi } from '../services/api';

describe('previewAttachment office 分发', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('open', vi.fn());
  });

  it('docx/xlsx/xls 取 preview 令牌并在新标签页打开 /office-reader', async () => {
    for (const name of ['a.docx', 'b.xlsx', 'c.xls', 'D.DOCX']) {
      (window.open as ReturnType<typeof vi.fn>).mockClear();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive });
      expect(mediaApi.token).toHaveBeenCalledWith('att-1', 'preview');
      const url = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('/office-reader?id=att-1');
      expect(url).toContain('token=tok-123');
      expect(url).toContain(`name=${encodeURIComponent(name)}`);
      expect(onArchive).not.toHaveBeenCalled();
    }
  });

  it('pptx/doc/ppt 取 office-pdf 令牌并在新标签页打开 /office-pdf', async () => {
    for (const name of ['a.pptx', 'b.doc', 'c.ppt']) {
      (window.open as ReturnType<typeof vi.fn>).mockClear();
      (mediaApi.token as ReturnType<typeof vi.fn>).mockClear();
      const onArchive = vi.fn();
      await previewAttachment('att-1', name, { onArchive });
      expect(mediaApi.token).toHaveBeenCalledWith('att-1', 'office-pdf');
      const url = (window.open as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain('/office-pdf?token=tok-123');
      expect(window.alert).not.toHaveBeenCalled();
    }
  });

  it('压缩包仍触发 onArchive', async () => {
    const onArchive = vi.fn();
    await previewAttachment('att-1', 'x.zip', { onArchive });
    expect(onArchive).toHaveBeenCalledWith('att-1', 'x.zip');
  });
});
