/* 设置页展示的版本号。插件构建时由 vite define 注入 __NS_VERSION__（值取自仓库根 package.json），
   桌面/单测环境没有这个全局，用 typeof 判空回退，避免 ReferenceError——
   与 skins/registry.js:15 判 __NS_PLUGIN__ 的写法一致。 */
export const APP_VERSION = (typeof __NS_VERSION__ !== 'undefined' ? __NS_VERSION__ : '0.0.0')
