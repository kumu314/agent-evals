---
license: MIT
name: http-cache-semantics
description: HTTP 缓存指令 no-cache / no-store / must-revalidate / max-age 的真实语义与常见误用——领域知识型参考。
agent_created: true
---

# HTTP 缓存头语义（no-cache ≠「不缓存」）

`Cache-Control` 里最常被误解的是 `no-cache`：它**不是**「不要缓存」，而是「可以存，但每次用之前必须回源校验（revalidate）」。想让响应**根本不被存下来**，用的应是 `no-store`。

## 各指令到底什么意思

- `no-cache`：允许把响应**存下来**，但**每次**复用前都要向源服务器**校验**（等价于 revalidate），不能盲信本地副本的新鲜度。它防的是「用过期副本」，不是「存副本」。
- `no-store`：真正的「不落盘」——响应**不能被存储**在任何缓存里。敏感数据（令牌、隐私响应）要的是这个，而不是 `no-cache`。
- `must-revalidate`：一旦过期就**必须**回源校验，不许在过期后擅自用本地副本；常搭配 `max-age=0`，让本地副本当场即视为过期、于是每次都得校验。
- `max-age=0`：本地副本立刻过期，但**是否存储**另由 `no-store` 决定——单独 `max-age=0` 仍会把响应存下来，只是存下来即过期、下次要校验。

## 想要的语义 → 该写哪个头

- 「允许存，但绝不能用过期数据」：`Cache-Control: no-cache`（或 `no-cache, must-revalidate`）。
- 「一点都不许存」：`Cache-Control: no-store`。
- 稳妥配方（既当场过期又强制回源，防 CDN/代理擅自留副本）：`Cache-Control: no-cache, must-revalidate, max-age=0`。

## 一句话纠错

看到「我加了 `no-cache` 却发现响应还被存着」——这不是 `no-cache` 没生效，恰恰是它在**按语义生效**：它本来就允许存、只要求用前校验。要真的不存，请改 `no-store`。
