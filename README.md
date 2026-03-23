# VideoQPTool

## 简介

videoqptool（视频切片工具）是一个视频转 HLS 的工具，支持 H.264 / H.265 编码，可调分辨率、帧率、CRF、码率等。基于本地 FFmpeg，通过浏览器界面操作。

## 功能

- 上传视频，转换为 HLS 流媒体格式
- 支持 H.264 / H.265 编码，可调分辨率、帧率、CRF、码率等
- 自定义 TS 分片时长和命名前缀
- 实时显示转换进度
- 支持中文文件名

## 环境要求


- [Node.js](https://nodejs.org/) 18+
- [FFmpeg](https://ffmpeg.org/download.html)（放在项目同目录，或已添加到系统 PATH），推荐去 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 或者 [FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds/releases) 下载最新版本

## 使用方法

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

浏览器打开 `http://localhost:13838` 即可使用。

## 打包为 EXE

```bash
# 安装依赖（含 pkg）
npm install

# 打包
npm run build
```

生成的文件在 `dist/videoqptool.exe`。

### 使用打包后的 EXE

将以下文件放在同一目录下即可双击运行：

```
videoqptool.exe
ffmpeg.exe          # 或放在 ffmpeg/ 或 ffmpeg/bin/ 子目录下
```

程序启动后会自动打印访问地址，默认 `http://localhost:13838`。

## 项目结构

```
videoqptool/
├── server.js          # 后端服务（Express + FFmpeg 调用）
├── public/
│   ├── index.html     # 页面
│   ├── css/style.css  # 样式
│   ├── js/app.js      # 前端逻辑
│   └── src/           # 图标和音频等资源
├── uploads/           # 上传的临时文件
├── output/            # 转换输出目录
└── package.json
```

## License

MIT

## 致谢

logo图像来源于[Icon-Icons](https://icon-icons.com/icon/slow-motion-video/117417)
音频素材来源于 [Freesound: RICHERlandTV](https://freesound.org/people/RICHERlandTV/)
音频素材来源于 [Freesound: Kenneth_Cooney](https://freesound.org/people/Kenneth_Cooney/)
音频素材来源于 [Freesound: Abacagi](https://freesound.org/people/Abacagi/)
音频素材来源于 [Freesound: elisfir](https://freesound.org/people/elisfir/)
