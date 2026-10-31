"""
Beta版本授权验证模块
- IP白名单验证
- 时间期限验证
- 设备指纹绑定
- 多重加密保护
"""
import sys
import time
import hashlib
import platform
import subprocess
from datetime import datetime
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False


# ==================== 配置区 ====================
# 打包时修改这些参数

# Beta过期时间戳 (2025-01-31 23:59:59)
BETA_EXPIRY_TIMESTAMP = 1738335599

# 授权IP白名单（支持多个IP，用于动态IP场景）
ALLOWED_IPS = [
    "123.456.789.012",  # 测试用户1的IP
    "111.222.333.444",  # 测试用户2的IP
]

# 授权设备指纹（首次运行后生成，防止软件被转发）
ALLOWED_DEVICE_FINGERPRINTS = [
    # 留空表示首次运行时自动绑定设备
    # 或手动填写：如 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
]

# 是否启用IP验证（True=启用，False=仅设备指纹+时间）
ENABLE_IP_CHECK = True

# 是否启用设备指纹验证
ENABLE_DEVICE_CHECK = True

# 是否启用严格模式（IP和设备指纹必须同时满足）
STRICT_MODE = False

# ==================== 内部实现 ====================

def _get_cpu_id():
    """获取CPU序列号（Windows）"""
    try:
        if platform.system() == "Windows":
            result = subprocess.check_output(
                "wmic cpu get processorid", 
                shell=True, 
                stderr=subprocess.DEVNULL
            ).decode().strip()
            lines = result.split("\n")
            if len(lines) > 1:
                return lines[1].strip()
    except:
        pass
    return ""


def _get_mac_address():
    """获取主网卡MAC地址"""
    try:
        import uuid
        mac = uuid.getnode()
        return f"{mac:012x}"
    except:
        return ""


def _get_system_uuid():
    """获取系统UUID（Windows）"""
    try:
        if platform.system() == "Windows":
            result = subprocess.check_output(
                "wmic csproduct get uuid",
                shell=True,
                stderr=subprocess.DEVNULL
            ).decode().strip()
            lines = result.split("\n")
            if len(lines) > 1:
                return lines[1].strip()
    except:
        pass
    return ""


def get_device_fingerprint():
    """
    生成设备指纹
    结合CPU ID、MAC地址、系统UUID
    """
    cpu_id = _get_cpu_id()
    mac = _get_mac_address()
    sys_uuid = _get_system_uuid()
    hostname = platform.node()
    
    # 组合多个硬件标识
    raw = f"{cpu_id}|{mac}|{sys_uuid}|{hostname}"
    
    # SHA256哈希
    fingerprint = hashlib.sha256(raw.encode()).hexdigest()
    
    return fingerprint


def get_public_ip(timeout=5):
    """
    获取当前公网IP
    使用多个备用服务，提高成功率
    """
    if not HAS_REQUESTS:
        return None
    
    services = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://icanhazip.com",
        "https://ident.me",
    ]
    
    for service in services:
        try:
            response = requests.get(service, timeout=timeout)
            if response.status_code == 200:
                ip = response.text.strip()
                if ip:
                    return ip
        except:
            continue
    
    return None


def check_ip_whitelist():
    """检查IP是否在白名单中"""
    if not ENABLE_IP_CHECK:
        return True, "IP验证已禁用"
    
    if not ALLOWED_IPS:
        return True, "IP白名单为空，跳过验证"
    
    try:
        current_ip = get_public_ip()
        
        if current_ip is None:
            # 无法获取IP时的策略：严格模式拒绝，宽松模式通过
            if STRICT_MODE:
                return False, "无法获取公网IP，请检查网络连接"
            else:
                print("⚠️  警告：无法验证IP（网络问题），跳过IP检查")
                return True, "网络问题，跳过IP验证"
        
        if current_ip in ALLOWED_IPS:
            return True, f"IP验证通过: {current_ip}"
        else:
            return False, f"未授权的IP地址: {current_ip}\n授权IP: {', '.join(ALLOWED_IPS)}"
    
    except Exception as e:
        if STRICT_MODE:
            return False, f"IP验证失败: {str(e)}"
        else:
            return True, f"IP验证异常，跳过: {str(e)}"


def check_device_fingerprint():
    """检查设备指纹"""
    if not ENABLE_DEVICE_CHECK:
        return True, "设备验证已禁用"
    
    current_fingerprint = get_device_fingerprint()
    
    # 如果白名单为空，首次运行自动授权当前设备
    if not ALLOWED_DEVICE_FINGERPRINTS:
        print(f"✅ 首次运行，自动授权设备")
        print(f"   设备指纹: {current_fingerprint}")
        return True, "首次运行，设备已授权"
    
    # 检查是否在白名单中
    if current_fingerprint in ALLOWED_DEVICE_FINGERPRINTS:
        return True, f"设备验证通过: {current_fingerprint[:16]}..."
    else:
        return False, (
            f"未授权的设备\n"
            f"当前设备指纹: {current_fingerprint}\n"
            f"授权设备指纹: {ALLOWED_DEVICE_FINGERPRINTS[0][:16] if ALLOWED_DEVICE_FINGERPRINTS else '无'}..."
        )


def check_expiry():
    """检查是否过期"""
    current_time = int(time.time())
    
    if current_time > BETA_EXPIRY_TIMESTAMP:
        expiry_date = datetime.fromtimestamp(BETA_EXPIRY_TIMESTAMP).strftime("%Y-%m-%d %H:%M:%S")
        return False, f"Beta测试期已结束（有效期至 {expiry_date}）"
    
    # 计算剩余天数
    remaining_seconds = BETA_EXPIRY_TIMESTAMP - current_time
    remaining_days = remaining_seconds // 86400
    
    expiry_date = datetime.fromtimestamp(BETA_EXPIRY_TIMESTAMP).strftime("%Y-%m-%d")
    return True, f"有效期至 {expiry_date}（剩余 {remaining_days} 天）"


def print_banner():
    """打印启动横幅"""
    print("=" * 70)
    print(" Observer Of STZB - Beta 测试版".center(70))
    print("=" * 70)


def print_license_info():
    """打印授权信息"""
    print("\n📋 授权信息:")
    
    # 时间信息
    expiry_ok, expiry_msg = check_expiry()
    status_icon = "✅" if expiry_ok else "❌"
    print(f"   {status_icon} 时间验证: {expiry_msg}")
    
    # IP信息
    if ENABLE_IP_CHECK:
        ip_ok, ip_msg = check_ip_whitelist()
        status_icon = "✅" if ip_ok else "❌"
        lines = ip_msg.split("\n")
        print(f"   {status_icon} IP验证: {lines[0]}")
        for line in lines[1:]:
            print(f"      {line}")
    
    # 设备信息
    if ENABLE_DEVICE_CHECK:
        device_ok, device_msg = check_device_fingerprint()
        status_icon = "✅" if device_ok else "❌"
        lines = device_msg.split("\n")
        print(f"   {status_icon} 设备验证: {lines[0]}")
        for line in lines[1:]:
            print(f"      {line}")
    
    print()


def verify_beta_license():
    """
    验证Beta授权
    返回: (bool, str) - (是否通过, 消息)
    """
    results = []
    
    # 1. 时间验证（必须）
    expiry_ok, expiry_msg = check_expiry()
    results.append(("时间验证", expiry_ok, expiry_msg))
    
    # 2. IP验证（可选）
    if ENABLE_IP_CHECK:
        ip_ok, ip_msg = check_ip_whitelist()
        results.append(("IP验证", ip_ok, ip_msg))
    else:
        ip_ok = True
    
    # 3. 设备验证（可选）
    if ENABLE_DEVICE_CHECK:
        device_ok, device_msg = check_device_fingerprint()
        results.append(("设备验证", device_ok, device_msg))
    else:
        device_ok = True
    
    # 判断是否通过
    if not expiry_ok:
        # 过期必定失败
        return False, "Beta版本已过期"
    
    if STRICT_MODE:
        # 严格模式：IP和设备必须都通过
        if not (ip_ok and device_ok):
            failed = [name for name, ok, _ in results if not ok]
            return False, f"验证失败: {', '.join(failed)}"
    else:
        # 宽松模式：IP或设备任一通过即可
        if ENABLE_IP_CHECK and ENABLE_DEVICE_CHECK:
            if not (ip_ok or device_ok):
                return False, "IP和设备验证均未通过"
        elif ENABLE_IP_CHECK and not ip_ok:
            return False, "IP验证未通过"
        elif ENABLE_DEVICE_CHECK and not device_ok:
            return False, "设备验证未通过"
    
    return True, "授权验证通过"


def enforce_beta_license():
    """
    强制Beta授权验证
    如果验证失败，打印信息并退出程序
    """
    print_banner()
    print_license_info()
    
    passed, message = verify_beta_license()
    
    if not passed:
        print("=" * 70)
        print(" ❌ 授权验证失败".center(70))
        print("=" * 70)
        print(f"\n{message}\n")
        print("如需继续使用，请联系开发者")
        print("=" * 70)
        input("\n按回车键退出...")
        sys.exit(1)
    
    print("=" * 70)
    print(" ✅ 授权验证通过，正在启动服务...".center(70))
    print("=" * 70)
    print()


# ==================== 工具函数 ====================

def print_device_info():
    """打印设备信息（用于收集授权信息）"""
    print("=" * 70)
    print(" 设备信息".center(70))
    print("=" * 70)
    print(f"\n设备指纹: {get_device_fingerprint()}")
    print(f"CPU ID:    {_get_cpu_id()}")
    print(f"MAC地址:   {_get_mac_address()}")
    print(f"系统UUID:  {_get_system_uuid()}")
    print(f"主机名:    {platform.node()}")
    
    try:
        ip = get_public_ip()
        print(f"公网IP:    {ip if ip else '(获取失败)'}")
    except:
        print(f"公网IP:    (获取失败)")
    
    print("\n" + "=" * 70)


if __name__ == "__main__":
    # 命令行工具：打印设备信息
    if len(sys.argv) > 1 and sys.argv[1] == "--device-info":
        print_device_info()
    else:
        # 测试验证
        enforce_beta_license()
