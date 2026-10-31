# Beta版本构建指南

## 📖 概述

本指南说明如何为测试用户构建带IP限制和时间限制的Beta版本。

## 🔒 限制机制

Beta版本包含三重限制：

1. **IP白名单验证** - 只允许指定IP地址使用
2. **时间限制** - 设定过期日期，到期自动失效
3. **设备指纹绑定** - 防止软件被转发传播

### 验证模式

- **宽松模式**（默认）：IP验证 OR 设备验证 通过即可
- **严格模式**：IP验证 AND 设备验证 必须同时通过

## 📋 构建流程

### 方式一：预先收集设备信息（推荐）

适合提前准备，生成最严格的授权版本。

#### 1. 让测试用户运行设备信息收集工具

```bash
python packaging/scripts/collect_device_info.py
```

用户会得到类似这样的信息：
```
设备指纹: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
公网IP:   123.456.789.012
```

#### 2. 使用收集的信息构建授权版本

```bash
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --device "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-User1.exe"
```

**参数说明：**
- `--ip`: 授权的IP地址（可多个，用空格分隔）
- `--device`: 授权的设备指纹（可选）
- `--expiry`: 过期日期（格式：YYYY-MM-DD）
- `--output`: 输出文件名
- `--strict`: 启用严格模式（可选）

### 方式二：仅IP限制 + 首次自动绑定设备

适合IP已知但未收集设备信息的情况。

```bash
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-User2.exe"
```

用户首次运行时，会自动绑定当前设备。

### 方式三：仅设备绑定（不限制IP）

适合用户IP经常变化的情况。

```bash
python packaging/scripts/build_beta.py \
  --ip "0.0.0.0" \
  --no-ip-check \
  --expiry "2025-04-30" \
  --output "Observer-Beta-User3.exe"
```

## 🎯 使用场景推荐

### 场景1：熟人/可信任用户
```bash
# 仅时间限制，首次运行自动绑定设备
python packaging/scripts/build_beta.py \
  --ip "0.0.0.0" \
  --no-ip-check \
  --expiry "2025-04-30" \
  --output "Observer-Beta-Friend.exe"
```

### 场景2：陌生用户，担心传播
```bash
# IP + 设备双重验证，严格模式
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" \
  --device "abc123..." \
  --expiry "2025-04-30" \
  --strict \
  --output "Observer-Beta-Tester1.exe"
```

### 场景3：用户IP经常变化
```bash
# 仅设备绑定 + 时间限制
python packaging/scripts/build_beta.py \
  --ip "123.456.789.012" "111.222.333.444" \
  --expiry "2025-04-30" \
  --output "Observer-Beta-Mobile.exe"
```

## 📦 打包输出

构建成功后，会在 `dist/` 目录生成：

```
dist/
├── Observer-Beta-User1.exe          # 可执行文件
└── Observer-Beta-User1-README.txt   # 授权说明文档
```

将这两个文件一起发送给测试用户。

## 🔍 验证流程

用户运行Beta版本时，会看到类似输出：

```
======================================================================
                  Observer Of STZB - Beta 测试版                     
======================================================================

📋 授权信息:
   ✅ 时间验证: 有效期至 2025-04-30（剩余 89 天）
   ✅ IP验证: IP验证通过: 123.456.789.012
   ✅ 设备验证: 设备验证通过: e3b0c44298fc...

======================================================================
                  ✅ 授权验证通过，正在启动服务...                    
======================================================================
```

如果验证失败，会显示：

```
======================================================================
                         ❌ 授权验证失败                             
======================================================================

未授权的IP地址: 999.888.777.666
授权IP: 123.456.789.012

如需继续使用，请联系开发者
反馈QQ群: 1063894809
======================================================================
```

## ⚙️ 手动配置（高级）

如果不想使用构建脚本，也可以手动修改 `beta_license.py`：

```python
# Beta过期时间戳
BETA_EXPIRY_TIMESTAMP = 1746057600  # 2025-04-30 23:59:59

# 授权IP白名单
ALLOWED_IPS = [
    "123.456.789.012",
    "111.222.333.444",
]

# 授权设备指纹
ALLOWED_DEVICE_FINGERPRINTS = [
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
]

# 开关配置
ENABLE_IP_CHECK = True      # 是否启用IP验证
ENABLE_DEVICE_CHECK = True  # 是否启用设备验证
STRICT_MODE = False         # 是否启用严格模式
```

然后使用PyInstaller打包：

```bash
pyinstaller packaging/pyinstaller/stzb-web.spec --clean --noconfirm
```

## 🛡️ 安全说明

### 可以防护：
- ✅ 普通用户直接转发exe给他人
- ✅ IP变化导致的误用（宽松模式）
- ✅ 过期后继续使用
- ✅ 在未授权设备上运行

### 无法完全防护：
- ❌ 专业人士逆向工程
- ❌ 修改系统时间（可通过联网时间验证缓解）
- ❌ 虚拟机/代理绕过IP验证

### 建议：
1. **对熟人用户**：简单限制即可，主要靠信任
2. **对陌生用户**：多重验证 + 严格模式
3. **最佳实践**：Beta版本 + 在线服务器验证（需要额外开发）

## 📝 时间戳转换

需要生成时间戳？可以使用Python：

```python
from datetime import datetime

# 转换日期为时间戳
dt = datetime.strptime("2025-04-30 23:59:59", "%Y-%m-%d %H:%M:%S")
timestamp = int(dt.timestamp())
print(timestamp)  # 1746057599
```

或使用在线工具：https://tool.lu/timestamp/

## 🐛 测试验证

构建完成后，建议先在自己的机器上测试：

```bash
# 运行可执行文件
./dist/Observer-Beta-User1.exe

# 测试设备信息工具
python packaging/scripts/collect_device_info.py

# 测试授权模块
python beta_license.py
python beta_license.py --device-info
```

## 📞 常见问题

### Q: 用户IP变了怎么办？
A: 
1. 在构建时添加多个IP：`--ip "IP1" "IP2" "IP3"`
2. 使用宽松模式（默认），IP或设备任一验证通过即可
3. 禁用IP验证：`--no-ip-check`

### Q: 如何收集多个用户的信息？
A: 将 `collect_device_info.py` 打包成exe发给每个用户，收集后统一构建。

### Q: 可以修改已打包的exe的授权信息吗？
A: 不可以，授权信息编译在exe内部，需要重新构建。

### Q: 如何延长Beta有效期？
A: 修改 `--expiry` 参数重新构建，或者让用户更新到新版本。

## 📚 相关文件

- `beta_license.py` - 授权验证模块
- `run_web_exe.py` - 启动入口（已集成验证）
- `packaging/scripts/build_beta.py` - Beta构建脚本
- `packaging/scripts/collect_device_info.py` - 设备信息收集工具
