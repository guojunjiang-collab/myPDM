export interface WechatCallbackInfo {
  mode: 'binding' | null;
  result: 'success' | 'error' | null;
  provider: string | null;
  message: string | null;
}

export function parseWechatCallbackHash(hash: string): WechatCallbackInfo {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('mode') !== 'binding') {
    return { mode: null, result: null, provider: null, message: null };
  }
  const rawResult = params.get('result');
  return {
    mode: 'binding',
    result: rawResult === 'success' || rawResult === 'error' ? rawResult : null,
    provider: params.get('provider'),
    message: params.get('message'),
  };
}
