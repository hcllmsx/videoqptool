// 构建前同步版本号：以根目录 VERSION 文件为准，写入 package.json.version
// 这样 electron-builder 打包产物的文件名也会跟随 VERSION 文件
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (pkg.version !== version) {
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`版本号已同步为: ${version}`);
} else {
    console.log(`版本号一致: ${version}`);
}
