#!/bin/bash

# 清理所有 node_modules 文件夹的脚本 (Git Bash 版本)
# 使用方法: bash clean-node-modules.sh 或 ./clean-node-modules.sh

echo -e "\033[36m🧹 开始清理所有 node_modules 文件夹...\033[0m"

# 计数器
count=0
node_modules_list=()

# 获取所有 node_modules 文件夹
while IFS= read -r -d '' folder; do
    node_modules_list+=("$folder")
    ((count++))
done < <(find . -type d -name "node_modules" -print0)

if [ $count -eq 0 ]; then
    echo -e "\033[32m✅ 未发现 node_modules 文件夹\033[0m"
    exit 0
fi

echo -e "\033[33m📁 发现 $count 个 node_modules 文件夹:\033[0m"
for folder in "${node_modules_list[@]}"; do
    echo "  - $folder"
done

echo ""
read -p "确定要删除以上文件夹吗? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    deleted=0
    failed=0
    
    for folder in "${node_modules_list[@]}"; do
        echo -e "\033[33m删除中: $folder\033[0m"
        if rm -rf "$folder" 2>/dev/null; then
            echo -e "\033[32m✅ 已删除\033[0m"
            ((deleted++))
        else
            echo -e "\033[31m❌ 删除失败\033[0m"
            ((failed++))
        fi
    done
    
    echo ""
    echo -e "\033[32m🎉 清理完成! 删除: $deleted 个, 失败: $failed 个\033[0m"
    echo -e "\033[36m现在你可以运行 pnpm install 重新安装依赖\033[0m"
else
    echo -e "\033[33m取消清理\033[0m"
fi
