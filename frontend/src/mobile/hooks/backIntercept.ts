export type BackLayer = { kind: 'page' } | { kind: 'drawer'; drawerId: string };

export type BackAction =
  | { type: 'open-drawer'; drawerId: string }
  | { type: 'close-drawer' }
  | { type: 'pop' };

export function backInterceptReducer(state: BackLayer, action: BackAction): BackLayer {
  switch (action.type) {
    case 'open-drawer':
      return { kind: 'drawer', drawerId: action.drawerId };
    case 'close-drawer':
      return { kind: 'page' };
    case 'pop':
      return state.kind === 'drawer' ? { kind: 'page' } : state;
  }
}
