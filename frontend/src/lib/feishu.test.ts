import { describe, expect, it } from 'vitest';
import { parseFeishuCallbackHash } from './feishu';

describe('parseFeishuCallbackHash', () => {
  it('登录回调返回 mode=null', () => {
    expect(parseFeishuCallbackHash('#access_token=abc')).toEqual({
      mode: null, result: null, provider: null, message: null,
    });
  });

  it('解析绑定成功', () => {
    expect(parseFeishuCallbackHash('#mode=binding&result=success&provider=feishu')).toEqual({
      mode: 'binding', result: 'success', provider: 'feishu', message: null,
    });
  });

  it('解析绑定失败并带原因', () => {
    const hash = `#mode=binding&result=error&provider=feishu&message=${encodeURIComponent('该飞书身份已绑定其他账号')}`;
    const parsed = parseFeishuCallbackHash(hash);
    expect(parsed.mode).toBe('binding');
    expect(parsed.result).toBe('error');
    expect(parsed.message).toBe('该飞书身份已绑定其他账号');
  });
});
