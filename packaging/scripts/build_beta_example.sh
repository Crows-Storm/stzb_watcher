#!/bin/bash
# Beta版本构建示例
# 根据实际情况修改IP和过期日期

echo "========================================"
echo "  Beta版本构建示例"
echo "========================================"
echo ""

# 示例1: IP限制 + 首次自动绑定设备 (推荐给熟人)
echo "示例1: 为熟人构建 (IP + 自动绑定设备)"
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-Friend.exe" \
  --no-build

echo ""
echo "========================================"
echo ""

# 示例2: IP + 设备双重验证，严格模式 (最严格)
echo "示例2: 严格模式 (需提前收集设备信息)"
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --device "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
  --expiry "2025-04-30" \
  --strict \
  --output "Observer-Beta-Strict.exe" \
  --no-build

echo ""
echo "========================================"
echo ""

# 示例3: 仅设备绑定 (IP经常变化的用户)
echo "示例3: 仅设备绑定 (用户IP不固定)"
python packaging/scripts/build_beta.py \
  --ip "0.0.0.0" \
  --no-ip-check \
  --expiry "2025-04-30" \
  --output "Observer-Beta-DeviceOnly.exe" \
  --no-build

echo ""
echo "========================================"
echo ""

# 示例4: 多IP支持 (同一用户有多个上网地点)
echo "示例4: 多IP支持"
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" "111.222.333.444" "99.88.77.66" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-MultiIP.exe" \
  --no-build

echo ""
echo "========================================"
echo "  以上为示例，未实际构建"
echo "  移除 --no-build 参数即可真正打包"
echo "========================================"
