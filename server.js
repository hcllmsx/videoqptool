const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 13838;

// ── 目录配置 ──────────────────────────────────────────
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const OUTPUT_DIR = path.join(BASE_DIR, 'output');

[UPLOADS_DIR, OUTPUT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── 静态文件 ──────────────────────────────────────────
const PUBLIC_DIR = process.pkg
    ? path.join(path.dirname(process.execPath), 'public')
    : path.join(__dirname, 'public');

// 如果打包模式下 public 目录不存在，从快照中复制
if (process.pkg && !fs.existsSync(PUBLIC_DIR)) {
    const snapshotPublic = path.join(__dirname, 'public');
    copyDirSync(snapshotPublic, PUBLIC_DIR);
}

app.use(express.static(PUBLIC_DIR));
app.use(express.json());
app.use('/output', express.static(OUTPUT_DIR));

// ── 文件上传配置 ──────────────────────────────────────
const UPLOADS_META = path.join(UPLOADS_DIR, '.metadata.json');

function getUploadsMeta() {
    try {
        if (fs.existsSync(UPLOADS_META)) {
            return JSON.parse(fs.readFileSync(UPLOADS_META, 'utf8'));
        }
    } catch (e) { }
    return {};
}

function saveUploadsMeta(meta) {
    try {
        fs.writeFileSync(UPLOADS_META, JSON.stringify(meta, null, 2), 'utf8');
    } catch (e) { }
}

// ── 预设管理 ──────────────────────────────────────────
const PRESETS_FILE = path.join(BASE_DIR, 'presets.json');

function getPresets() {
    try {
        if (fs.existsSync(PRESETS_FILE)) {
            return JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
        }
    } catch (e) { }
    // 首次运行（如 exe 打包后），自动生成默认预设
    const defaults = {
        'CPU编码-h264-crf28-25fps-medium': {
            videoCodec: 'libx264', audioCodec: 'aac', resolution: 'original',
            framerate: '25', preset: 'medium', quality: 28,
            hlsSegmentType: 'mpegts', hlsSliceMode: 'time', hlsTime: 10,
            hlsSize: 10, videoBitrate: '', audioBitrate: 'original',
            audioSampleRate: 'original'
        },
        'N卡编码-h264-cq30-25fps-p7': {
            videoCodec: 'h264_nvenc', audioCodec: 'aac', resolution: 'original',
            framerate: '25', preset: 'p7', quality: 30,
            hlsSegmentType: 'mpegts', hlsSliceMode: 'time', hlsTime: 10,
            hlsSize: 10, videoBitrate: '', audioBitrate: '128k',
            audioSampleRate: '44100'
        },
        'N卡编码-h264-fmp4-cq30-25fps-p7': {
            videoCodec: 'h264_nvenc', audioCodec: 'aac', resolution: 'original',
            framerate: '25', preset: 'p7', quality: 30,
            hlsSegmentType: 'fmp4', hlsSliceMode: 'time', hlsTime: 10,
            hlsSize: 10, videoBitrate: '', audioBitrate: '128k',
            audioSampleRate: '44100'
        }
    };
    savePresets(defaults);
    return defaults;
}

function savePresets(presets) {
    try {
        fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2), 'utf8');
    } catch (e) { }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB
});

// ── 任务管理 ──────────────────────────────────────────
const tasks = new Map();
const pendingQueue = [];
let activeTasks = 0;
const MAX_CONCURRENT = 1;

function processQueue() {
    if (activeTasks >= MAX_CONCURRENT || pendingQueue.length === 0) return;

    const item = pendingQueue.shift();
    const task = tasks.get(item.taskId);

    // 仅处理处于 pending 状态的任务
    if (!task || task.status !== 'pending') {
        processQueue();
        return;
    }

    activeTasks++;
    task.status = 'converting';
    task.startTime = Date.now();

    // 此时才真正创建输出文件夹，避免预先生成空文件夹
    if (task.outputDir && !fs.existsSync(task.outputDir)) {
        fs.mkdirSync(task.outputDir, { recursive: true });
    }

    getDuration(item.inputPath).then(duration => {
        task.duration = duration;

        const ffmpeg = spawn(FFMPEG_PATH, item.args, {
            cwd: task.outputDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        task.process = ffmpeg; // 保存进程引用以便终止
        let stderrData = '';

        ffmpeg.stderr.on('data', (data) => {
            const str = data.toString();
            stderrData += str;

            const timeMatch = str.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (timeMatch) {
                const hours = parseInt(timeMatch[1]);
                const minutes = parseInt(timeMatch[2]);
                const seconds = parseInt(timeMatch[3]);
                const currentTime = hours * 3600 + minutes * 60 + seconds;
                task.currentTime = currentTime;
                if (duration > 0) {
                    task.progress = Math.min(99, Math.round((currentTime / duration) * 100));
                }
            }
        });

        ffmpeg.on('close', (code) => {
            task.process = null;
            if (task.status === 'error') {
                // 已被 abort 设置为 error，不覆盖
                activeTasks--;
                processQueue();
                return;
            }
            if (code === 0) {
                task.status = 'done';
                task.progress = 100;
                task.endTime = Date.now();
            } else {
                task.status = 'error';
                task.error = `ffmpeg 退出码: ${code}\n${stderrData.slice(-500)}`;
            }
            activeTasks--;
            processQueue();
        });

        ffmpeg.on('error', (err) => {
            task.process = null;
            task.status = 'error';
            task.error = err.message;
            activeTasks--;
            processQueue();
        });
    });
}

// ── 检测 ffmpeg ──────────────────────────────────────
function getFfmpegVersion(ffmpegPath) {
    try {
        const output = execSync(`"${ffmpegPath}" -version`, { encoding: 'utf8' });
        const firstLine = output.split('\n')[0];
        const match = firstLine.match(/version\s+([^\s,]+)/i);
        return match ? match[1] : 'unknown';
    } catch {
        return 'unknown';
    }
}

function findFfmpeg() {
    let foundPath = null;

    // 1. 同目录下的 ffmpeg.exe
    const localFfmpeg = path.join(BASE_DIR, 'ffmpeg.exe');
    if (fs.existsSync(localFfmpeg)) {
        foundPath = localFfmpeg;
    } else {
        // 2. 同目录 ffmpeg 文件夹中
        const subFfmpeg = path.join(BASE_DIR, 'ffmpeg', 'ffmpeg.exe');
        if (fs.existsSync(subFfmpeg)) {
            foundPath = subFfmpeg;
        } else {
            // 3. 同目录 ffmpeg/bin 文件夹中
            const binFfmpeg = path.join(BASE_DIR, 'ffmpeg', 'bin', 'ffmpeg.exe');
            if (fs.existsSync(binFfmpeg)) {
                foundPath = binFfmpeg;
            } else {
                // 4. 系统 PATH 中
                try {
                    execSync('ffmpeg -version', { stdio: 'ignore' });
                    foundPath = 'ffmpeg';
                } catch {
                    foundPath = null;
                }
            }
        }
    }

    if (foundPath) {
        return {
            path: foundPath,
            version: getFfmpegVersion(foundPath)
        };
    }
    return null;
}

const FFMPEG_INFO = findFfmpeg();
const FFMPEG_PATH = FFMPEG_INFO ? FFMPEG_INFO.path : null;
const FFMPEG_VERSION = FFMPEG_INFO ? FFMPEG_INFO.version : null;

// ── API 路由 ──────────────────────────────────────────

// 获取已存在的本地文件列表
app.get('/api/uploads', (req, res) => {
    try {
        const meta = getUploadsMeta();
        const exts = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.ts', '.m4v', '.3gp'];
        const files = fs.readdirSync(UPLOADS_DIR)
            .filter(f => exts.includes(path.extname(f).toLowerCase()))
            .map(f => {
                const stat = fs.statSync(path.join(UPLOADS_DIR, f));
                return {
                    filename: f,
                    originalname: (meta[f] && meta[f].originalname) || f,
                    size: stat.size,
                    mtime: stat.mtimeMs
                };
            })
            .sort((a, b) => b.mtime - a.mtime);
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: '读取目录失败: ' + err.message });
    }
});

// 检查 ffmpeg 状态
app.get('/api/status', (req, res) => {
    res.json({
        ffmpegAvailable: !!FFMPEG_PATH,
        ffmpegPath: FFMPEG_PATH || '未找到',
        ffmpegVersion: FFMPEG_VERSION || '未知',
        uploadsDir: UPLOADS_DIR,
        outputDir: OUTPUT_DIR
    });
});

// ── 预设 API ──────────────────────────────────────────

// 获取所有预设
app.get('/api/presets', (req, res) => {
    res.json(getPresets());
});

// 保存/更新预设
app.post('/api/presets', (req, res) => {
    const { name, settings } = req.body;
    if (!name || !settings) {
        return res.status(400).json({ error: '预设名称和设置不能为空' });
    }
    const presets = getPresets();
    presets[name] = settings;
    savePresets(presets);
    res.json({ success: true });
});

// 删除预设
app.delete('/api/presets/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name);
    const presets = getPresets();
    if (!presets[name]) {
        return res.status(404).json({ error: '预设不存在' });
    }
    delete presets[name];
    savePresets(presets);
    res.json({ success: true });
});

// 上传视频
app.post('/api/upload', upload.single('video'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '未选择文件' });
    }
    // multer 默认以 latin1 解析 Content-Disposition 中的文件名，中文会变乱码
    // 将 latin1 字节还原为 Buffer 再以 utf8 解码即可
    const fixedName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // ── 去重检查：如果 uploads 中已存在同名同大小的文件，复用已有文件 ──
    const checkName = req.query.checkName || fixedName;
    const checkSize = parseInt(req.query.checkSize) || req.file.size;
    const meta = getUploadsMeta();

    let existingFilename = null;
    for (const [storedFileName, entry] of Object.entries(meta)) {
        if (entry && entry.originalname === checkName && entry.size === checkSize) {
            // 确认文件确实还在磁盘上
            if (fs.existsSync(path.join(UPLOADS_DIR, storedFileName))) {
                existingFilename = storedFileName;
                break;
            }
        }
    }

    if (existingFilename) {
        // 已存在相同文件，删除刚上传的重复文件
        try {
            fs.unlinkSync(req.file.path);
        } catch (e) { /* 忽略删除失败 */ }

        res.json({
            filename: existingFilename,
            originalname: checkName,
            size: checkSize,
            path: path.join(UPLOADS_DIR, existingFilename),
            reused: true
        });
        return;
    }

    // 保存原始文件名 + 文件大小到 metadata
    meta[req.file.filename] = {
        originalname: fixedName,
        size: req.file.size
    };
    saveUploadsMeta(meta);

    res.json({
        filename: req.file.filename,
        originalname: fixedName,
        size: req.file.size,
        path: req.file.path
    });
});

// 开始转换
app.post('/api/convert', (req, res) => {
    if (!FFMPEG_PATH) {
        return res.status(500).json({ error: '未找到 ffmpeg，请确保 ffmpeg 已安装或放在程序同目录下' });
    }

    const { filename, originalname, settings, presetName } = req.body;
    const inputPath = path.join(UPLOADS_DIR, filename);

    if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: '源文件不存在' });
    }

    const taskId = uuidv4().slice(0, 4);
    const baseName = path.parse(originalname || filename).name;
    const taskOutputDir = path.join(OUTPUT_DIR, `${baseName}_${taskId}`);
    // fs.mkdirSync(taskOutputDir, { recursive: true }); // 移至任务真正启动时再创建

    const task = {
        id: taskId,
        filename: originalname || filename,
        sourceFile: filename,
        status: 'pending',
        progress: 0,
        duration: 0,
        currentTime: 0,
        outputDir: taskOutputDir,
        startTime: null,
        error: null,
        presetName: presetName || '面板设置'
    };
    tasks.set(taskId, task);

    // 构建 ffmpeg 参数（传入 taskId 作为默认分片前缀）
    const args = buildFfmpegArgs(inputPath, taskOutputDir, settings || {}, taskId);

    // 保存到 task 以便跳过后重新入队
    task.inputPath = inputPath;
    task.args = args;

    pendingQueue.push({ taskId, inputPath, args });
    processQueue();

    res.json({ taskId, outputDir: taskOutputDir });
});

// 获取任务进度
app.get('/api/progress/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    res.json({
        id: task.id,
        filename: task.filename,
        sourceFile: task.sourceFile,
        status: task.status,
        progress: task.progress,
        duration: task.duration,
        currentTime: task.currentTime,
        error: task.error,
        elapsed: task.startTime ? Date.now() - task.startTime : 0,
        outputDir: task.outputDir,
        presetName: task.presetName,
        command: task.args ? ['ffmpeg', ...task.args].map(a => String(a).includes(' ') ? `"${a}"` : a).join(' ') : ''
    });
});

// 获取所有任务
app.get('/api/tasks', (req, res) => {
    const list = [];
    tasks.forEach(task => {
        list.push({
            id: task.id,
            filename: task.filename,
            sourceFile: task.sourceFile,
            status: task.status,
            progress: task.progress,
            elapsed: task.startTime ? Date.now() - task.startTime : 0,
            presetName: task.presetName,
            command: task.args ? ['ffmpeg', ...task.args].map(a => String(a).includes(' ') ? `"${a}"` : a).join(' ') : ''
        });
    });
    res.json(list);
});

// 获取输出文件列表
app.get('/api/output/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    if (!fs.existsSync(task.outputDir)) {
        return res.json({ files: [] });
    }

    const files = fs.readdirSync(task.outputDir).map(f => ({
        name: f,
        size: fs.statSync(path.join(task.outputDir, f)).size,
        url: `/output/${path.basename(task.outputDir)}/${f}`
    }));
    res.json({ files, outputDir: task.outputDir });
});

// 在资源管理器中打开目录
app.post('/api/open-folder', (req, res) => {
    const { folderPath } = req.body;
    if (!folderPath || !fs.existsSync(folderPath)) {
        return res.status(404).json({ error: '目录不存在' });
    }

    try {
        const command = process.platform === 'win32'
            ? `start "" "${folderPath}"`
            : process.platform === 'darwin'
                ? `open "${folderPath}"`
                : `xdg-open "${folderPath}"`;
        execSync(command);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: '无法打开目录: ' + err.message });
    }
});

// 处理自动关机与输出日志
app.post('/api/shutdown', (req, res) => {
    const { outputLog } = req.body;
    const { exec } = require('child_process');

    if (outputLog) {
        try {
            let totalSeconds = 0;
            tasks.forEach(task => {
                if ((task.status === 'done' || task.status === 'error') && task.startTime && task.endTime) {
                    totalSeconds += Math.floor((task.endTime - task.startTime) / 1000);
                }
            });

            let totalElapsedStr = '0秒';
            if (totalSeconds > 0) {
                const totalM = Math.floor(totalSeconds / 60);
                const totalS = totalSeconds % 60;
                totalElapsedStr = totalM > 0 ? `${totalM}分${totalS}秒` : `${totalS}秒`;
            }

            const logLines = [
                'VideoQPTool 批量转换日志',
                `任务完成时间: ${new Date().toLocaleString()}`,
                `耗时总计: ${totalElapsedStr}`,
                '-'.repeat(40)
            ];

            let count = 0;
            tasks.forEach(task => {
                if (task.status === 'done' || task.status === 'error') {
                    count++;
                    let elapsedStr = '未知';
                    if (task.startTime && task.endTime) {
                        const sec = Math.floor((task.endTime - task.startTime) / 1000);
                        const m = Math.floor(sec / 60);
                        const s = sec % 60;
                        elapsedStr = m > 0 ? `${m}分${s}秒` : `${s}秒`;
                    }
                    logLines.push(`[任务 ID: ${task.id}]`);
                    logLines.push(`转换参数: ${task.presetName || '面板设置'}`);
                    logLines.push(`文件名称: ${task.filename}`);
                    logLines.push(`最终状态: ${task.status === 'done' ? '成功' : '失败'}`);
                    logLines.push(`转换耗时: ${elapsedStr}`);
                    if (task.status === 'error' && task.error) {
                        logLines.push(`错误信息: ${task.error.split('\n')[0]}`);
                    }
                    logLines.push('-'.repeat(40));
                }
            });

            if (count > 0) {
                const now = new Date();
                const pad = n => n.toString().padStart(2, '0');
                const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                const logFileName = `转换日志_${timestamp}.txt`;
                fs.writeFileSync(path.join(OUTPUT_DIR, logFileName), logLines.join('\n'), 'utf8');
            }
        } catch (err) {
            console.error('保存日志失败:', err);
        }
    }

    try {
        if (process.platform === 'win32') {
            exec('shutdown /s /t 30');
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            exec('shutdown +1');
        }
        res.json({ success: true, message: '已执行自动关机指令' });
    } catch (err) {
        res.status(500).json({ error: '执行关机失败' });
    }
});

// 取消自动关机
app.post('/api/cancel-shutdown', (req, res) => {
    const { exec } = require('child_process');
    try {
        if (process.platform === 'win32') {
            exec('shutdown /a');
        } else if (process.platform === 'darwin' || process.platform === 'linux') {
            exec('shutdown -c');
        }
        res.json({ success: true, message: '已取消关机' });
    } catch (err) {
        res.status(500).json({ error: '取消关机失败' });
    }
});

// 切换任务跳过状态（pending ↔ skipped）
app.post('/api/task/:taskId/toggle-skip', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    if (task.status === 'pending') {
        task.status = 'skipped';
    } else if (task.status === 'skipped') {
        task.status = 'pending';
        // 重新加入处理队列
        if (task.inputPath && task.args) {
            pendingQueue.push({ taskId: task.id, inputPath: task.inputPath, args: task.args });
            processQueue();
        }
    } else {
        return res.status(400).json({ error: '只能切换排队中或已跳过的任务' });
    }
    res.json({ success: true, status: task.status });
});

// 终止所有转换任务
app.post('/api/abort-all', (req, res) => {
    // 1. 将排队中的任务标记为 error
    while (pendingQueue.length > 0) {
        const item = pendingQueue.shift();
        const task = tasks.get(item.taskId);
        if (task && (task.status === 'pending' || task.status === 'skipped')) {
            task.status = 'error';
            task.error = '用户终止';
        }
    }

    // 2. 杀掉正在转换的 ffmpeg 进程
    let killedCount = 0;
    tasks.forEach(task => {
        if (task.status === 'converting' && task.process) {
            task.status = 'error';
            task.error = '用户终止';
            try {
                task.process.kill('SIGKILL');
            } catch (e) { /* 忽略 */ }
            killedCount++;
        } else if (task.status === 'skipped') {
            task.status = 'error';
            task.error = '用户终止';
        }
    });

    activeTasks = 0;
    res.json({ success: true, killedCount });
});

// 删除任务记录（保留输出文件）
app.delete('/api/task/:taskId', (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    tasks.delete(req.params.taskId);
    res.json({ success: true });
});

// ── 辅助函数 ──────────────────────────────────────────

function buildFfmpegArgs(inputPath, outputDir, settings, taskId) {
    const {
        videoCodec = 'libx264',
        audioCodec = 'aac',
        resolution = 'original',
        framerate = 'original',
        videoBitrate = '',
        audioBitrate = '128k',
        audioSampleRate = 'original',
        hlsSegmentType = 'mpegts',
        hlsSliceMode = 'time',
        hlsTime = 10,
        hlsSize = 10,
        quality = 23,
        preset = 'medium',
        segmentPrefix = '',
        appleCompatible = false
    } = settings;

    // 参数范围校验：只读取 quality
    const safeQuality = Math.max(15, Math.min(35, parseInt(quality) || 23));
    const safeHlsTime = Math.max(2, Math.min(30, parseInt(hlsTime) || 10));
    const safeHlsSize = Math.max(1, Math.min(50, parseInt(hlsSize) || 10));

    // 分片命名前缀：用户指定（至少4字符） > 任务ID（关联溯源）
    let prefix = segmentPrefix.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!prefix || prefix.length < 4) {
        prefix = taskId;
    }

    const m3u8Path = path.join(outputDir, 'index.m3u8');
    const segmentExt = hlsSegmentType === 'fmp4' ? '.m4s' : '.ts';
    const segmentPath = path.join(outputDir, `${prefix}_%03d${segmentExt}`);

    const args = ['-i', inputPath, '-y'];

    // 视频编码
    if (videoCodec === 'copy') {
        args.push('-c:v', 'copy');
    } else {
        args.push('-c:v', videoCodec);

        if (videoCodec.includes('nvenc')) {
            args.push('-cq', String(safeQuality));
            args.push('-preset', preset || 'p4');
            args.push('-b:v', videoBitrate || '0');
        } else if (videoCodec.includes('qsv')) {
            args.push('-global_quality', String(safeQuality));
            args.push('-preset', preset || 'medium');
            if (videoBitrate) args.push('-b:v', videoBitrate);
        } else if (videoCodec.includes('amf')) {
            args.push('-qp_i', String(safeQuality));
            args.push('-qp_p', String(safeQuality));
            args.push('-quality', preset || 'balanced');
            if (videoBitrate) args.push('-b:v', videoBitrate);
        } else {
            // CPU
            args.push('-crf', String(safeQuality));
            args.push('-preset', preset || 'medium');
            if (videoBitrate) args.push('-b:v', videoBitrate);
        }

        // 帧率
        if (framerate !== 'original') {
            args.push('-r', String(framerate));
        }

        // HLS 兼容性与关键帧优化
        const fps = framerate !== 'original' ? (parseInt(framerate) || 25) : 25;

        // 如果是 m4s (fmp4)，应用更严格的关键帧对齐以解决播放问题
        if (hlsSliceMode === 'time' && hlsSegmentType === 'fmp4') {
            args.push('-pix_fmt', 'yuv420p');
            if (videoCodec.includes('264')) {
                args.push('-profile:v', 'high', '-level', '5.1');
            }
            
            // 关键帧强行对齐：GOP 建议与切片时长严格一致
            const gop = fps * safeHlsTime;
            args.push('-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0');
            args.push('-force_key_frames', `expr:gte(t,n_forced*${safeHlsTime})`);
            
            // 对于 NVENC，设置一定的码率缓冲可能有助于解决卡顿（即使是 CQ 模式）
            if (videoCodec === 'h264_nvenc') {
                // 如果没有手动指定 bitrate，设置一个相对宽裕的 maxrate 帮助稳定流控
                // 这里仅作参考，如果仍然卡顿，建议在界面设置一个具体的码率
            }
        } else if (appleCompatible) {
            // 传统的苹果兼容性设置（主要针对 ts）
            args.push('-pix_fmt', 'yuv420p');
            if (videoCodec.includes('264')) {
                args.push('-profile:v', 'high');
            }
            const gop = fps * 2;
            args.push('-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0');
        }


    }

    // 音频编码
    if (audioCodec === 'copy') {
        args.push('-c:a', 'copy');
    } else {
        args.push('-c:a', audioCodec);

        // 音频码率：保持原始时不指定，让 ffmpeg 自动决定
        if (audioBitrate && audioBitrate !== 'original') {
            args.push('-b:a', audioBitrate);
        } else if (appleCompatible) {
            args.push('-b:a', '128k');
        }

        // 采样率
        if (audioSampleRate !== 'original') {
            args.push('-ar', String(audioSampleRate));
        }

        if (appleCompatible) {
            args.push('-ac', '2');
        }
    }

    // 分辨率缩放
    if (resolution !== 'original') {
        const scaleMap = {
            '1080p': '1920:-2',
            '720p': '1280:-2'
        };
        if (scaleMap[resolution]) {
            args.push('-vf', `scale=${scaleMap[resolution]}`);
        }
    }

    // HLS 参数
    if (hlsSliceMode === 'size') {
        const targetBytes = safeHlsSize * 1024 * 1024;
        args.push(
            '-hls_segment_type', hlsSegmentType,
            '-hls_list_size', '0',
            '-hls_segment_filename', segmentPath,
            '-f', 'hls'
        );
        // 如果想要强行通过文件大小来约束，需要一些特殊参数
        // 注：纯粹的 -hls_segment_size 可能会存在一些限制，我们加上 fmp4 或者是强制设定片段长度的折中策略
        // 但 FFmpeg 原生的 HLS muxer 其实不支持非常精确的大小切片。
        // 一个常见方法是配合 hls_time 指定一个较大的数字，然后依靠 -hls_segment_size 或者 -fs 参数去粗略约束

        args.push('-hls_flags', 'split_by_time');
        // 实际上最好用的近似切片大小参数是在某些ffmpeg版本里的 -hls_segment_size ，但这并不是所有的版本都支持。
        // 不过由于 -fs 只能停掉整个转码任务，并非切片机制，因此我们无法使用 -fs。

        // 考虑到 ffmpeg 的标准，其实并没有直接指定"切片文件大小"的绝佳完美字段, 但通过 `-hls_segment_size` 参数可设定接近值(只对 fmp4 或带分片机制的输出有效)，为了兼容原生 ts 我们这里可以使用一个 hack
        // ffmpeg >= 4.3 提供了 -hls_segment_size，接受字节
        args.push('-hls_segment_size', String(targetBytes));

        // 保险起见，设置一个基础的长切片时间作为托底，避免遇到没有关键帧永远不切片的问题
        args.push('-hls_time', '30');
        if (hlsSegmentType === 'fmp4') {
            args.push('-hls_fmp4_init_filename', `${prefix}_init.mp4`);
        }
    } else {
        args.push(
            '-hls_segment_type', hlsSegmentType,
            '-hls_time', String(safeHlsTime),
            '-hls_list_size', '0',
            '-hls_segment_filename', segmentPath,
            '-f', 'hls'
        );
        if (hlsSegmentType === 'fmp4') {
            args.push('-hls_fmp4_init_filename', `${prefix}_init.mp4`);
        }
    }
    args.push(m3u8Path);

    return args;
}

function getDuration(filePath) {
    return new Promise((resolve) => {
        const ffprobePath = FFMPEG_PATH === 'ffmpeg'
            ? 'ffprobe'
            : path.join(path.dirname(FFMPEG_PATH), 'ffprobe.exe');

        try {
            const result = execSync(
                `"${ffprobePath}" -v quiet -print_format json -show_format "${filePath}"`,
                { encoding: 'utf8', timeout: 10000 }
            );
            const info = JSON.parse(result);
            resolve(parseFloat(info.format?.duration) || 0);
        } catch {
            resolve(0);
        }
    });
}

function copyDirSync(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ── 启动服务 ──────────────────────────────────────────
const PKG_VERSION = require('./package.json').version;

const server = app.listen(PORT, () => {
    // 设置命令行窗口标题
    process.title = 'VideoQPTool';
    process.stdout.write(`\x1b]0;VideoQPTool v${PKG_VERSION}\x07`);

    const title = `VideoQPTool v${PKG_VERSION} - 视频转HLS工具`;
    // 计算显示宽度（中文字符占2列）
    let tw = 0;
    for (const ch of title) tw += (ch.charCodeAt(0) > 0x7F ? 2 : 1);
    const pad = 2;
    const border = '─'.repeat(tw + pad * 2);
    console.log('');
    console.log(`  ┌${border}┐`);
    console.log(`  │${' '.repeat(pad)}${title}${' '.repeat(pad)}│`);
    console.log(`  └${border}┘`);
    console.log('');
    console.log(`  访问地址:   http://localhost:${PORT}`);
    console.log(`  输出目录:   ${OUTPUT_DIR}`);
    console.log(`  ffmpeg: ${FFMPEG_PATH ? '✅ 已就绪' : '❌ 未找到'}`);
    console.log('');
    if (!FFMPEG_PATH) {
        console.log('  ⚠️  未找到 ffmpeg！请将 ffmpeg.exe 放到程序同目录，');
        console.log('     或确保 ffmpeg 已添加到系统 PATH 中。');
        console.log('');
    }
    console.log('');
    console.log('  ⚠️  按Ctrl+C可退出服务，关闭此窗口后也会退出服务');
    console.log('');

    // 自动打开浏览器
    try {
        const url = `http://localhost:${PORT}`;
        const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        require('child_process').exec(`${startCmd} ${url}`);
    } catch (err) {
        // 忽略打开失败的错误
    }
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ 端口 ${PORT} 已被占用！\n请检查是否已经打开了一个 VideoQPTool 服务，或者在任务管理器中结束 Node 进程。`);
    } else {
        console.error('\n❌ 启动服务失败:', err);
    }
    console.log('\n按任意键退出...');
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 1));
});

process.on('uncaughtException', (err) => {
    console.error('\n❌ 发生未捕获的错误:', err);
    console.log('\n按任意键退出...');
    if (process.stdin.setRawMode) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 1));
});
