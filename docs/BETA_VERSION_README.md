# Beta版本IP限制方案

## 🎯 方案概述

这是一个**多重验证**的Beta版本限制方案，用于防止软件传播和抄袭。

### 核心特性

✅ **IP白名单验证** - 只允许指定IP运行  
✅ **时间期限控制** - 设定过期日期  
✅ **设备指纹绑定** - 防止转发传播  
✅ **灵活的验证模式** - 宽松/严格模式可选  
✅ **自动化构建工具** - 一键生成授权版本  

## 🔒 工作原理

### 三重验证机制

```
启动程序
   ↓
检查时间是否过期
   ↓
检查IP是否在白名单
   ↓
检查设备指纹是否匹配
   ↓
全部通过 → 启动成功
任一失败 → 拒绝运行
```

### 验证模式

**宽松模式**（默认）:
- 时间验证：必须通过
- IP验证 OR 设备验证：任一通过即可

**严格模式**:
- 时间验证：必须通过
- IP验证 AND 设备验证：必须同时通过

## 📦 文件说明

### 核心文件

```
beta_license.py                              # 授权验证模块
run_web_exe.py                               # 启动入口（已集成验证）
packaging/scripts/build_beta.py              # Beta版本构建脚本
packaging/scripts/collect_device_info.py     # 设备信息收集工具
docs/BETA_BUILD_GUIDE.md                     # 详细构建指南
```

## 🚀 快速开始

### 步骤1: 收集用户信息（可选）

让测试用户运行：
```bash
python packaging/scripts/collect_device_info.py
```

他们会得到：
```
设备指纹: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
公网IP:   123.456.789.012
```

### 步骤2: 构建授权版本

```bash
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-User1.exe"
```

### 步骤3: 分发给用户

将生成的文件发给用户：
- `Observer-Beta-User1.exe` - 主程序
- `Observer-Beta-User1-README.txt` - 使用说明

## 💡 使用场景

### 场景1：熟人测试（简单模式）

```bash
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-Friend.exe"
```

**特点**：
- 仅IP验证 + 时间限制
- 首次运行自动绑定设备
- 适合可信任的用户

### 场景2：公开测试（严格模式）

```bash
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --device "e3b0c442..." \
  --expiry "2025-04-30" \
  --strict \
  --output "Observer-Beta-Public.exe"
```

**特点**：
- IP + 设备双重验证
- 严格模式（必须同时通过）
- 最大程度防止传播

### 场景3：IP不固定的用户

```bash
python packaging/scripts/build_beta.py \
  --ip "0.0.0.0" \
  --no-ip-check \
  --expiry "2025-04-30" \
  --output "Observer-Beta-Mobile.exe"
```

**特点**：
- 仅设备绑定 + 时间限制
- 不限制IP
- 适合移动网络用户

## 🛡️ 安全性评估

### ✅ 可以防护

| 场景 | 效果 |
|------|------|
| 直接转发exe给他人 | ✅ 有效防护（设备指纹不匹配） |
| 在其他电脑运行 | ✅ 有效防护（IP或设备验证失败） |
| 过期后继续使用 | ✅ 有效防护（时间验证失败） |
| 普通用户破解 | ✅ 有效防护（门槛较高） |

### ⚠️ 局限性

| 场景 | 说明 |
|------|------|
| 专业逆向工程 | ❌ 客户端验证理论上都能破解 |
| 修改系统时间 | ⚠️ 可绕过时间验证（可通过联网时间验证缓解） |
| 虚拟机/代理 | ⚠️ 可能绕过IP验证 |

### 💭 现实考量

对于Python打包的exe来说：
- **普通用户（95%）**：完全无法绕过，有效防止传播
- **懂技术的用户（4%）**：有一定门槛，但可以破解
- **专业破解者（1%）**：必然可以破解

**建议策略**：
1. Beta测试期使用此方案，主要防止普通用户传播
2. 正式版本考虑更强的保护（如在线授权服务器）
3. 或者接受现实：优质产品 + 合理定价 > 技术防护

## 📊 方案对比

### 与其他方案的对比

| 方案 | 实现难度 | 防护效果 | 用户体验 | 推荐度 |
|------|---------|---------|---------|--------|
| 仅时间限制 | ⭐ 简单 | ⭐⭐ 低 | ⭐⭐⭐⭐⭐ 好 | ⭐⭐⭐ |
| IP + 时间限制 | ⭐⭐ 中等 | ⭐⭐⭐ 中等 | ⭐⭐⭐ 中等 | ⭐⭐⭐⭐ |
| **本方案**（多重验证） | ⭐⭐⭐ 中等 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐⭐ 好 | ⭐⭐⭐⭐⭐ |
| 在线服务器验证 | ⭐⭐⭐⭐ 高 | ⭐⭐⭐⭐⭐ 很高 | ⭐⭐ 差 | ⭐⭐⭐⭐ |

## 🔧 高级配置

### 手动修改 beta_license.py

如果需要手动调整，直接编辑配置区：

```python
# ==================== 配置区 ====================

# Beta过期时间戳
BETA_EXPIRY_TIMESTAMP = 1738335599  # 2025-01-31 23:59:59

# 授权IP白名单
ALLOWED_IPS = [
    "123.456.789.012",
    "111.222.333.444",
]

# 授权设备指纹
ALLOWED_DEVICE_FINGERPRINTS = [
    # 留空 = 首次运行自动绑定
]

# 验证开关
ENABLE_IP_CHECK = True      # IP验证
ENABLE_DEVICE_CHECK = True  # 设备验证
STRICT_MODE = False         # 严格模式
```

### 时间戳转换

Python脚本：
```python
from datetime import datetime
dt = datetime.strptime("2025-04-30 23:59:59", "%Y-%m-%d %H:%M:%S")
print(int(dt.timestamp()))
```

在线工具：https://tool.lu/timestamp/

## 📝 常见问题

### Q: 用户的IP变了怎么办？
**A:** 三种方案：
1. 构建时添加多个IP
2. 使用宽松模式（默认）
3. 禁用IP验证 `--no-ip-check`

### Q: 如何为多个用户构建？
**A:** 每个用户单独构建一个exe：
```bash
# 用户1
python build_beta.py --ip "IP1" --expiry "2025-04-30" --output "User1.exe"

# 用户2
python build_beta.py --ip "IP2" --expiry "2025-04-30" --output "User2.exe"
```

### Q: 可以统一修改所有已分发版本的过期时间吗？
**A:** 不可以，授权信息编译在exe中。需要：
1. 重新构建新版本
2. 通知用户更新

### Q: 如何完全禁用授权验证（恢复正常版本）？
**A:** 删除或重命名 `beta_license.py`，`run_web_exe.py` 会自动跳过验证。

## 🎓 最佳实践

### 给熟人测试
```bash
# 简单快速，首次自动绑定设备
python build_beta.py \
  --ip "USER_IP" \
  --expiry "2025-04-30" \
  --output "Beta-Friend.exe"
```

### 给陌生人测试（担心传播）
```bash
# 严格验证，提前收集设备信息
python collect_device_info.py  # 让用户先运行这个
python build_beta.py \
  --ip "USER_IP" \
  --device "USER_FINGERPRINT" \
  --expiry "2025-04-30" \
  --strict \
  --output "Beta-Tester.exe"
```

### 测试期一个赛季（3个月）
```bash
# 假设今天是 2025-02-01，一个赛季到 2025-05-01
python build_beta.py \
  --ip "USER_IP" \
  --expiry "2025-05-01" \
  --output "Beta-Season.exe"
```

## 📞 技术支持

遇到问题？

1. 查看详细文档：`docs/BETA_BUILD_GUIDE.md`
2. 测试授权模块：`python beta_license.py --device-info`
3. QQ群反馈：1063894809

## 🚦 下一步

1. ✅ 阅读 `docs/BETA_BUILD_GUIDE.md` 了解详细用法
2. ✅ 运行 `python beta_license.py --device-info` 查看你的设备信息
3. ✅ 使用 `build_beta.py` 构建第一个测试版本
4. ✅ 在自己电脑上测试验证流程
5. ✅ 分发给测试用户

---

**祝你的Beta测试顺利！** 🎉
