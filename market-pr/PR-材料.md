# 慢慢岛 · 市场收录 PR 材料（供提交 liliMozi/hana-marketplace）

以下内容按官方发布规范生成。正式 PR 应在仓库的 registry.json / approvals.json 中**追加**对应条目，不要覆盖他人条目。

## 1. registry.json 追加条目

```json
{ "kind": "app", "id": "manman-island", "repository": "mabzhang/manman-island", "publisher": "mab" }
```

`repository` 填你实际存放 Release 的仓库 `owner/repo`，本材料按当前登录账号 mabzhang 预填。

## 2. approvals.json 追加条目

```json
{
  "kind": "app",
  "id": "manman-island",
  "tag": "v1.0.1",
  "sha256": "0009f4eb3b2c267c58bd164ba675c2922b1391a21d78e85671be7d09519bed90",
  "readme": "README.md 内容（审核过的商店介绍）"
}
```

- `tag`：你在自己仓库创建的正式 Release 标签，规则：字母、数字、`.`、`_`、`+`、`-`。
- `sha256`：照抄 entry JSON 的 `archive.sha256`，与 Release 里的 ZIP 附件必须完全一致；市场按它校验，错一个字符就不上架。
- `readme`：随 PR 审核的商店介绍，只保留图片替代文字，不加载远程图片。改介绍也要再提 PR。

## 3. Release 附件要求

在 `mabzhang/manman-island` 仓库创建**正式 Release**（不能是草稿或 pre-release），tag 用 `v1.0.1`，同时上传这两个文件：

- `app-manman-island-1.0.1.zip`（安装包）
- `app-manman-island-1.0.1.entry.json`（打包器生成的匹配条目）

两者必须来自同一次官方打包。不要把源码 ZIP 当安装包上传。

## 4. 后续版本

每个新版本：发新的正式 Release（新 tag）→ 提 PR 更新 approvals.json 里的 `tag` 和 `sha256`。市场禁止版本倒退或同版本替换安装包。

## 5. 中国大陆源

独立审核、托管和发布，不随 Global 自动更新；入口和审核方式以市场仓库或其维护者说明为准，本材料不擅自假设。
