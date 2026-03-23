const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

let rcedit;

const baseDir = __dirname;
const iconPath = path.join(baseDir, 'videoqptool.ico');
const globalCacheDir = path.join(os.homedir(), '.pkg-cache');
const localCacheDir = path.join(baseDir, '.pkg-cache');

async function build() {
    console.log('🚀 准备打包 exe...');
    try {
        // 动态导入 rcedit 模块
        try {
            const rceditModule = await import('rcedit');
            rcedit = rceditModule.rcedit || rceditModule.default || rceditModule;
            if (typeof rcedit !== 'function') {
                console.error('❌ rcedit 不是一个函数:', typeof rcedit);
                console.log('⚠️ 将退回无图标模式编译...');
                execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
                return;
            }
        } catch (importErr) {
            console.error('❌ 导入 rcedit 模块失败:', importErr);
            console.log('⚠️ 将退回无图标模式编译...');
            execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
            return;
        }
        const pkgInfo = require('./package.json');
        const outputExeName = `VideoQPTool-v${pkgInfo.version}.exe`;
        const outputExePath = `dist/${outputExeName}`;
        
        if (!fs.existsSync(iconPath)) {
            console.warn(`⚠️ 未找到自定义图标 ${iconPath}，将使用 Node 默认图标打包！`);
            console.log('✅ 直接执行 pkg...');
            execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
            console.log('🎉 打包完成！');
            return;
        }

        console.log('✨ 正在为 exe 准备自定义图标...');

        // 【关键修复点】：我们需要截断 pkg 原本的打包混入流程。
        // 因为 rcedit 会修改 PE(可执行文件) 的 Header 结构。
        // 如果在打包结束之后才去使用 rcedit 修改 exe，就会导致 pkg 附加挂载的业务代码数据段发生结构损坏，最终运行就会一闪而过且包异常错误！
        // 正确解法：在 pkg 所引用的基础可执行环境 (node win-base) 上做修改重签，然后再让 pkg 去混入它的内容，这样数据段就不会被截断。

        // 1. 先探测是否有基础资源，如果没有，说明是第一次运行 pkg，触发它自己下载一遍。
        // pkg 会默认保存包体到 ~/.pkg-cache 目录下
        if (!fs.existsSync(globalCacheDir)) {
            console.log('🔧 正在检查/拉取 Node 基础构建资源，请稍等...');
            execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
        }

        // 2. 找到我们刚确切拉取的基础环境版本文件名
        let cacheVersionDir = '';
        let targetExeName = '';

        if (fs.existsSync(globalCacheDir)) {
            const versions = fs.readdirSync(globalCacheDir).filter(dir => dir.startsWith('v'));
            for (const ver of versions) {
                const verPath = path.join(globalCacheDir, ver);
                if (fs.statSync(verPath).isDirectory()) {
                    const files = fs.readdirSync(verPath);
                    // 我们只需找名为 fetched-vxx-win-x64 的基础打包资源
                    const winExe = files.find(f => f.includes('win-x64') && f.startsWith('fetched'));
                    if (winExe) {
                        cacheVersionDir = ver;
                        targetExeName = winExe;
                        break;
                    }
                }
            }
        }

        if (!cacheVersionDir || !targetExeName) {
            console.warn('⚠️ 核心基础环境缓存寻找失败，可能 pkg 目录结构有变，回退到默认无图标打包模式。');
            execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
            return;
        }

        const globalExePath = path.join(globalCacheDir, cacheVersionDir, targetExeName);
        const myCacheVersionDir = path.join(localCacheDir, cacheVersionDir);

        // 【关键修复】：将 'fetched-' 前缀改为 'built-'，这是为了欺骗 pkg 的缓存检测
        // 如果文件名为 fetched-*，pkg 会强制校验文件哈希。既然我们用 rcedit 修改了文件，哈希值已变，
        // pkg 会认为文件损坏并重新下载原始 node node.js 图标的基础文件并覆盖掉！
        // 命名为 built-* 就能跳过哈希校验，让 pkg 直接直接使用我们修改后的基础环境。
        const builtExeName = targetExeName.replace('fetched-', 'built-');
        const localExePath = path.join(myCacheVersionDir, builtExeName);

        // 3. 将全局缓存拷贝出来存一份到项目自己的目录下（防止污染其他使用 pkg 的库项目全局环境）
        if (!fs.existsSync(myCacheVersionDir)) {
            fs.mkdirSync(myCacheVersionDir, { recursive: true });
        }
        console.log(`📦 将基础环境克隆到项目并进行图标替换 (${builtExeName}) ...`);
        fs.copyFileSync(globalExePath, localExePath);

        // 4. 对项目这个“纯血”未使用过的基础环境进行修改图标
        try {
            const pkgInfo = require('./package.json');
            console.log('📋 调试信息:');
            console.log('  - localExePath:', localExePath);
            console.log('  - iconPath:', iconPath);
            console.log('  - localExePath 存在:', fs.existsSync(localExePath));
            console.log('  - iconPath 存在:', fs.existsSync(iconPath));
            
            await rcedit(localExePath, {
                icon: iconPath,
                'file-version': pkgInfo.version,
                'product-version': pkgInfo.version,
                'version-string': {
                    CompanyName: 'hcllmsx',
                    FileDescription: 'VideoQPTool 视频转HLS工具',
                    ProductName: 'VideoQPTool',
                    LegalCopyright: 'Copyright © hcllmsx'
                }
            });
            console.log('✅ 已成功注入图标！');
        } catch (rceditErr) {
            console.error('❌ 在为基础环境注入图标时失败:', rceditErr);
            console.log('⚠️ 将退回无图标模式编译...');
            execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, { stdio: 'inherit' });
            return;
        }

        // 5. 使用 PKG_CACHE_PATH 环境变量覆盖，让 pkg 读取我们“已修饰过图标”的基础文件来混合你的 server 代码！
        console.log('✅ 开始带有图标的业务混入最终打包 (过程略久，请等待)...');
        execSync(`npx pkg . --targets node18-win-x64 --output ${outputExePath}`, {
            stdio: 'inherit',
            env: { ...process.env, PKG_CACHE_PATH: localCacheDir }
        });

        console.log('');
        console.log(`🎉🎉 带有全新图标的 exe 完美混淆构建成功！快回到桌面双击运行 ${outputExePath} 吧！🎉🎉`);

    } catch (err) {
        console.error('❌ 打包过程中出现整体级错误:', err);
    }
}

build();
