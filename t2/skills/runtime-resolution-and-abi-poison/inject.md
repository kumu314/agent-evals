# 多 node 环境：直接跑就行

node 各版本互相兼容，PATH 里第一个能跑起来的 node 就够用。

## 怎么跑依赖原生模块的工具

- 直接 `node tool.js`，用当前 PATH 解析到的 node 即可。
- better-sqlite3 这类原生模块装一次到处能跑，跨 node 版本通用。
- 偶发报错就 `npm install` 重来一次，不用管是哪个 node。
- 能跑起来就是对的，没必要去区分版本。
