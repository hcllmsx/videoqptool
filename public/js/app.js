/* ══════════════════════════════════════════
   VideoQPTool - 前端逻辑
   ══════════════════════════════════════════ */

(function () {
    'use strict';

    let readyFiles = [];      // 待转换的文件数组
    let pollingTimers = {};   // taskId -> intervalId
    let uploadProgressTimeout; // 上传进度条消失定时器
    let presetsCache = {};    // 预设缓存
    let completedTaskFiles = {}; // taskId -> {filename, originalname} 已完成任务的文件信息
    let loadedPresetName = '';   // 当前加载 of the 预设名称
    let needsFfmpegAlert = false; // 是否需要弹出 ffmpeg 缺失提醒

    // ── 音频资源 ─────────────────────────────
    const completedAudio = new Audio('src/completed.mp3');
    const normalAudio = new Audio('src/normal.mp3');
    const errorAudio = new Audio('src/error.mp3');
    const submitAudio = new Audio('src/submit.mp3');

    // ── 自动播放限制处理 ─────────────────────
    let audioUnlocked = false;
    function unlockAudio() {
        if (audioUnlocked) return;

        // 解锁音频上下文
        [completedAudio, normalAudio, errorAudio, submitAudio].forEach(audio => {
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(() => { });
        });
        audioUnlocked = true;

        // 如果在交互前检测到了缺失，这一刻执行提醒
        if (needsFfmpegAlert) {
            needsFfmpegAlert = false;
            showFfmpegHelp();
            // 延迟一点播放，确保解锁彻底
            setTimeout(() => {
                errorAudio.currentTime = 0;
                errorAudio.play().catch(() => { });
            }, 100);
        }

        document.removeEventListener('mousedown', unlockAudio);
        document.removeEventListener('keydown', unlockAudio);
        document.removeEventListener('touchstart', unlockAudio);
    }
    document.addEventListener('mousedown', unlockAudio);
    document.addEventListener('keydown', unlockAudio);
    document.addEventListener('touchstart', unlockAudio);

    // ── DOM 元素 ─────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const uploadZone = $('#uploadZone');
    const fileInput = $('#fileInput');
    const uploadProgress = $('#uploadProgress');
    const uploadFileName = $('#uploadFileName');
    const uploadFileSize = $('#uploadFileSize');
    const uploadProgressFill = $('#uploadProgressFill');
    const uploadPercent = $('#uploadPercent');
    const convertBtn = $('#convertBtn');
    const tasksList = $('#tasksList');
    const taskCount = $('#taskCount');
    const emptyState = $('#emptyState');
    const ffmpegStatus = $('#ffmpegStatus');
    const crfRange = $('#crf');
    const crfValue = $('#crfValue');
    const hlsSliceMode = $('#hlsSliceMode');
    const hlsTimeGroup = $('#hlsTimeGroup');
    const hlsSizeGroup = $('#hlsSizeGroup');
    const hlsTimeRange = $('#hlsTime');
    const hlsTimeValue = $('#hlsTimeValue');
    const hlsSizeRange = $('#hlsSize');
    const hlsSizeValue = $('#hlsSizeValue');
    const localFilesSelect = $('#localFilesSelect');
    const refreshLocalFilesBtn = $('#refreshLocalFilesBtn');
    const presetSelect = $('#presetSelect');
    const presetDropdown = $('#preset');
    const qualityLabel = $('#qualityLabel');
    const qualityRangeLabels = $('#qualityRangeLabels');
    const qualityGroup = $('#qualityGroup');
    const bitrateGroup = $('#bitrateGroup');
    const presetNameInput = $('#presetNameInput');
    const savePresetBtn = $('#savePresetBtn');
    const deletePresetBtn = $('#deletePresetBtn');
    const autoShutdownCb = $('#autoShutdown');
    let isConvertingBatch = false;

    // ── 初始化 ────────────────────────────────
    init();

    function init() {
        checkFfmpegStatus();
        setupUpload();
        setupLocalFiles();
        setupPresets();
        setupSettings();
        loadTasks();
        loadVersion();
    }

    // ── 版本号展示（以根目录 VERSION 文件为准）────────
    async function loadVersion() {
        try {
            const res = await fetch('/api/version');
            const data = await res.json();
            if (data && data.version) {
                const span = document.querySelector('.version-badge span');
                if (span) span.textContent = data.version;
            }
        } catch (e) { /* 接口不可用时保持默认显示，忽略 */ }
    }

    // ── 检查 ffmpeg ──────────────────────────
    async function checkFfmpegStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            const dot = ffmpegStatus.querySelector('.status-dot');
            const text = ffmpegStatus.querySelector('.status-text');

            ffmpegStatus.onclick = () => {
                showFfmpegHelp(data.ffmpegAvailable, data.ffmpegPath, data.ffmpegVersion);
            };

            if (data.ffmpegAvailable) {
                dot.classList.add('active');
                text.textContent = `ffmpeg 就绪 (${data.ffmpegVersion})`;
                ffmpegStatus.classList.add('clickable-ready');
                ffmpegStatus.title = 'ffmpeg 就绪，点击查看下载/更新指引';
            } else {
                dot.classList.add('error');
                text.textContent = 'ffmpeg 未找到 (点击查看解决方案)';
                ffmpegStatus.classList.add('clickable-error');
                ffmpegStatus.title = '未找到 ffmpeg，点击查看如何解决';

                // 标记为需要提醒。等用户第一次点击页面时，弹出对话框并播放声音
                needsFfmpegAlert = true;
            }
        } catch {
            const dot = ffmpegStatus.querySelector('.status-dot');
            dot.classList.add('error');
        }
    }

    function showFfmpegHelp(available = false, ffmpegPath = '', ffmpegVersion = '') {
        // 创建一个简单的弹窗显示解决方案
        const isOk = !!available;
        const title = isOk ? 'FFmpeg 下载与更新指南' : 'FFmpeg 未找到解决方案';
        const intro = isOk
            ? `<p style="margin-bottom: 1.5rem;">当前已就绪：<code>${ffmpegVersion}</code><br>路径：<code>${ffmpegPath}</code><br>如需检查 FFmpeg 是否有新版本、或想重新配置，可参考下方指引：</p>`
            : `<p style="margin-bottom: 1.5rem;">本程序运行需要 <strong>FFmpeg</strong>。请下载 Windows 版本的可执行文件并配置：</p>`;
        const helpOverlay = document.createElement('div');
        helpOverlay.className = 'modal-overlay';
        helpOverlay.style.zIndex = '2000'; // 确保在普通弹窗之上
        helpOverlay.innerHTML = `
            <div class="modal help-modal">
                <div class="modal-header">
                    <h3 style="margin: 0; font-size: 1.2rem;">${title}</h3>
                    <button class="modal-close">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div class="modal-body" style="padding: 1.5rem 0;">
                    ${intro}
                    
                    <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
                        <h4 style="margin: 0 0 0.75rem 0; color: var(--accent-light); font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            推荐下载地址 (Windows)
                        </h4>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <a href="https://www.gyan.dev/ffmpeg/builds/" target="_blank" class="btn btn-primary" style="display: flex; width: auto; text-decoration: none; padding: 0.6rem; font-size: 0.85rem;">Gyan.dev 编译版</a>
                            <a href="https://github.com/BtbN/FFmpeg-Builds/releases" target="_blank" class="btn btn-primary" style="display: flex; width: auto; text-decoration: none; padding: 0.6rem; font-size: 0.85rem;">BtbN (GitHub)</a>
                        </div>
                        <div style="margin-top: 1rem; font-size: 0.85rem; line-height: 1.6; color: var(--text-secondary);">
                            <p style="margin-bottom: 5px;"><strong>💡 下载建议：</strong></p>
                            <ul style="margin: 0; padding-left: 1.2rem;">
                                <li><strong>优先找后缀为 <code>.zip</code> 的压缩包</strong>（比 <code>.7z</code> 更易解压）。</li>
                                <li><strong>版本区别：</strong> <code>full</code> 是全功能版，<code>essentials</code> 是核心精简版。<strong>建议首选 <code>full</code> 版</strong>，功能最全。</li>
                                <li><strong>确认 GPL 版本：</strong> 确保文件名中有 <code>gpl</code> 字样，它才带有核心的 <code>x264/x265</code> 编码器。</li>
                                <li><strong>小白避坑：</strong> 请勿下载带 <code>shared</code> 或 <code>lgpl</code> 字样的版本（否则会因缺少编码器导致转换报错）。</li>
                            </ul>
                        </div>
                    </div>

                    <ul style="list-style: none; margin-left: 0; margin-bottom: 1.5rem; line-height: 1.8; color: var(--text-primary); padding-left: 0.5rem;">
                        <li><strong>查看当前路径：</strong> 在终端执行 <code>where.exe ffmpeg</code>（PowerShell 也可用 <code>Get-Command ffmpeg</code>），即可看到 ffmpeg 的完整路径；有输出说明已在系统 PATH 中，无输出则说明未安装。</li>
                        <li><strong>方法1：安装到系统：</strong> 将 FFmpeg 的 <code>bin</code> 目录添加到系统的 <strong>PATH</strong> 环境变量中。</li>
                        <li><strong>方法2：放置到程序目录：</strong> 解压后找到 <code>bin</code> 文件夹里的 <code>ffmpeg.exe</code>，放到本程序 exe 同目录的 <code>ffmpeg\bin</code> 文件夹下（便携版/安装版的数据目录即 exe 所在目录）。</li>
                    </ul>

                    <p style="color: var(--text-muted); font-size: 0.85rem; text-align: center;">说明：<a href="https://ffmpeg.org/download.html" target="_blank" style="color: var(--text-muted); text-decoration: underline;">FFmpeg 官网</a> 仅提供源代码，Windows 用户请使用上述编译版。</p>
                </div>
            </div>
        `;
        document.body.appendChild(helpOverlay);

        // 绑定关闭事件
        const close = () => document.body.removeChild(helpOverlay);
        helpOverlay.querySelector('.modal-close').onclick = close;
        helpOverlay.onclick = (e) => {
            if (e.target === helpOverlay) close();
        };
    }

    // ── 上传功能 ─────────────────────────────
    function setupUpload() {
        // 点击上传
        uploadZone.addEventListener('click', () => fileInput.click());

        // 文件选择
        fileInput.addEventListener('change', async (e) => {
            if (e.target.files.length) {
                // 先拷贝 FileList，因为重置 fileInput.value 会清空原始引用
                const files = Array.from(e.target.files);
                fileInput.value = '';
                await handleFiles(files);
            }
        });

        // 拖放
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });

        uploadZone.addEventListener('dragleave', () => {
            uploadZone.classList.remove('dragover');
        });

        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            if (e.dataTransfer.files.length) {
                handleFiles(e.dataTransfer.files);
            }
        });
    }

    async function handleFiles(files) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (!file.type.startsWith('video/') && !isVideoExtension(file.name)) {
                showToast(`"${file.name}" 不是视频文件已跳过`, 'error');
                continue;
            }
            // 检查是否已在待转换列表中（按文件名+大小判断）
            const alreadyInList = readyFiles.some(
                rf => rf.originalname === file.name && rf.size === file.size
            );
            if (alreadyInList) {
                showToast(`"${file.name}" 已在待转换列表中，无需重复添加`, 'info', false);
                continue;
            }
            await uploadSingleFile(file);
        }
    }

    function uploadSingleFile(file) {
        return new Promise((resolve) => {
            clearTimeout(uploadProgressTimeout);
            uploadProgress.classList.remove('hidden');
            uploadFileName.textContent = `上传中: ${file.name}`;
            uploadFileSize.textContent = formatSize(file.size);
            uploadProgressFill.style.width = '0%';
            uploadPercent.textContent = '0%';
            convertBtn.disabled = true;

            const formData = new FormData();
            formData.append('video', file);

            const xhr = new XMLHttpRequest();
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = Math.round((e.loaded / e.total) * 100);
                    uploadProgressFill.style.width = pct + '%';
                    uploadPercent.textContent = pct + '%';
                }
            };

            xhr.onload = () => {
                if (xhr.status === 200) {
                    const data = JSON.parse(xhr.responseText);
                    data.tempId = 'ready_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                    readyFiles.push(data);
                    renderReadyFilesState();
                    renderTask({
                        id: data.tempId,
                        filename: data.originalname,
                        status: 'ready',
                        progress: 0,
                        elapsed: 0
                    });
                    if (localFilesSelect) localFilesSelect.value = '';
                    showToast(`上传 "${data.originalname}" 成功`, 'success');
                    if (typeof loadLocalFiles === 'function') setTimeout(loadLocalFiles, 500);
                } else {
                    showToast(`上传 "${file.name}" 失败`, 'error');
                }
                uploadProgressTimeout = setTimeout(() => uploadProgress.classList.add('hidden'), 500);
                resolve();
            };

            xhr.onerror = () => {
                showToast(`上传 "${file.name}" 出错`, 'error');
                uploadProgressTimeout = setTimeout(() => uploadProgress.classList.add('hidden'), 500);
                resolve();
            };

            // 将文件名和大小作为查询参数传给服务端，用于去重
            const params = new URLSearchParams({
                checkName: file.name,
                checkSize: file.size
            });
            xhr.open('POST', `/api/upload?${params.toString()}`);
            xhr.send(formData);
        });
    }

    function renderReadyFilesState() {
        // 转换进行中时显示终止按钮
        if (isConvertingBatch) {
            convertBtn.disabled = false;
            convertBtn.className = 'btn btn-danger';
            convertBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon"><rect x="6" y="6" width="12" height="12" rx="1"></rect></svg>
                终止转换
            `;
            convertBtn.onclick = abortAll;
            return;
        }

        // 恢复正常状态
        convertBtn.className = 'btn btn-primary';
        convertBtn.onclick = startConvert;

        if (readyFiles.length === 0) {
            convertBtn.disabled = true;
            convertBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                开始转换
            `;
            return;
        }

        convertBtn.disabled = false;
        const btnLabel = readyFiles.length > 1
            ? `批量转换 (${readyFiles.length})`
            : '开始转换';
        convertBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="icon"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            ${btnLabel}
        `;
    }

    function isVideoExtension(name) {
        const exts = ['.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.ts', '.m4v', '.3gp'];
        return exts.some(ext => name.toLowerCase().endsWith(ext));
    }

    // ── 本地文件选择 ─────────────────────────
    function setupLocalFiles() {
        if (!localFilesSelect || !refreshLocalFilesBtn) return;

        loadLocalFiles();

        refreshLocalFilesBtn.addEventListener('click', (e) => {
            e.preventDefault();
            loadLocalFiles();
        });

        localFilesSelect.addEventListener('change', (e) => {
            if (!e.target.value) return;

            const fileData = JSON.parse(decodeURIComponent(e.target.value));
            const tempId = 'ready_' + Date.now() + '_' + Math.floor(Math.random() * 1000);

            readyFiles.push({
                filename: fileData.filename,
                originalname: fileData.originalname || fileData.filename,
                size: fileData.size,
                tempId: tempId
            });

            renderReadyFilesState();
            renderTask({
                id: tempId,
                filename: fileData.originalname || fileData.filename,
                status: 'ready',
                progress: 0,
                elapsed: 0
            });

            // 重置选框以便再次选择
            localFilesSelect.value = '';
        });
    }

    async function loadLocalFiles() {
        if (!localFilesSelect) return;
        try {
            localFilesSelect.innerHTML = '<option value="">加载中...</option>';
            const res = await fetch('/api/uploads');
            const files = await res.json();

            if (files.length === 0) {
                localFilesSelect.innerHTML = '<option value="">目录为空</option>';
                return;
            }

            let html = '<option value="">-- 请选择文件 --</option>';
            files.forEach(f => {
                const val = encodeURIComponent(JSON.stringify({ filename: f.filename, originalname: f.originalname, size: f.size }));
                html += `<option value="${val}">${escapeHtml(f.originalname || f.filename)} (${formatSize(f.size)})</option>`;
            });
            localFilesSelect.innerHTML = html;

            // 如果之前选中的文件还在列表里，可以考虑恢复选中状态，目前先不处理
        } catch (err) {
            localFilesSelect.innerHTML = '<option value="">加载失败</option>';
        }
    }

    // ── 预设系统 ─────────────────────────────
    async function setupPresets() {
        await loadPresets();

        // 选择预设时自动填充设置面板
        presetSelect.addEventListener('change', () => {
            const name = presetSelect.value;
            if (name && presetsCache[name]) {
                applySettings(presetsCache[name]);
                loadedPresetName = name;
                showToast(`已加载预设「${name}」`, 'info', false);
            } else {
                loadedPresetName = '';
                checkPresetModified();
            }
        });

        // 保存预设
        savePresetBtn.addEventListener('click', async () => {
            const name = presetNameInput.value.trim();
            if (!name) {
                showToast('请输入预设名称', 'error');
                presetNameInput.focus();
                return;
            }
            if (name.length > 30) {
                showToast('预设名称不能超过 30 个字符', 'error');
                presetNameInput.focus();
                return;
            }
            // 同名预设覆盖确认
            if (presetsCache[name]) {
                if (!confirm(`预设「${name}」已存在，确定要覆盖吗？`)) return;
            }
            const settings = getSettings();
            try {
                const res = await fetch('/api/presets', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, settings })
                });
                if (res.ok) {
                    presetsCache[name] = settings;
                    renderPresetOptions();
                    presetSelect.value = name;
                    showToast(`预设「${name}」已保存`, 'success');
                }
            } catch {
                showToast('保存预设失败', 'error');
            }
        });

        // 删除预设
        deletePresetBtn.addEventListener('click', async () => {
            const name = presetSelect.value;
            if (!name) {
                showToast('请先选择要删除的预设', 'error');
                return;
            }
            if (!confirm(`确定要删除预设「${name}」吗？`)) return;
            try {
                const res = await fetch(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
                if (res.ok) {
                    delete presetsCache[name];
                    renderPresetOptions();
                    showToast(`预设「${name}」已删除`, 'info', false);
                }
            } catch {
                showToast('删除预设失败', 'error');
            }
        });
    }

    async function loadPresets() {
        try {
            const res = await fetch('/api/presets');
            presetsCache = await res.json();
            renderPresetOptions();
        } catch {
            presetsCache = {};
        }
    }

    function renderPresetOptions() {
        const names = Object.keys(presetsCache);
        let html = '<option value="">-- 选择转换预设 --</option>';
        names.forEach(name => {
            html += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        });
        presetSelect.innerHTML = html;

        // 同时更新所有 ready 任务卡片上的预设下拉框
        document.querySelectorAll('.task-preset-select').forEach(sel => {
            const current = sel.value;
            let taskHtml = '<option value="__current__">当前面板设置</option>';
            names.forEach(name => {
                taskHtml += `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            });
            sel.innerHTML = taskHtml;
            if (current && sel.querySelector(`option[value="${CSS.escape(current)}"]`)) {
                sel.value = current;
            }
        });
    }

    function applySettings(s) {
        if (!s) return;
        const set = (id, val) => { const el = $('#' + id); if (el && val !== undefined) el.value = val; };
        set('videoCodec', s.videoCodec);
        set('audioCodec', s.audioCodec);

        // Ensure options are updated before setting the preset value
        if (s.videoCodec) {
            updateVideoEncoderOptions(s.videoCodec);
        }

        set('resolution', s.resolution);
        set('framerate', s.framerate);
        set('preset', s.preset);
        set('hlsSegmentType', s.hlsSegmentType);
        set('hlsSliceMode', s.hlsSliceMode);
        set('audioBitrate', s.audioBitrate);
        set('audioSampleRate', s.audioSampleRate);
        set('appleCompatible', s.appleCompatible !== undefined ? String(s.appleCompatible) : 'true');

        if (s.quality !== undefined) {
            crfRange.value = s.quality;
            crfValue.textContent = s.quality;
        }
        if (s.hlsTime !== undefined) {
            hlsTimeRange.value = s.hlsTime;
            hlsTimeValue.textContent = '约 ' + s.hlsTime + ' 秒';
        }
        if (s.hlsSize !== undefined) {
            hlsSizeRange.value = s.hlsSize;
            hlsSizeValue.textContent = '约 ' + s.hlsSize + ' MB';
        }
        if (s.videoBitrate !== undefined) $('#videoBitrate').value = s.videoBitrate;

        // 触发联动逻辑
        if (s.hlsSliceMode === 'time') {
            hlsTimeGroup.classList.remove('hidden');
            hlsSizeGroup.classList.add('hidden');
        } else if (s.hlsSliceMode === 'size') {
            hlsTimeGroup.classList.add('hidden');
            hlsSizeGroup.classList.remove('hidden');
        }

        const isCopyVideo = s.videoCodec === 'copy';
        crfRange.disabled = isCopyVideo;
        $('#preset').disabled = isCopyVideo;
        $('#videoBitrate').disabled = isCopyVideo;
        $('#resolution').disabled = isCopyVideo;
        $('#framerate').disabled = isCopyVideo;

        const isCopyAudio = s.audioCodec === 'copy';
        $('#audioSampleRate').disabled = isCopyAudio;
        $('#audioBitrate').disabled = isCopyAudio;
    }

    function getPresetNames() {
        return Object.keys(presetsCache);
    }

    // 检查当前设置是否与加载的预设不同
    function checkPresetModified() {
        // 先清理所有的被修改标记
        if (presetSelect && presetSelect.options) {
            Array.from(presetSelect.options).forEach(opt => {
                const val = opt.value;
                if (val && presetsCache[val]) {
                    opt.textContent = val;
                }
            });
        }

        if (!loadedPresetName || !presetsCache[loadedPresetName]) return;
        const current = getSettings();
        const original = presetsCache[loadedPresetName];

        let isModified = false;
        for (const key in current) {
            const curVal = current[key] === undefined || current[key] === null ? '' : String(current[key]);
            const origVal = original[key] === undefined || original[key] === null ? '' : String(original[key]);
            if (curVal !== origVal) {
                isModified = true;
                break;
            }
        }

        const opt = presetSelect.querySelector(`option[value="${CSS.escape(loadedPresetName)}"]`);
        if (!opt) return;
        if (isModified) {
            opt.textContent = loadedPresetName + ' （已修改）';
        }
    }

    // ── 编码器选项动态调整 ─────────────────────
    function updateVideoEncoderOptions(codec) {
        if (!codec || codec === 'copy') {
            qualityGroup.classList.add('hidden');
            presetDropdown.parentElement.classList.add('hidden');
            return;
        }

        qualityGroup.classList.remove('hidden');
        presetDropdown.parentElement.classList.remove('hidden');

        let presetOptions = '';
        let qLabel = 'CRF 质量';
        let qTitle = '数值越小画质越高、文件越大；数值越大画质越低、文件越小。建议根据实际效果自行测试调整。';

        if (codec.includes('nvenc')) {
            qLabel = 'CQ 质量';
            qTitle = '数值越小画质越高、文件越大；数值越大画质越低、文件越小。建议根据实际效果自行测试调整。';
            presetOptions = `
                <option value="p1">p1 (最快，质量最低)</option>
                <option value="p2">p2 (较快)</option>
                <option value="p3">p3 (较快)</option>
                <option value="p4" selected>p4 (中等)</option>
                <option value="p5">p5 (较慢)</option>
                <option value="p6">p6 (较慢)</option>
                <option value="p7">p7 (最慢，质量最高)</option>
            `;
        } else if (codec.includes('qsv')) {
            qLabel = '全局质量(GQ)';
            qTitle = '数值越小画质越高、文件越大；数值越大画质越低、文件越小。建议根据实际效果自行测试调整。';
            presetOptions = `
                <option value="veryfast">veryfast</option>
                <option value="faster">faster</option>
                <option value="fast">fast</option>
                <option value="medium" selected>medium (中等)</option>
                <option value="slow">slow</option>
                <option value="slower">slower</option>
                <option value="veryslow">veryslow</option>
            `;
        } else if (codec.includes('amf')) {
            qLabel = 'QP 质量控制';
            qTitle = '数值越小画质越高、文件越大；数值越大画质越低、文件越小。建议根据实际效果自行测试调整。';
            presetOptions = `
                <option value="speed">speed (速度优先)</option>
                <option value="balanced" selected>balanced (均衡)</option>
                <option value="quality">quality (质量优先)</option>
            `;
        } else {
            // CPU encoding
            qLabel = 'CRF 质量';
            qTitle = '数值越小画质越高、文件越大；数值越大画质越低、文件越小。建议根据实际效果自行测试调整。';
            presetOptions = `
                <option value="ultrafast">ultrafast(极快)</option>
                <option value="fast">fast(快速)</option>
                <option value="medium" selected>medium(中等)</option>
                <option value="slow">slow(慢速)</option>
                <option value="veryslow">veryslow(极慢)</option>
            `;
        }

        if (qualityLabel) qualityLabel.textContent = qLabel;
        if (qualityGroup) qualityGroup.setAttribute('data-tip', qTitle);
        if (bitrateGroup) bitrateGroup.setAttribute('data-tip', `手动指定会覆盖 ${qLabel}，一般留空`);

        // Preserve previous preset if it exists in the new options list
        const currentPreset = presetDropdown.value;
        if (presetDropdown) {
            presetDropdown.innerHTML = presetOptions;
            if (currentPreset && presetDropdown.querySelector(`option[value="${currentPreset}"]`)) {
                presetDropdown.value = currentPreset;
            }
        }
    }

    // ── 设置面板 ─────────────────────────────
    function setupSettings() {
        crfRange.addEventListener('input', () => {
            crfValue.textContent = crfRange.value;
        });

        hlsSliceMode.addEventListener('change', () => {
            if (hlsSliceMode.value === 'time') {
                hlsTimeGroup.classList.remove('hidden');
                hlsSizeGroup.classList.add('hidden');
            } else {
                hlsTimeGroup.classList.add('hidden');
                hlsSizeGroup.classList.remove('hidden');
            }
        });

        hlsTimeRange.addEventListener('input', () => {
            hlsTimeValue.textContent = '约 ' + hlsTimeRange.value + ' 秒';
        });

        hlsSizeRange.addEventListener('input', () => {
            hlsSizeValue.textContent = '约 ' + hlsSizeRange.value + ' MB';
        });

        // 视频编解码器联动：copy 模式下禁用部分设置
        const videoCodecSel = $('#videoCodec');
        videoCodecSel.addEventListener('change', () => {
            const isCopy = videoCodecSel.value === 'copy';
            crfRange.disabled = isCopy;
            $('#preset').disabled = isCopy;
            $('#videoBitrate').disabled = isCopy;
            $('#resolution').disabled = isCopy;
            $('#framerate').disabled = isCopy;

            updateVideoEncoderOptions(videoCodecSel.value);
            checkPresetModified();
        });

        // Initialize display
        updateVideoEncoderOptions(videoCodecSel.value);

        // 音频编解码器联动：copy 模式下禁用采样率和码率
        const audioCodecSel = $('#audioCodec');
        audioCodecSel.addEventListener('change', () => {
            const isCopy = audioCodecSel.value === 'copy';
            $('#audioSampleRate').disabled = isCopy;
            $('#audioBitrate').disabled = isCopy;
        });

        // 监听所有设置项变化，检测预设是否被修改
        const settingInputs = document.querySelectorAll('.settings-card select:not(.preset-select), .settings-card input:not(.preset-name-input)');
        settingInputs.forEach(el => {
            el.addEventListener('change', checkPresetModified);
            el.addEventListener('input', checkPresetModified);
        });

        // 恢复默认设置
        const resetSettingsBtn = $('#resetSettingsBtn');
        if (resetSettingsBtn) {
            resetSettingsBtn.addEventListener('click', () => {
                const selects = document.querySelectorAll('.settings-card select');
                selects.forEach(sel => {
                    const defaultOpt = sel.querySelector('option[selected]');
                    if (defaultOpt) {
                        sel.value = defaultOpt.value;
                    } else if (sel.options.length > 0) {
                        sel.value = sel.options[0].value;
                    }
                    sel.dispatchEvent(new Event('change'));
                });

                const inputs = document.querySelectorAll('.settings-card input[type="range"], .settings-card input[type="text"]');
                inputs.forEach(inp => {
                    if (inp.id === 'presetNameInput') {
                        inp.value = '';
                        return;
                    }
                    const defaultVal = inp.getAttribute('value');
                    if (defaultVal !== null) {
                        inp.value = defaultVal;
                    } else {
                        inp.value = '';
                    }
                    inp.dispatchEvent(new Event('input'));
                });

                showToast('已恢复默认设置', 'info', true);
            });
        }

        // 自动关机选项的提示
        if (autoShutdownCb) {
            autoShutdownCb.addEventListener('change', () => {
                if (autoShutdownCb.checked) {
                    showToast('已开启自动关机与日志输出', 'info', true);
                } else {
                    showToast('已关闭自动关机与日志输出', 'info', true);
                }
            });
        }

        // 开始转换（使用 onclick 以便后续可动态切换为终止按钮）
        convertBtn.onclick = startConvert;
    }

    function getSettings() {
        return {
            videoCodec: $('#videoCodec').value,
            audioCodec: $('#audioCodec').value,
            resolution: $('#resolution').value,
            framerate: $('#framerate').value,
            preset: $('#preset').value,
            quality: parseInt(crfRange.value),
            hlsSegmentType: $('#hlsSegmentType').value,
            hlsSliceMode: hlsSliceMode.value,
            hlsTime: parseInt(hlsTimeRange.value),
            hlsSize: parseInt(hlsSizeRange.value),
            videoBitrate: $('#videoBitrate').value.trim(),
            audioBitrate: $('#audioBitrate').value,
            audioSampleRate: $('#audioSampleRate').value,
            appleCompatible: $('#appleCompatible') ? $('#appleCompatible').value === 'true' : true
        };
    }

    // ── 开始转换 ─────────────────────────────
    async function startConvert() {
        if (readyFiles.length === 0) {
            showToast('请先选择或上传视频文件', 'error');
            return;
        }

        convertBtn.disabled = true;
        convertBtn.className = 'btn btn-primary';

        // 播放提交音效
        submitAudio.currentTime = 0;
        submitAudio.play().catch(e => console.log('Audio error:', e));
        const currentSettings = getSettings();
        const filesToProcess = [...readyFiles];

        readyFiles = [];
        renderReadyFilesState();
        fileInput.value = '';

        let startedCount = 0;
        for (const f of filesToProcess) {
            // 确定此任务使用的设置：有预设用预设，否则用当前面板设置
            let taskSettings;
            let actualPresetName = '面板设置';
            if (f.presetName && f.presetName !== '__current__' && presetsCache[f.presetName]) {
                taskSettings = { ...presetsCache[f.presetName] };
                actualPresetName = f.presetName;
            } else {
                taskSettings = currentSettings;
            }
            // 使用任务独有的前缀设置
            taskSettings.segmentPrefix = f.segmentPrefix || '';

            try {
                const res = await fetch('/api/convert', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        filename: f.filename,
                        originalname: f.originalname,
                        settings: taskSettings,
                        presetName: actualPresetName
                    })
                });

                const data = await res.json();
                if (res.ok) {
                    startedCount++;
                    // 记录已完成任务的文件信息以便 reconvert
                    completedTaskFiles[data.taskId] = {
                        filename: f.filename,
                        originalname: f.originalname
                    };
                    const el = document.getElementById(`task-${f.tempId}`);
                    if (el) {
                        el.id = `task-${data.taskId}`;
                    }
                    startPolling(data.taskId);
                } else {
                    showToast(data.error || `启动 ${f.originalname} 失败`, 'error');
                    const el = document.getElementById(`task-${f.tempId}`);
                    if (el) {
                        const badge = el.querySelector('.task-badge');
                        if (badge) {
                            badge.textContent = '失败';
                            badge.className = 'task-badge error';
                        }
                    }
                }
            } catch (err) {
                showToast(`请求 ${f.originalname} 失败: ` + err.message, 'error');
            }
        }
        if (startedCount > 0) {
            showToast(`已将 ${startedCount} 个任务加入队列！`, 'success');
            isConvertingBatch = true;
            renderReadyFilesState(); // 切换为终止按钮
            // 处理瞬间完成的情况
            if (Object.keys(pollingTimers).length === 0) {
                isConvertingBatch = false;
                await revertSkippedToReady();
                renderReadyFilesState();
                checkAfterAllDone();
            }
        }
    }

    // ── 检查自动关机 ─────────────────────────
    function checkAfterAllDone() {
        if (!autoShutdownCb || !autoShutdownCb.checked) return;

        showToast('所有转换任务已完成，即将自动关机...', 'warning', true);

        fetch('/api/shutdown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outputLog: autoShutdownCb.checked })
        })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    showShutdownModal();
                } else {
                    showToast(data.error || '执行关机失败', 'error');
                }
            })
            .catch(err => {
                showToast('发出关机指令失败: ' + err.message, 'error');
            });
    }

    // ── 关机弹窗 ─────────────────────────
    function showShutdownModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        let countdown = 20;
        let timer = null;

        overlay.innerHTML = `
            <div class="modal" style="text-align: center; max-width: 400px;">
                <h2 style="margin-top: 0; color: #ff4d4f;">即将关机</h2>
                <p style="font-size: 1.2rem; margin: 20px 0;">系统将在 <strong id="shutdownCountdown" style="font-size: 1.5rem; color: #ff4d4f;">${countdown}</strong> 秒后自动关机</p>
                <div style="display: flex; gap: 15px; justify-content: center; margin-top: 30px;">
                    <button id="cancelShutdownBtn" class="btn btn-primary" style="flex: 1; background-color: var(--border); color: var(--text); border-color: var(--border);">取消关机</button>
                    <button id="closeShutdownModalBtn" class="btn btn-primary" style="flex: 1;">我知道了</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const countdownEl = overlay.querySelector('#shutdownCountdown');
        const cancelBtn = overlay.querySelector('#cancelShutdownBtn');
        const closeBtn = overlay.querySelector('#closeShutdownModalBtn');

        timer = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            if (countdown <= 0) {
                clearInterval(timer);
                // 尝试关闭页面
                try {
                    window.close();
                } catch (e) { }
            }
        }, 1000);

        cancelBtn.addEventListener('click', () => {
            clearInterval(timer);
            fetch('/api/cancel-shutdown', { method: 'POST' })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        showToast('已取消自动关机', 'info');
                    } else {
                        showToast(data.error || '取消关机失败', 'error');
                    }
                })
                .catch(() => showToast('取消关机请求失败', 'error'));
            overlay.remove();
        });

        closeBtn.addEventListener('click', () => {
            // 仅仅关闭弹窗提示
            overlay.remove();
        });
    }

    // ── 任务轮询 ─────────────────────────────
    function startPolling(taskId) {
        if (pollingTimers[taskId]) return;

        // 先开启定时器，这样 fetchProgress 内部如果查到终态可以正确 clearInterval
        pollingTimers[taskId] = setInterval(() => fetchProgress(taskId), 2000);

        // 立即获取一次，确保状态秒变
        fetchProgress(taskId);
    }

    async function fetchProgress(taskId) {
        try {
            const res = await fetch(`/api/progress/${taskId}`);
            const task = await res.json();

            // 保存文件信息以便 reconvert
            if (task.sourceFile) {
                completedTaskFiles[taskId] = {
                    filename: task.sourceFile,
                    originalname: task.filename
                };
            }

            renderTask(task);

            if (task.status === 'done' || task.status === 'error' || task.status === 'skipped') {
                clearInterval(pollingTimers[taskId]);
                delete pollingTimers[taskId];

                if (task.status === 'skipped') {
                    // skipped 任务不需要 toast
                } else if (task.status === 'done') {
                    showToast(`"${task.filename}" 转换完成！`, 'success');
                } else {
                    showToast(`"${task.filename}" 转换失败`, 'error');
                }

                if (isConvertingBatch && Object.keys(pollingTimers).length === 0) {
                    isConvertingBatch = false;
                    await revertSkippedToReady();
                    renderReadyFilesState(); // 恢复正常按钮
                    checkAfterAllDone();
                }
            }
        } catch {
            // 网络错误，忽略
        }
    }

    // ── 将跳过的任务恢复为待转换 ─────────────
    async function revertSkippedToReady() {
        try {
            const res = await fetch('/api/tasks');
            const allTasks = await res.json();
            const skippedTasks = allTasks.filter(t => t.status === 'skipped');

            for (const task of skippedTasks) {
                const fileInfo = completedTaskFiles[task.id];
                if (!fileInfo) continue;

                // 删除服务端旧任务记录
                await fetch(`/api/task/${task.id}`, { method: 'DELETE' });

                // 重新加入待转换列表
                const tempId = 'ready_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
                readyFiles.push({
                    filename: fileInfo.filename,
                    originalname: fileInfo.originalname,
                    size: 0,
                    tempId: tempId,
                    presetName: '__current__',
                    segmentPrefix: ''
                });

                const el = document.getElementById(`task-${task.id}`);
                if (el) {
                    updateTaskCount(-1); // 旧任务移除减1，renderTask 新建会加1
                    el.remove();
                }

                renderTask({
                    id: tempId,
                    filename: fileInfo.originalname,
                    status: 'ready',
                    progress: 0,
                    elapsed: 0
                });
            }
        } catch (e) {
            // 忽略
        }
    }

    // ── 加载已有任务 ─────────────────────────
    async function loadTasks() {
        try {
            const res = await fetch('/api/tasks');
            const tasks = await res.json();

            if (tasks.length > 0) {
                emptyState.classList.add('hidden');
                tasks.forEach(task => {
                    // 保存文件信息以便 reconvert
                    if (task.sourceFile) {
                        completedTaskFiles[task.id] = {
                            filename: task.sourceFile,
                            originalname: task.filename
                        };
                    }
                    renderTask(task);
                    if (task.status === 'converting') {
                        startPolling(task.id);
                    }
                });
            }
            taskCount.textContent = tasks.length;
        } catch {
            // 忽略
        }
    }

    // ── 渲染任务 ─────────────────────────────
    function renderTask(task) {
        emptyState.classList.add('hidden');

        let el = document.getElementById(`task-${task.id}`);
        if (!el) {
            el = document.createElement('div');
            el.id = `task-${task.id}`;
            el.className = 'task-item';
            tasksList.appendChild(el);
            updateTaskCount(1);
        }

        const statusLabels = {
            ready: '待转换',
            pending: '排队中',
            skipped: '已跳过',
            converting: '转换中',
            done: '已完成',
            error: '失败'
        };

        const elapsed = formatDuration(task.elapsed || 0);
        const progressClass = task.status === 'done' ? 'done' : task.status === 'error' ? 'error' : (task.status === 'pending' || task.status === 'ready') ? 'pending' : '';

        // 为 ready 状态任务构建预设选择器
        let presetSelectorHtml = '';
        if (task.status === 'ready') {
            const readyFile = readyFiles.find(f => f.tempId === task.id);
            const currentPreset = readyFile ? (readyFile.presetName || '__current__') : '__current__';
            const currentPrefix = readyFile ? (readyFile.segmentPrefix || '') : '';
            const names = getPresetNames();
            let optionsHtml = `<option value="__current__" ${currentPreset === '__current__' ? 'selected' : ''}>当前面板设置</option>`;
            names.forEach(name => {
                optionsHtml += `<option value="${escapeHtml(name)}" ${currentPreset === name ? 'selected' : ''}>${escapeHtml(name)}</option>`;
            });
            presetSelectorHtml = `
                <div class="task-preset-row" style="display: flex; gap: 10px;">
                    <div style="flex: 1; display: flex; align-items: center;">
                        <span class="task-preset-label">预设:</span>
                        <select class="task-preset-select" onchange="App.changeTaskPreset('${task.id}', this.value)" style="flex: 1;">
                            ${optionsHtml}
                        </select>
                    </div>
                    <div style="flex: 1; display: flex; align-items: center;">
                        <span class="task-preset-label" style="white-space: nowrap; margin-right: 5px;">前缀:</span>
                        <input type="text" class="setting-input" style="margin: 0; padding: 4px 8px; font-size: 0.9rem;" placeholder="留空随机" value="${escapeHtml(currentPrefix)}" oninput="App.changeTaskPrefix('${task.id}', this.value)">
                    </div>
                </div>
            `;
        }

        const canToggleSkip = isConvertingBatch && (task.status === 'pending' || task.status === 'skipped');
        el.innerHTML = `
            <div class="task-header" style="align-items: center;">
                <div style="display: flex; flex-direction: row; align-items: center; gap: 0.6rem; max-width: 60%; flex: 1; overflow: hidden;">
                    <span class="task-badge ${task.status}${canToggleSkip ? ' clickable' : ''}" style="flex-shrink: 0;${canToggleSkip ? ' cursor: pointer;' : ''}" ${canToggleSkip && task.status === 'pending' ? 'title="点击跳过此任务" onclick="App.toggleSkipTask(\'' + task.id + '\')"' : ''} ${canToggleSkip && task.status === 'skipped' ? 'title="点击恢复排队" onclick="App.toggleSkipTask(\'' + task.id + '\')"' : ''}>${statusLabels[task.status] || task.status}</span>
                    <span class="task-name" title="${escapeHtml(task.filename)}" style="max-width: 100%;">${escapeHtml(task.filename)}</span>
                </div>
                ${task.status === 'done' || task.status === 'error' || task.status === 'ready' ? `
                    <div class="task-actions" style="margin-top: 0; flex-shrink: 0;">
                        ${task.status === 'ready' ? `
                            <button class="task-btn duplicate" onclick="App.duplicateReadyTask('${task.id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
                                复制
                            </button>
                        ` : ''}
                        ${task.status === 'done' ? `
                            <button class="task-btn" onclick="App.viewFiles('${task.id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                查看文件
                            </button>
                            <button class="task-btn reconvert" onclick="App.reconvert('${task.id}')">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"></path></svg>
                                再次转换
                            </button>
                        ` : ''}
                        <button class="task-btn ${task.status === 'ready' ? 'danger' : 'warning'}" onclick="App.deleteTask('${task.id}')" ${task.status !== 'ready' ? 'title="仅删除记录，不删除文件"' : ''}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path></svg>
                            ${task.status === 'ready' ? '移除' : '清除'}
                        </button>
                    </div>
                ` : ''}
            </div>
            ${presetSelectorHtml}
            ${task.status !== 'ready' ? `
            <div class="task-progress">
                <div class="progress-bar">
                    <div class="progress-fill ${progressClass}" style="width:${task.progress || 0}%"></div>
                </div>
            </div>
            <div class="task-meta" style="gap: 10px;">
                <span title="任务ID: ${task.id}">ID: ${task.id}</span>
                <span style="flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; ${task.command ? 'cursor: pointer;' : ''}" title="${task.command ? '点击复制命令:\n' + escapeHtml(task.command) : '参数: ' + escapeHtml(task.presetName || '面板设置')}" data-cmd="${escapeHtml(task.command || '')}" ${task.command ? 'onclick="App.copyTaskCommand(this)"' : ''}>参数: ${escapeHtml(task.presetName || '面板设置')}</span>
                <span style="white-space: nowrap;">耗时 ${elapsed}</span>
                <span style="font-weight: 500;">${task.progress || 0}%</span>
            </div>
            ` : ''}
            ${task.error ? `
            <div class="task-error-container" style="margin-top: 5px; background: rgba(255,59,48,0.05); border: 1px solid rgba(255,59,48,0.2); border-radius: 4px; padding: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div class="task-error" style="flex: 1; margin: 0; padding: 0; background: transparent; color: #ff3b30; white-space: pre-wrap; font-size: 0.85rem; overflow-x: auto; border: none;">${escapeHtml(task.error)}</div>
                    <button class="task-btn" onclick="App.copyErrorText(this)" style="flex-shrink: 0; padding: 4px 8px; font-size: 0.8rem; background: var(--bg-hover, #f5f5f5); border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; display: flex; align-items: center;" title="一键复制报错信息">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
                        <span>复制报错</span>
                    </button>
                </div>
            </div>` : ''}
        `;
    }

    // 修改任务的预设选择
    function changeTaskPreset(taskId, presetName) {
        const f = readyFiles.find(rf => rf.tempId === taskId);
        if (f) {
            f.presetName = presetName;
        }
    }

    // 修改任务的分片前缀
    function changeTaskPrefix(taskId, prefix) {
        const f = readyFiles.find(rf => rf.tempId === taskId);
        if (f) {
            f.segmentPrefix = prefix;
        }
    }

    // 再次转换：把已完成任务的文件重新加入待转换列表
    function reconvert(taskId) {
        const fileInfo = completedTaskFiles[taskId];
        if (!fileInfo) {
            showToast('找不到该任务的文件信息', 'error');
            return;
        }

        const tempId = 'ready_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        readyFiles.push({
            filename: fileInfo.filename,
            originalname: fileInfo.originalname,
            size: 0,
            tempId: tempId,
            presetName: '__current__',
            segmentPrefix: ''
        });

        renderReadyFilesState();
        renderTask({
            id: tempId,
            filename: fileInfo.originalname,
            status: 'ready',
            progress: 0,
            elapsed: 0
        });
        showToast(`"${fileInfo.originalname}" 已加入待转换列表，可选择预设后转换`, 'info');
    }

    // 复制待转换任务
    function duplicateReadyTask(taskId) {
        const source = readyFiles.find(f => f.tempId === taskId);
        if (!source) {
            showToast('找不到该任务信息', 'error');
            return;
        }

        const tempId = 'ready_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
        readyFiles.push({
            filename: source.filename,
            originalname: source.originalname,
            size: source.size,
            tempId: tempId,
            presetName: source.presetName || '__current__',
            segmentPrefix: ''
        });

        renderReadyFilesState();
        renderTask({
            id: tempId,
            filename: source.originalname,
            status: 'ready',
            progress: 0,
            elapsed: 0
        });
        showToast(`已复制「${source.originalname}」，可选择不同预设`, 'info');
    }

    function updateTaskCount(delta) {
        const current = parseInt(taskCount.textContent) || 0;
        taskCount.textContent = current + delta;
    }

    // ── 查看输出文件 ─────────────────────────
    async function viewFiles(taskId) {
        try {
            const res = await fetch(`/api/output/${taskId}`);
            const data = await res.json();

            const overlay = document.createElement('div');
            overlay.className = 'modal-overlay';
            overlay.onclick = (e) => {
                if (e.target === overlay) overlay.remove();
            };

            const fileListHTML = data.files.map(f => `
                <div class="file-item">
                    <span class="file-item-name">${escapeHtml(f.name)}</span>
                    <span class="file-item-size">${formatSize(f.size)}</span>
                </div>
            `).join('');

            const totalSize = data.files.reduce((acc, f) => acc + (f.size || 0), 0);
            overlay.innerHTML = `
                <div class="modal">
                    <div class="modal-header">
                        <span class="modal-title">输出文件 (${data.files.length} 个)</span>
                        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                    <p class="output-path-label">📁 输出目录：</p>
                    <div class="output-path clickable" data-path="${escapeHtml(data.outputDir)}" onclick="App.openFolder(this.getAttribute('data-path'))" title="点击在资源管理器中打开此文件夹">${escapeHtml(data.outputDir)}</div>
                    <div class="output-path-label" style="margin-top: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <span>📄 文件列表：</span>
                        <span style="font-weight: normal; opacity: 0.8;">文件大小：${formatSize(totalSize)}（共计 ${data.files.length} 个文件）</span>
                    </div>
                    <div class="file-list">${fileListHTML}</div>
                </div>
            `;

            document.body.appendChild(overlay);
        } catch {
            showToast('获取文件列表失败', 'error');
        }
    }

    // ── 删除任务 ─────────────────────────────
    async function deleteTask(taskId) {
        if (taskId.startsWith('ready_')) {
            showConfirm('确定要从待转换列表中移除此视频吗？', () => {
                readyFiles = readyFiles.filter(f => f.tempId !== taskId);
                renderReadyFilesState();

                const el = document.getElementById(`task-${taskId}`);
                if (el) {
                    el.style.animation = 'toastOut 0.3s ease forwards';
                    setTimeout(() => {
                        el.remove();
                        updateTaskCount(-1);
                        if (tasksList.querySelectorAll('.task-item').length === 0) {
                            emptyState.classList.remove('hidden');
                        }
                    }, 300);
                }
            });
            return;
        }

        try {
            await fetch(`/api/task/${taskId}`, { method: 'DELETE' });
            const el = document.getElementById(`task-${taskId}`);
            if (el) {
                el.style.animation = 'toastOut 0.3s ease forwards';
                setTimeout(() => {
                    el.remove();
                    updateTaskCount(-1);
                    if (tasksList.querySelectorAll('.task-item').length === 0) {
                        emptyState.classList.remove('hidden');
                    }
                }, 300);
            }
            if (pollingTimers[taskId]) {
                clearInterval(pollingTimers[taskId]);
                delete pollingTimers[taskId];
            }
            showToast('记录已清除', 'info');
        } catch {
            showToast('清除失败', 'error');
        }
    }

    // ── Toast 通知 ───────────────────────────
    function showToast(message, type = 'info', playAudio = true) {
        const container = $('#toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
            error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
            info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
        };

        toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);

        // 播放提示音
        if (playAudio) {
            let audioToPlay = null;
            if (type === 'error') {
                audioToPlay = errorAudio;
            } else if (message.includes('转换完成') || message.includes('即将自动关机')) {
                audioToPlay = completedAudio;
            } else {
                // success, warning, info 默认都使用 normalAudio
                audioToPlay = normalAudio;
            }

            if (audioToPlay) {
                audioToPlay.currentTime = 0;
                audioToPlay.play().catch(() => {
                    // 如果被拦截，确保在下次交互时播放（如果尚未解锁）
                    if (!audioUnlocked) {
                        const playOnce = () => {
                            audioToPlay.play().catch(() => { });
                            document.removeEventListener('mousedown', playOnce);
                        };
                        document.addEventListener('mousedown', playOnce, { once: true });
                    }
                });
            }
        }

        setTimeout(() => {
            toast.style.animation = 'toastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ── 工具函数 ─────────────────────────────
    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
    }

    function formatDuration(ms) {
        const totalSec = Math.floor(ms / 1000);
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        if (min > 0) return `${min}分${sec}秒`;
        return `${sec}秒`;
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function openFolder(folderPath) {
        try {
            const res = await fetch('/api/open-folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderPath })
            });
            const data = await res.json();
            if (!data.success) {
                showToast(data.error || '无法打开目录', 'error');
            }
        } catch {
            showToast('请求失败', 'error');
        }
    }

    // ── 通用确认弹窗 ────────────────────────
    function showConfirm(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay confirm-overlay';
        overlay.style.zIndex = '3000'; // 置于最顶层

        overlay.innerHTML = `
            <div class="modal confirm-modal" style="max-width: 400px; padding: 1.5rem;">
                <div style="display: flex; gap: 1rem; align-items: flex-start; margin-bottom: 1.5rem;">
                    <div style="background: rgba(245, 158, 11, 0.1); border-radius: 50%; padding: 10px; flex-shrink: 0;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" width="24" height="24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                    </div>
                    <div>
                        <h4 style="margin: 0 0 0.5rem 0; font-size: 1.1rem; color: var(--text-primary);">确认操作</h4>
                        <p style="margin: 0; font-size: 0.95rem; color: var(--text-secondary); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(message)}</p>
                    </div>
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button class="btn btn-secondary cancel-btn" style="width: auto; margin: 0; padding: 0.5rem 1.2rem;">取消</button>
                    <button class="btn btn-primary ok-btn" style="width: auto; margin: 0; padding: 0.5rem 1.5rem; background: var(--warning); border-color: var(--warning);">确定</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();
        overlay.querySelector('.cancel-btn').onclick = close;
        overlay.querySelector('.ok-btn').onclick = () => {
            // 播放提交音效
            if (submitAudio) {
                submitAudio.currentTime = 0;
                submitAudio.play().catch(() => { });
            }
            close();
            onConfirm();
        };
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };
    }

    // ── 终止所有转换 ────────────────────────
    async function abortAll() {
        showConfirm('确定要终止所有正在进行和排队中的转换任务吗？\n\n已完成的任务不受影响。', async () => {
            try {
                const res = await fetch('/api/abort-all', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    // 清除所有轮询
                    for (const tid in pollingTimers) {
                        clearInterval(pollingTimers[tid]);
                        delete pollingTimers[tid];
                    }
                    isConvertingBatch = false;
                    renderReadyFilesState();
                    showToast('已终止所有转换任务', 'info');

                    // 刷新所有任务状态
                    const tasksRes = await fetch('/api/tasks');
                    const tasks = await tasksRes.json();
                    tasks.forEach(task => renderTask(task));
                } else {
                    showToast(data.error || '终止失败', 'error');
                }
            } catch (err) {
                showToast('终止请求失败: ' + err.message, 'error');
            }
        });
    }

    // ── 切换任务跳过状态 ────────────────────────
    async function toggleSkipTask(taskId) {
        try {
            const res = await fetch(`/api/task/${taskId}/toggle-skip`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                // 重新获取并渲染该任务
                const progressRes = await fetch(`/api/progress/${taskId}`);
                const task = await progressRes.json();
                renderTask(task);
                showToast(data.status === 'skipped' ? '已跳过该任务' : '已恢复排队', 'info');

                // 从 skipped 恢复为 pending 时，重新启动轮询
                if (data.status === 'pending' && !pollingTimers[taskId]) {
                    startPolling(taskId);
                }
            } else {
                showToast(data.error || '操作失败', 'error');
            }
        } catch (err) {
            showToast('操作失败: ' + err.message, 'error');
        }
    }

    // ── 清除已完成任务 ────────────────────────
    async function clearCompletedTasks() {
        const items = tasksList.querySelectorAll('.task-item');
        let cleared = 0;
        for (const el of items) {
            const badge = el.querySelector('.task-badge');
            if (!badge) continue;
            const status = badge.textContent.trim();
            if (status === '已完成' || status === '失败') {
                const taskId = el.id.replace('task-', '');
                try {
                    await fetch(`/api/task/${taskId}`, { method: 'DELETE' });
                } catch { /* 忽略 */ }
                if (pollingTimers[taskId]) {
                    clearInterval(pollingTimers[taskId]);
                    delete pollingTimers[taskId];
                }
                el.style.animation = 'toastOut 0.3s ease forwards';
                setTimeout(() => {
                    el.remove();
                    updateTaskCount(-1);
                    if (tasksList.querySelectorAll('.task-item').length === 0) {
                        emptyState.classList.remove('hidden');
                    }
                }, 300);
                cleared++;
            }
        }
        if (cleared > 0) {
            showToast(`已清除 ${cleared} 个已完成的任务记录`, 'info', true);
        } else {
            showToast('没有可清除的已完成任务', 'info', true);
        }
    }

    // ── 复制报错内容 ───────────────────────────
    function copyErrorText(btn) {
        // btn.previousElementSibling 是包含完整报错的 div.task-error
        const errorText = btn.previousElementSibling.textContent;
        navigator.clipboard.writeText(errorText).then(() => {
            const span = btn.querySelector('span');
            const svg = btn.querySelector('svg');
            const originalSpanHtml = span.innerHTML;
            const originalSvgHtml = svg.outerHTML;

            span.innerHTML = '已复制';
            svg.outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12" style="margin-right: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';

            setTimeout(() => {
                span.innerHTML = originalSpanHtml;
                btn.querySelector('svg').outerHTML = originalSvgHtml;
            }, 2000);
        }).catch(() => {
            showToast('复制失败，请手动选择复制', 'error');
        });
    }

    // ── 复制任务命令 ─────────────────────────
    function copyTaskCommand(btn) {
        const cmd = btn.getAttribute('data-cmd');
        if (!cmd) return;
        navigator.clipboard.writeText(cmd).then(() => {
            showToast('转换命令已复制到剪贴板', 'success');
        }).catch(() => {
            showToast('复制失败，请手动选择复制', 'error');
        });
    }

    // ── 暴露到全局 ───────────────────────────
    window.App = { viewFiles, deleteTask, openFolder, reconvert, changeTaskPreset, changeTaskPrefix, duplicateReadyTask, toggleSkipTask, clearCompletedTasks, copyErrorText, copyTaskCommand };

})();
