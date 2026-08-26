// VideoQPTool 桌面壳（Electron 主进程）
// 职责：
//  1. 内嵌启动本地服务（server.js，Express + ffmpeg 转换逻辑完全复用）
//  2. 服务就绪后创建桌面窗口，直接加载本地页面（不打开系统浏览器）
//  3. 退出时正常关闭服务并结束进程
const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = process.env.PORT || 13838;
const APP_URL = `http://localhost:${PORT}`;

let mainWindow = null;

// 轮询等待本地服务就绪
function waitForServer(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tryOnce = () => {
            const req = http.get(APP_URL, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', () => {
                if (Date.now() - start > timeoutMs) {
                    reject(new Error('本地服务启动超时，请重试'));
                } else {
                    setTimeout(tryOnce, 250);
                }
            });
            req.setTimeout(2000, () => { req.destroy(); });
        };
        tryOnce();
    });
}

// 检测目录是否可写
function isWritableDir(dir) {
    try {
        const probe = path.join(dir, `.vqt-write-test-${process.pid}`);
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return true;
    } catch (e) {
        return false;
    }
}

// 数据目录：
//  - 便携版：exe 所在目录（electron-builder portable 运行时设置 PORTABLE_EXECUTABLE_DIR 指向用户放置 exe 的目录）
//  - 安装版：安装目录（即 exe 所在目录）
//  - 若上述目录不可写（如安装到 Program Files），回退到 userData
//  - 开发模式（npm run dev 未打包）一律用 userData，避免污染 electron 开发目录
function resolveDataDir() {
    if (app.isPackaged) {
        if (process.env.PORTABLE_EXECUTABLE_DIR) {
            if (isWritableDir(process.env.PORTABLE_EXECUTABLE_DIR)) {
                return process.env.PORTABLE_EXECUTABLE_DIR;
            }
        } else if (process.execPath) {
            const exeDir = path.dirname(process.execPath);
            if (isWritableDir(exeDir)) {
                return exeDir;
            }
        }
    }
    return app.getPath('userData');
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 960,
        minHeight: 640,
        show: false, // 先隐藏，待窗口最大化后再显示，避免出现"先小后大"的闪烁
        autoHideMenuBar: true,
        title: 'VideoQPTool',
        icon: path.join(__dirname, 'videoqptool.ico'),
        backgroundColor: '#f5f6fa',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    // 启动即最大化
    mainWindow.maximize();

    // 页面就绪后再显示（此时已是最大化状态）
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // 页面中的外链（GitHub、ffmpeg 下载页等）交给系统默认浏览器
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    // 拦截页面内导航到非本地地址的情况
    mainWindow.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith(APP_URL)) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    // 阻止页面修改窗口标题
    mainWindow.on('page-title-updated', (e) => e.preventDefault());

    mainWindow.loadURL(APP_URL);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(async () => {
    // 数据目录（优先 exe 同目录实现便携；不可写时回退 userData），同时告诉 server.js 不要自动打开系统浏览器
    process.env.VIDEOQPTOOL_DATA_DIR = resolveDataDir();
    process.env.VIDEOQPTOOL_NO_BROWSER = '1';

    // 内嵌启动本地服务（server.js 检测到 VIDEOQPTOOL_DATA_DIR 后会把数据放 userData）
    try {
        require(path.join(__dirname, 'server.js'));
    } catch (err) {
        dialog.showErrorBox('VideoQPTool 启动失败', String((err && err.stack) || err));
        app.quit();
        return;
    }

    // 等待服务就绪后再创建窗口
    try {
        await waitForServer(15000);
    } catch (err) {
        dialog.showErrorBox('VideoQPTool 启动失败', String((err && err.message) || err));
        app.quit();
        return;
    }

    createWindow();
});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    // macOS 点击 Dock 图标时若无窗口则重建
    if (mainWindow === null && process.platform === 'darwin') {
        createWindow();
    }
});
