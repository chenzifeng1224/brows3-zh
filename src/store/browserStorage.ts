import { createJSONStorage } from 'zustand/middleware';

export const browserStorage = createJSONStorage(() => {
  if (typeof window === 'undefined') {
    throw new Error('服务端渲染期间无法使用浏览器存储');
  }

  return window.localStorage;
});
