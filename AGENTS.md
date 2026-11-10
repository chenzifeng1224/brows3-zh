# AGENTS.md

本仓库是 Brows3 的中文 fork（Next.js 前端 + Tauri/Rust 后端）。

## 硬性规则

- **禁止在本机安装依赖。** 不要执行 `pnpm install`、`npm install`、全局安装 pnpm/corepack，也不要为了跑 `typecheck`/`vitest` 而在本地生成 `node_modules`。
- 打包、构建、测试一律交给 GitHub Actions：
  - Windows 打包：push 到 `main` 自动触发 `.github/workflows/build-windows.yml`（也可在 Actions 页面手动 Run workflow），产物在 run 页面的 Artifacts。
  - 测试：`.github/workflows/test.yml` 走 PR 或手动 dispatch。
- 代码正确性优先用静态检查（读码、grep、脚本扫描）确认；确需本地运行测试时，先征得用户明确同意。

## 已知的项目决策

- Windows 安装包刻意保持小体积：`src-tauri/tauri.conf.json` 用 `webviewInstallMode: downloadBootstrapper`，工作流只打 NSIS（约 13 MB）。不要改回 `offlineInstaller` 或加回 MSI，除非用户明确要求。
- UI 文案为简体中文；`S3`、`AWS`、`ETag`、`URL`、`ACL`、`MIME`、`JSON` 等技术名词保留英文。
- 术语统一：bucket=存储桶、profile=配置、object=对象、sync=同步、job=任务。
