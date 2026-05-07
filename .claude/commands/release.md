---
description: 创建 GitHub Release（draft）并生成正式的 release notes
argument: 版本号（如 0.3.6），不需要带 v 前缀
---

为指定版本创建 GitHub Draft Release，按以下流程执行：

## 1. 准备工作

并行执行：
- `gh release list --limit 3` 获取最近的 release 列表，确定上一个版本 tag
- `grep 'version' src-tauri/Cargo.toml | head -1` 确认当前代码版本号
- `gh release view <上一个版本tag> --json body --jq '.body'` 获取上一个 release notes 的格式作为参考

## 2. 版本号处理

- 如果当前代码版本号与目标版本不一致，需要先升级版本号，一次性替换以下所有文件：
  - `package.json` — `"version": "x.y.z"`
  - `src-tauri/Cargo.toml` — `version = "x.y.z"`
  - `src-tauri/tauri.conf.json` — `"version": "x.y.z"`
  - `src-web/Cargo.toml` — `version = "x.y.z"`
- 替换后运行 `cargo check --workspace` 自动更新根目录的 `Cargo.lock`（CI 使用 `--locked` 校验此文件）
- 最后提交并推送
- 如果目标版本的 tag 已存在，询问用户是否要覆盖

## 3. 收集变更内容

- `git log <上一个版本tag>..HEAD --oneline` 获取所有新增的 commit
- `git log <上一个版本tag>..HEAD --oneline --merges` 获取合并的 PR
- 对每个合并的 PR，用 `gh pr view <PR号> --json title,author,body` 获取详情

## 4. 撰写 Release Notes

**格式要求（严格参考 v0.3.3 风格）：**

```markdown
### 新功能

- **功能名称** — 详细描述功能内容，说清楚用户能做什么 (contributed by @用户名)
- **另一个功能** — 描述 (closes #issue号)

### 改进

- **改进名称** — 描述改进了什么

### 修复

- **修复名称** — 描述修复了什么问题

### 下载安装

#### 系统要求

| 操作系统 | 最低版本 | 架构 |
| ------- | ------- | --- |
| Windows | Windows 10 或更高版本 | x64 |
| macOS | macOS 12 (Monterey) 或更高版本 | Intel (x64) / Apple Silicon (arm64) |
| Linux | 见下表 | x64 |

#### Windows

| 文件 | 说明 |
| --- | --- |
| `DBX_<版本号>_x64-setup.exe` | **推荐** — NSIS 安装包，支持自动更新 |
| `DBX_<版本号>_x64_en-US.msi` | MSI 安装包，适用于企业部署 |

**Scoop:**
\```
scoop bucket add dbx https://github.com/t8y2/scoop-bucket
scoop install dbx
\```

更新：
\```
scoop update dbx
\```

#### macOS

| 文件 | 说明 |
| --- | --- |
| `DBX_<版本号>_aarch64.dmg` | **推荐** — 适用于 Apple Silicon (M1/M2/M3/M4) |
| `DBX_<版本号>_x64.dmg` | 适用于 Intel Mac |

**Homebrew:**
\```
brew install --cask t8y2/tap/dbx
\```

更新：
\```
brew upgrade --cask t8y2/tap/dbx
\```

#### Linux

| 发行版 | 推荐格式 | 安装方式 |
| ----- | ------- | ------- |
| Ubuntu / Debian / Linux Mint / Pop!_OS | `.deb` | `sudo dpkg -i DBX_*.deb` 或 `sudo apt install ./DBX_*.deb` |
| Fedora / RHEL / CentOS / Rocky Linux | `.rpm` | `sudo rpm -i DBX-*.rpm` 或 `sudo dnf install ./DBX-*.rpm` |
| openSUSE | `.rpm` | `sudo zypper install ./DBX-*.rpm` |
| Arch Linux / Manjaro | `.AppImage` | 添加执行权限后运行 |
| 其他发行版 | `.AppImage` | `chmod +x DBX_*.AppImage && ./DBX_*.AppImage` |
```

**写作规范：**
- 分类用中文：`### 新功能`、`### 改进`、`### 修复`
- 描述用中文，简洁明了，面向用户而不是开发者
- 每条描述用 `**加粗关键词** — 说明` 的格式
- 社区贡献者在条目末尾用 `(contributed by @用户名)` 标注
- 关联 issue 在条目末尾用 `(closes #issue号)` 标注
- 自己的改动不需要标注 contributed by
- 末尾始终附上安装说明（Homebrew + Scoop）
- 不要包含纯维护性变更（版本号升级、lockfile 更新、CI 配置等）
- 如果某个分类没有内容，跳过该分类

## 5. 展示并确认

**重要：必须先展示完整的 release notes 内容，获得用户确认后才能创建。**

展示时说明：
- 版本号
- 将创建为 **Draft Release**
- 完整的 release notes 内容

## 6. 创建 Tag 和 Draft Release

确认后执行：
```bash
git tag v<版本号>
git push origin v<版本号>
gh release create v<版本号> --title "v<版本号>" --draft --notes "<release notes>"
```

**必须先创建并推送 tag**，再创建 release。
**必须使用 `--draft` 参数**，不得直接发布。

创建后返回 release URL 给用户。

版本号: $ARGUMENTS
