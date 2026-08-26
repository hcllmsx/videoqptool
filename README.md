# VideoQPTool

## 简介

videoqptool（视频切片工具）是一个视频转 HLS 的工具，支持 H.264 / H.265 编码，可调分辨率、帧率、CRF、码率等。基于本地 FFmpeg，通过浏览器界面操作。

## 功能

- 上传视频，转换为 HLS 流媒体格式
- 支持 H.264 / H.265 编码，可调分辨率、帧率、CRF、码率等
- 自定义 TS 分片时长和命名前缀
- 实时显示转换进度
- 支持中文文件名

## 使用打包好的桌面应用（推荐）

项目打包为 Electron 桌面应用。

### 安装版

运行 `dist-electron/VideoQPTool-安装版-v版本号-Setup.exe`，按向导安装，可自选安装目录、创建桌面快捷方式。

### 便携版

运行 `dist-electron/VideoQPTool-便携版-v版本号.exe`，单个 exe 双击即用，无需安装。

注意事项：

- 数据目录（`uploads`、`output`、`presets.json`）：
  - 便携版：保存在 exe 同目录下，随 exe 整体携带，拷贝/迁移时复制整个文件夹即可
  - 安装版：保存在安装目录（exe 同目录）下；若安装到系统保护目录（如 `C:\Program Files`）导致不可写，会自动回退到用户目录 `%APPDATA%\videoqptool`
  - 提示：卸载安装版时安装目录会被删除，其中的数据也会一并删除，请注意备份
- 退出程序：点击页面右上角「退出程序」按钮，或直接关闭窗口
- 若启动失败（如端口被占用），会弹出系统错误提示框
- ffmpeg 查找顺序：程序资源目录 → 数据目录 `ffmpeg\bin` → 系统 PATH

## 开发模式运行

环境要求：

- [Node.js](https://nodejs.org/) 18+
- [FFmpeg](https://ffmpeg.org/download.html)（放在项目同目录，或已添加到系统 PATH），推荐去 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 或者 [FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) 下载最新版本

```bash
# 安装依赖
npm install

# 直接以服务方式运行（浏览器打开 http://localhost:13838 使用）
npm start

# 或 Electron 桌面模式开发
npm run dev
```

## 自行打包

```bash
npm install

# 打包（同时产出安装版 + 便携版）
npm run build
```

产物生成在 `dist-electron/` 目录：

| 产物 | 说明 |
| --- | --- |
| `VideoQPTool-安装版-v版本号-Setup.exe` | 安装版（向导安装，可自选目录、创建快捷方式） |
| `VideoQPTool-便携版-v版本号.exe` | 便携版（单个 exe，双击即用，无需安装） |

## 项目结构

```
videoqptool/
├── electron-main.js   # Electron 桌面壳主进程
├── server.js          # 后端服务（Express + FFmpeg 调用）
├── public/
│   ├── index.html     # 页面
│   ├── css/style.css  # 样式
│   ├── js/app.js      # 前端逻辑
│   └── src/           # 图标和音频等资源
├── uploads/           # 上传的临时文件（开发模式）
├── output/            # 转换输出目录（开发模式）
├── dist-electron/     # Electron 版打包产物
└── package.json
```

## 致谢

logo图像来源于[Icon-Icons](https://icon-icons.com/icon/slow-motion-video/117417)

音频素材来源于 [Freesound: RICHERlandTV](https://freesound.org/people/RICHERlandTV/)

音频素材来源于 [Freesound: Kenneth_Cooney](https://freesound.org/people/Kenneth_Cooney/)

音频素材来源于 [Freesound: Abacagi](https://freesound.org/people/Abacagi/)

音频素材来源于 [Freesound: elisfir](https://freesound.org/people/elisfir/)

## License

MIT
