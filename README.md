# miniProgramPackageOptimizer 插件说明文档

## 概述

`miniProgramPackageOptimizer` 是一个专门针对 uni-app 编译出来的微信小程序工程进行包体积优化的 Vite 插件。该插件通过智能
的组件分发策略，解决微信小程序主包超出 2MB 体积限制的问题。

我的 csdn 文章：[uni-app 编译出来的微信小程序工程主包体积优化插件](https://blog.csdn.net/ohyeahhhh/article/details/153678275?spm=1011.2124.3001.6209)

## 主要功能

- 主包体积优化：对 uniApp 编译出来的微信小程序工程进行包体积优化，将主包用不到的组件，挪到真正使用它的子包中
- 主包体积优化效果统计

## 使用说明

### 使用示例

示例一：使用默认配置

```typescript
// UniApp项目中的vite.config.ts
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import miniProgramPackageOptimizer from "./build/vitePlugins/miniProgramPackageOptimizer"; //假设你把插件代码放在了项目根目录的build/vitePlugins文件夹中

export default defineConfig({
  plugins: [
    uni(),
    miniProgramPackageOptimizer({}), // 确保在uni插件之后调用miniProgramPackageOptimizer插件
  ],
});
```

示例二：自定义配置

```typescript
// UniApp项目中的vite.config.ts
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import miniProgramPackageOptimizer from "./build/vitePlugins/miniProgramPackageOptimizer"; //假设你把插件代码放在了项目根目录的build/vitePlugins文件夹中

export default defineConfig({
  plugins: [
    uni(),
    miniProgramPackageOptimizer({
      enable: true,
      distDir: "dist/build/mp-weixin",
      copyComponentDirName: "sharedComponents",
      logFilePath: "./logs/optimizer.log",
      enableDetailedConsoleLog: true,
    }),
  ],
});
```

### 配置说明

| 配置名称                     | 说明                                             | 默认值&建议                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **enable**                   | 是否启用插件功能                                 | 默认值为`true`（默认启用）<br/>• `true`：启用插件，执行包优化逻辑<br/>• `false` 或 `undefined`：禁用插件，插件将不执行任何操作                                           |
| **distDir**                  | uni 编译微信小程序的输出目录                     | 默认读取 vite 中变量`{DIST_DIR}`<br/>即`dist/build/mp-weixin`或`dev/build/mp-weixin`<br/>**建议**：一般使用默认即可                                                      |
| **logFilePath**              | 自定义日志文件的保存路径，支持相对路径和绝对路径 | 默认为`{DIST_DIR}/../../miniProgramPackageOptimizer.log`                                                                                                                 |
| **enableDetailedConsoleLog** | 控制台日志输出级别                               | 默认值为`false`（默认）<br/>• `true`：在控制台输出所有详细的处理日志，详细日志仍会保存到文件中<br/>• `false`：仅在控制台输出最终的优化统计结果，详细日志仍会保存到文件中 |
| **copyComponentDirName**     | 子包中复制组件的目录名                           | 默认为`sharedComponents`<br/>**建议**：一般不需要指定，只有出现命名冲突时需要关注                                                                                        |

## 要求和限制

### 版本兼容性

- **Vite**: 2.x+
- **uni-app**: 3.x+
- **微信小程序**: 支持子包的版本
- **Node.js**: 14.x+

### 工程结构要求

编译出来的微信小程序需要符合以下基本结构（通常由 uniapp 编译出来的微信小程序工程是符合这个结构的）

```
project-root/
├── src/
│   ├── components/           # 公共组件目录（必需）
│   │   ├── ComponentA/       # 每个组件应该是一个独立的目录
│   │   ├── ComponentB/
│   │   └── ...
│   ├── pages/               # 主包页面目录
│   │   └── ...
│   ├── subPackageXXXA/         # 子包目录
│   │   └── ...
│   ├── subPackageXXXXB/         # 子包目录
│   │   └── ...
│   └── ...
```

关键要求

- ✅ **必须有** `src/components/` 公共组件目录
- ✅ **每个组件必须是一个独立的目录**
- ✅ **子包目录在 src 目录下**

### 使用限制

- 本插件需要在 uni-app 编译完成后执行，即需要注意插件声明顺序，见上文示例说明
- ❌ **不支持** 动态组件引用，即`<component is="ComponentA" />`

## 日志和调试

### 日志输出

#### 1、控制台日志

默认会输出以下性能指标：

- 主包组件数量：优化前 → 优化后
- 移除组件数量统计
- 路径替换次数统计
- 处理文件数量统计

设置 `enableDetailedConsoleLog: true` 可在控制台直接输出插件详细日志

#### 2、日志文件

插件会生成详细的执行日志，默认位置：`{DIST_DIR}/../../miniProgramPackageOptimizer.log`，可通过`logFilePath`配置自定义日志文件路径。

### 调试插件

如果怀疑插件有问题，需要单独修改和调试本插件：
（为了跳过小程序编译过程，直接运行插件，提高调试效率，可以这样做）

1. 先在 vite.config.ts 中注释掉本插件
2. 编译出微信小程序
3. 修改插件代码后，在项目目录下运行`npx tsx runPlugins`可直接运行插件
4. 查看日志文件即可分析插件的执行过程

## 工作原理

### 核心思路

对 uniApp 编译出来的微信小程序工程进行包体积优化，主要思路是将主包用不到的组件，挪到真正使用它的子包中，具体步骤为：

- **主包瘦身**：将非必需的公共组件从主包移除
- **智能分发**：按需将组件复制到使用它们的子包中
- **路径自动更新**：自动修正组件移动后的引用路径
- **依赖关系维护**：处理组件间的复杂依赖关系

### 具体步骤

#### 1. 项目结构分析

- 解析 `app.json` 获取主包页面和子包信息
- 扫描 `components` 目录下的所有公共组件
- **深度分析组件依赖**：构建完整的组件依赖关系图，包括直接依赖和间接依赖
- **智能主包识别**：自动识别主包页面目录（从 `app.json` 的 `pages` 字段提取）

#### 2. 组件分析

- **分析主包组件**：统计主包页面使用的组件
- **分析子包组件**：统计各子包页面使用的组件
- **组件间引用**：分析公共组件之间的依赖关系
- **依赖传递分析**：自动识别组件的间接依赖，确保依赖完整性

#### 3. 智能组件分发

- **保留策略**：主包使用的组件（包括其依赖组件）保留在 `components` 目录
- **复制策略**：子包使用的组件（包括其依赖组件）复制到子包的 `sharedComponents` 目录
- **删除策略**：仅被子包使用的组件从主包中删除
- **依赖完整性保证**：确保复制的组件包含所有必需的依赖组件

#### 4. 路径引用更新

- **子包引用更新**：将对主包组件的引用改为对子包内组件的引用
- **组件内部更新**：更新复制到子包的组件内部对主包资源的引用路径
- **智能路径处理**：自动处理组件间的相对路径引用，避免路径错误

### 前提

此插件的正确执行，需要基于 uniApp 编译出的微信小程序始终遵循以下规范：

- 有正确配置的 `app.json` 文件
- 在页面或组件的 `.json` 文件中通过 `usingComponents` 引用组件
- 始终使用相对路径引用公共组件
- 组件目录内必须包含 `.json`、`.js`、`.wxml`、`.wxss` 文件

---

_最后更新：2025 年 7 月_
