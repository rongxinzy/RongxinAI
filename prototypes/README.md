# RongxinAI 原型入口

## 本地模型卡片原型

这个原型不手写卡片样式，直接复用当前项目里的 `ModelsPanel` 组件，因此可以保证卡片结构和样式与主应用保持一致。

开发模式访问：

```text
http://localhost:5175/?prototype=local-inference-model-card
```

可选状态：

```text
http://localhost:5175/?prototype=local-inference-model-card&modelCardState=idle
http://localhost:5175/?prototype=local-inference-model-card&modelCardState=loading
http://localhost:5175/?prototype=local-inference-model-card&modelCardState=running
http://localhost:5175/?prototype=local-inference-model-card&modelCardState=unloading
```

说明：

- `idle`：未启动状态。
- `loading`：启动中遮罩状态。
- `running`：已启动状态。
- `unloading`：关闭中遮罩状态。

迁移规则：如果后续要调整卡片样式，应修改正式组件 `src/renderer/components/localInference/panels/ModelsPanel.tsx`，原型页面会自动同步显示正式组件效果。
