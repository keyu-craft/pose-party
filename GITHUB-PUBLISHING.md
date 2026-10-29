# 用 GitHub 网页发布 Pose Party

本指南全程使用 GitHub 网页，不需要 GitHub Desktop 或命令行。已有的空仓库就是项目的起点；第一次上传代码时，README 和其他文件会一同加入。

## 1. 准备要上传的文件

使用为这次上传整理的 `pose-party-web-upload` 文件夹。它包含项目源代码、README、内置音乐、测试和自动发布配置，已排除 `node_modules`、`dist`、本地日志、预览截图及本地 `.git` 记录。

网页版不会根据 `.gitignore` 自动筛选本机文件，因此请使用这份已筛选的上传副本。本机开发项目仍保留在原来的 `pose-party` 文件夹中；上传副本是制作时的快照，以后改动需要重新同步到副本。

## 2. 打开 GitHub 上传页面

1. 打开自己的仓库网页。当前项目是 [keyu-craft/pose-party](https://github.com/keyu-craft/pose-party)。
2. 如果仓库还是空的，点 Quick setup 中的 **uploading an existing file**。
3. 如果仓库已有文件，点文件列表上方 **Add file → Upload files**。

## 3. 一次上传项目内容

1. 在 Mac 的 Finder 中打开 `pose-party-web-upload` 文件夹。
2. 按 **Command + Shift + .** 显示隐藏文件，确认能看到 `.github` 文件夹和 `.gitignore`。
3. 在这个文件夹里面按 **Command + A**，全选里面的文件和文件夹。
4. 将选中的内容一起拖到 GitHub 上传页面的虚线框内。等待音乐等文件上传完毕。
5. 核对上传路径：应直接出现 `README.md`、`package.json`、`src/main.ts`、`public/music/…` 和 `.github/workflows/deploy-pages.yml`。

请上传外层文件夹里面的内容，不要把外层 `pose-party-web-upload` 文件夹本身拖进去，也不要只上传一个 ZIP。GitHub 不会把 ZIP 自动展开成项目文件。

`README.md` 已经准备好，包含介绍、截图、玩法和运行方法，不需要先在网页另外创建空白 README。

GitHub 网页目前每个文件上限 25 MiB、一次最多 100 个文件。已整理的项目符合这两个限制。[官方上传说明](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository)

## 4. 保存第一次上传

1. 在页面底部 Commit changes 区域填写简短说明：`Initial Pose Party prototype`。
2. 如果显示分支选项，为这个新建的空项目选择直接提交到 `main`。
3. 点 **Commit changes**。如果界面显示 **Propose changes**，按页面流程创建并合并 Pull Request，让这些文件最终进入 `main`。
4. 保存完成后，仓库首页应显示 README、src、public 等内容，README 会自动显示在文件列表下面。

此时完成的是代码上传。让同学能直接玩，还需要下一步开启 Pages。

## 5. 开启 GitHub Pages 网站

1. 在仓库中点 **Settings → Pages**。
2. 在 **Build and deployment → Source** 中选择 **GitHub Actions**。项目已有发布工作流，不需要额外再创建一份。
3. 打开 **Actions → Publish Pose Party → Run workflow**，选择 `main` 并运行。
4. 等测试、构建和部署全部变绿，回到 **Settings → Pages → Visit site**，获得实际游戏网址。

第一次上传代码时，如果 Pages 还没设置而导致工作流失败，设置好 Source 后重新运行即可。上传的音乐、运行文件和模型 Worker 会随构建发布，不需要手动上传 `dist` 或 `node_modules`。

代码仓库地址与游戏网址不同。项目网址通常为 `https://你的用户名.github.io/pose-party/`；请以 Pages 页面实际显示的地址为准。上线后，可把它填写到仓库 **About → Website** 中。

截图中的仓库是 Private，这不影响上传。免费账号的 Pages 适用于公开仓库；部分付费套餐支持私有仓库的 Pages。如果 Pages 提示需要升级，可自行决定公开源代码或使用支持的套餐。[GitHub Pages 套餐说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

## 6. 在线试玩和后续更新

使用桌面 Chrome 或 Edge 打开 HTTPS 游戏网址，开启摄像头并允许权限。验证音乐播放、站位提示、一秒准备、姿势计分与 60 秒结束。再请一位同学从另一台电脑试玩。

首次识别需要从 Google Storage 加载模型，受玩家网络影响。摄像头在玩家浏览器内处理，个人选择的本地歌曲不会上传到仓库。

以后可在网页文件列表中打开 README 等文本文件，点铅笔编辑并保存。批量更新源代码时，在原来的本地项目修改并确认可运行，再上传相同路径的新文件；提交到 `main` 后，Actions 会更新网站。重命名或删除文件还需要同步删除网页仓库中旧路径的文件。

## 常见情况

| 现象 | 处理 |
| --- | --- |
| README 没显示在首页 | 检查 `README.md` 是否位于仓库根目录，而不是外层上传文件夹里。 |
| 找不到 Publish Pose Party | 检查 `.github/workflows/deploy-pages.yml` 是否存在，且直接位于仓库根目录的 `.github` 下。 |
| 网页只显示一个 ZIP | 需要上传展开后的项目内容，ZIP 不会自动解压。 |
| Pages 没有开启选项 | 查看仓库可见性和账号套餐是否支持 Pages。 |
| Configure Pages 失败 | 先设好 Settings → Pages → GitHub Actions，再运行。 |
| 音乐或模型加载失败 | 检查 Actions 是否部署成功、网络能否访问模型来源，再查看性能记录。 |

## 项目文档

- [英语 README](README.md) / [中文 README](README.zh-CN.md)
- [仓库 Description 与 Topics](GITHUB-DETAILS.md)
- [开发与实现说明](docs/DEVELOPMENT.zh-CN.md)
- [音乐署名](public/music/CREDITS.md)
