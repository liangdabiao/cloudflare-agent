# Cloudflare RAG Agent 入门实战

基于 [RAG Workers AI + Vectorize 教程](https://eastondev.com/blog/zh/posts/ai/20251201-rag-workers-ai-vectorize-tutorial/)
的实现（形态调整：**Agentic RAG** —— 检索做成 Agent 的工具，由模型自主决定何时检索）。

- ✅ 文档入库：自动分块（500 字符/50 重叠）→ bge-m3 批量嵌入 → Vectorize + 原文存 SQLite
- ✅ 语义检索：`search_knowledge_base` 工具（问题转向量 → topK=5 相似度搜索 → 过滤低分）
- ✅ 引用回答：LLM 只基于检索内容作答、标明来源、允许说"不知道"
- ✅ 知识库管理面板：添加 / 列出 / 删除（向量与原文同步清理）
- ✅ 中文友好：**bge-m3 多语言嵌入**（1024 维）替代教程的 bge-base-en-v1.5（英文优化）

## 架构

```
入库：文本 → splitText(500/50) → AI.run("@cf/baai/bge-m3") 批量嵌入
      → VECTORIZE.upsert(向量+metadata 含分块原文) + DO SQLite 存原文/向量 id
查询：问题 → 嵌入 → VECTORIZE.query(topK=5, returnMetadata:"all")
      → 过滤 score>0.4 → 拼进 Prompt → glm-4.7-flash 流式回答（引用来源）
删除：VECTORIZE.deleteByIds + 删 state 记录
```

与教程的差异：教程用 D1 存原文 + Workflows 异步向量化（大批量场景）；
本仓库 demo 规模直接同步处理，原文存 Agent 的 SQLite（少两个绑定）。
要扩到大批量导入时再引入 Workflows（README 末尾）。

## 项目结构

```
rag-agent/
├── wrangler.jsonc          # AI 绑定 / VECTORIZE 绑定 / RagAgent DO
└── src/
    ├── server.ts           # ★ 分块/嵌入/入库 + search_knowledge_base 工具 + 文档管理
    └── client.tsx          # 聊天界面 + 知识库管理面板（agent.call 调 @callable）
```

## 前置步骤：创建 Vectorize 索引（一次）

维度必须与嵌入模型输出一致（bge-m3 = 1024），否则报 dimension mismatch：

```bash
npx wrangler vectorize create rag-knowledge-base --dimensions=1024 --metric=cosine
npx wrangler vectorize list        # 确认
npx wrangler vectorize info rag-knowledge-base   # 查看向量数
```

## 运行

```bash
npm install
npx wrangler login
npx wrangler types
npm run dev
```

1. 在知识库面板粘贴任意文档（中英文均可）
2. 提问：「这个项目是做什么的？」
3. 观察工具卡片 `search_knowledge_base result`——那是向量检索返回的片段与相似度分数

## 核心概念速查（学习重点）

| 概念 | 说明 |
|---|---|
| 嵌入（Embedding） | 文本 → 高维向量；语义相近的文本向量距离近 |
| 分块（Chunking） | 长文本切 500 字符/50 重叠——重叠保证语义不断裂 |
| `VECTORIZE.upsert/query` | 向量入库/相似度搜索；`returnMetadata:"all"` 直接取回分块原文 |
| metadata 设计 | 分块原文放进 metadata，检索结果即取即用（注意单条大小限制） |
| Agentic RAG | 检索封装成 tool，模型自主决定"何时检索、检索什么"（区别于固定流水线 RAG） |
| `agent.call` | 客户端调用服务端 `@callable` 方法；**args 是数组，按位置展开为方法参数** |
| score 过滤 | bge-m3 余弦分数分布较宽，demo 用 0.4 兜底 + 让 LLM 判断相关性 |
| Free 额度 | Vectorize Free：50 索引/500 万存储维度/月、3000 万查询维度/月；Workers AI 每日 10000 Neurons（见踩坑 16） |

## 部署

```bash
npm run deploy
# 索引是账号级资源，wrangler.jsonc 的 index_name 已绑定，无需额外配置
```

## 踩坑：Workers AI 每日 Neurons 限额

Workers AI Free 计划**每天 10,000 Neurons**（LLM 的每 token、嵌入每次调用都消耗）。
本项目实测：一天的密集测试（多轮对话修复验证 + 语音 + Slack + 浏览器多步循环）就足以耗尽，
之后所有 AI 调用返回 429 "used up your daily free allocation"。

表现与对策：
- 嵌入/生成报 429 → 当天额度已尽，**次日重置**（UTC 0 点）
- 调试期省额度：优先测小问题、用 REST 直调验证单个环节（嵌入消耗很小，大头是 LLM 对话）
- Vectorize 本身不消耗 Neurons（按查询/存储向量维度独立计费，Free 额度独立）

## 扩展方向

- 大批量导入：引入 Workflows 异步分块嵌入（教程原方案），避免同步请求超时
- D1 存原文：文档量大后把原文从 DO state 迁到 D1（跨实例共享）
- 混合检索：Vectorize + 关键词过滤（metadata filter）提升精度
- AutoRAG：Cloudflare 全托管 RAG（自动切分/向量化/检索/生成），零代码方案
