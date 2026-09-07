/**
 * 多主题切换（浅色变体集）。
 *
 * 机制：业务代码零改动——ui 组件颜色全部走 var(--ui-*)，
 * 主题只需在 <html data-theme="..."> 上覆盖相关变量
 * （index.css 中 html[data-theme='forest'|'warm'|'dark'] 块）。
 * 徽标语义色（绿=成功/红=危险/琥珀=进行中等）跨主题保持稳定，
 * 避免状态语义混淆；仅主按钮/链接/表单焦点随主题切换。
 */
export const THEME_STORAGE_KEY = 'pdm-theme';

export const THEMES = [
  { key: 'default', label: '默认蓝', desc: '经典天蓝', swatch: '#0284c7' },
  { key: 'forest', label: '森林绿', desc: '沉稳森林绿', swatch: '#15803d' },
  { key: 'warm', label: '棕色', desc: '暖调棕', swatch: '#92400e' },
  { key: 'dark', label: '深色', desc: '黑夜模式，暗色护眼界面', swatch: '#111827' },
] as const;

export type ThemeKey = (typeof THEMES)[number]['key'];

/** 校验任意值是否为合法主题 key（纯函数，可单测） */
export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === 'string' && THEMES.some((t) => t.key === value);
}

/** 读取持久化主题；非法/缺失回退默认 */
export function getStoredTheme(): ThemeKey {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeKey(raw) ? raw : 'default';
  } catch {
    return 'default';
  }
}

/** 将主题应用到 <html data-theme>（default 时清除属性） */
export function applyTheme(theme: ThemeKey): void {
  const el = document.documentElement;
  if (theme === 'default') {
    delete el.dataset.theme;
  } else {
    el.dataset.theme = theme;
  }
}

/** 持久化 + 应用 */
export function setTheme(theme: ThemeKey): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 隐私模式等场景忽略持久化失败，仍即时应用
  }
  applyTheme(theme);
}
