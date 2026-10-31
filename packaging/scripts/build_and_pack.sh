#!/bin/bash
# 赠予版一键构建和打包脚本
# 用法: ./build_and_pack.sh "123.456.789.012" "UserName" "2027-04-30"

set -e  # 遇到错误立即退出

echo "========================================"
echo "  赠予版一键构建和打包"
echo "========================================"
echo ""

# 检查参数
if [ $# -lt 3 ]; then
    echo "用法: $0 <用户IP> <用户名称> <过期日期>"
    echo ""
    echo "示例:"
    echo "  $0 \"123.456.789.012\" \"Friend1\" \"2027-04-30\""
    echo "  $0 \"123.456.789.012\" \"Tester1\" \"2027-04-30\""
    echo ""
    exit 1
fi

USER_IP="$1"
USER_NAME="$2"
EXPIRY_DATE="$3"

echo "📋 构建配置:"
echo "   用户IP: $USER_IP"
echo "   用户名称: $USER_NAME"
echo "   过期日期: $EXPIRY_DATE"
echo ""

# 步骤1: 构建授权版本
echo "========================================"
echo "步骤 1/2: 构建授权版本"
echo "========================================"

python packaging/scripts/build_beta.py \
    --ip "$USER_IP" \
    --expiry "$EXPIRY_DATE" \
    --output "Observer-赠予版-${USER_NAME}.exe"

echo ""

# 步骤2: 打包压缩包
echo "========================================"
echo "步骤 2/2: 打包压缩包"
echo "========================================"

python packaging/scripts/pack_release.py \
    --exe "dist/Observer-赠予版-${USER_NAME}.exe" \
    --user "$USER_NAME"

echo ""
echo "========================================"
echo "  ✅ 全部完成！"
echo "========================================"
echo ""
echo "📦 发布包位置: releases/Observer-赠予版-${USER_NAME}-*.zip"
echo ""
echo "📤 下一步："
echo "   1. 将压缩包发送给用户"
echo "   2. 提醒用户查看使用手册"
echo "   3. 告知有效期至 $EXPIRY_DATE"
echo ""
