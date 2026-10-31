#!/usr/bin/env python3
"""
设备信息收集工具

用途：在为用户打包Beta版本之前，让用户运行此脚本收集设备信息
然后将信息发送给你，你用于生成授权版本
"""

import sys
import platform
import subprocess
import hashlib
from pathlib import Path


def get_cpu_id():
    """获取CPU序列号"""
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
    return "(无法获取)"


def get_mac_address():
    """获取MAC地址"""
    try:
        import uuid
        mac = uuid.getnode()
        return f"{mac:012x}"
    except:
        return "(无法获取)"


def get_system_uuid():
    """获取系统UUID"""
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
    return "(无法获取)"


def get_device_fingerprint():
    """生成设备指纹"""
    cpu_id = get_cpu_id()
    mac = get_mac_address()
    sys_uuid = get_system_uuid()
    hostname = platform.node()
    
    raw = f"{cpu_id}|{mac}|{sys_uuid}|{hostname}"
    fingerprint = hashlib.sha256(raw.encode()).hexdigest()
    
    return fingerprint


def get_public_ip():
    """获取公网IP"""
    try:
        import requests
        services = [
            "https://api.ipify.org",
            "https://ifconfig.me/ip",
            "https://icanhazip.com",
        ]
        
        for service in services:
            try:
                response = requests.get(service, timeout=5)
                if response.status_code == 200:
                    return response.text.strip()
            except:
                continue
        
        return "(无法获取，请检查网络连接)"
    
    except ImportError:
        return "(需要安装 requests 库: pip install requests)"


def main():
    print("=" * 80)
    print(" Observer Of STZB - Beta版本设备信息收集工具".center(80))
    print("=" * 80)
    print()
    print("此工具用于收集您的设备信息，以便开发者为您生成授权的Beta版本。")
    print("请将下方信息复制并发送给开发者。")
    print()
    print("=" * 80)
    print()
    
    # 收集信息
    device_fingerprint = get_device_fingerprint()
    public_ip = get_public_ip()
    cpu_id = get_cpu_id()
    mac = get_mac_address()
    sys_uuid = get_system_uuid()
    hostname = platform.node()
    os_info = f"{platform.system()} {platform.release()}"
    
    # 格式化输出
    info = f"""
【设备授权信息】

设备指纹: {device_fingerprint}
公网IP:   {public_ip}

【详细信息】（供调试使用）
操作系统: {os_info}
主机名:   {hostname}
CPU ID:   {cpu_id}
MAC地址:  {mac}
系统UUID: {sys_uuid}

【说明】
- 请将上述"设备指纹"和"公网IP"发送给开发者
- 如果您的IP地址经常变化，请告知开发者
- 开发者将为您生成专属的Beta测试版本
"""
    
    print(info)
    print("=" * 80)
    
    # 保存到文件
    output_file = Path("device_info.txt")
    try:
        output_file.write_text(info, encoding="utf-8")
        print(f"\n✅ 信息已保存到: {output_file.absolute()}")
        print(f"   您可以直接将此文件发送给开发者")
    except:
        print(f"\n⚠️  无法保存到文件，请手动复制上述信息")
    
    print("\n" + "=" * 80)
    input("\n按回车键退出...")


if __name__ == "__main__":
    main()
