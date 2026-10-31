#!/usr/bin/env python3
"""
Beta版本构建脚本

用法：
    python build_beta.py --ip "123.456.789.012" --expiry "2025-04-30" --output "Observer-Beta-User1.exe"

功能：
    1. 自动修改 beta_license.py 中的配置
    2. 调用 PyInstaller 打包
    3. 生成带授权信息的 README
"""

import argparse
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(description="构建Beta授权版本")
    
    parser.add_argument(
        "--ip",
        nargs="+",
        required=True,
        help="授权IP地址（可多个，用空格分隔）"
    )
    
    parser.add_argument(
        "--device",
        nargs="*",
        default=[],
        help="授权设备指纹（可选，留空则首次运行自动绑定）"
    )
    
    parser.add_argument(
        "--expiry",
        required=True,
        help="过期日期（格式：YYYY-MM-DD，如 2025-04-30）"
    )
    
    parser.add_argument(
        "--strict",
        action="store_true",
        help="启用严格模式（IP和设备必须同时验证通过）"
    )
    
    parser.add_argument(
        "--no-ip-check",
        action="store_true",
        help="禁用IP验证（仅使用设备指纹+时间）"
    )
    
    parser.add_argument(
        "--no-device-check",
        action="store_true",
        help="禁用设备指纹验证（仅使用IP+时间）"
    )
    
    parser.add_argument(
        "--output",
        default="Observer-Of-STZB-Beta.exe",
        help="输出文件名"
    )
    
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="仅修改配置，不执行打包"
    )
    
    return parser.parse_args()


def parse_expiry_date(date_str):
    """解析过期日期并转换为时间戳"""
    try:
        dt = datetime.strptime(date_str + " 23:59:59", "%Y-%m-%d %H:%M:%S")
        timestamp = int(dt.timestamp())
        return timestamp
    except ValueError as e:
        print(f"❌ 日期格式错误: {e}")
        sys.exit(1)


def modify_beta_license(
    ips,
    devices,
    expiry_timestamp,
    enable_ip_check,
    enable_device_check,
    strict_mode
):
    """修改 beta_license.py 中的配置"""
    
    root = Path(__file__).resolve().parents[2]
    license_file = root / "beta_license.py"
    
    if not license_file.exists():
        print(f"❌ 找不到 {license_file}")
        sys.exit(1)
    
    print(f"📝 修改授权配置: {license_file}")
    
    content = license_file.read_text(encoding="utf-8")
    
    # 修改过期时间
    content = re.sub(
        r'BETA_EXPIRY_TIMESTAMP = \d+',
        f'BETA_EXPIRY_TIMESTAMP = {expiry_timestamp}',
        content
    )
    
    # 修改IP白名单
    ip_list = ",\n    ".join([f'"{ip}"' for ip in ips])
    content = re.sub(
        r'ALLOWED_IPS = \[(.*?)\]',
        f'ALLOWED_IPS = [\n    {ip_list},\n]',
        content,
        flags=re.DOTALL
    )
    
    # 修改设备指纹白名单
    if devices:
        device_list = ",\n    ".join([f'"{d}"' for d in devices])
        content = re.sub(
            r'ALLOWED_DEVICE_FINGERPRINTS = \[(.*?)\]',
            f'ALLOWED_DEVICE_FINGERPRINTS = [\n    {device_list},\n]',
            content,
            flags=re.DOTALL
        )
    
    # 修改开关
    content = re.sub(
        r'ENABLE_IP_CHECK = (True|False)',
        f'ENABLE_IP_CHECK = {enable_ip_check}',
        content
    )
    
    content = re.sub(
        r'ENABLE_DEVICE_CHECK = (True|False)',
        f'ENABLE_DEVICE_CHECK = {enable_device_check}',
        content
    )
    
    content = re.sub(
        r'STRICT_MODE = (True|False)',
        f'STRICT_MODE = {strict_mode}',
        content
    )
    
    # 写回文件
    license_file.write_text(content, encoding="utf-8")
    
    print("✅ 配置修改完成")


def build_exe(output_name):
    """调用 PyInstaller 打包"""
    root = Path(__file__).resolve().parents[2]
    spec_file = root / "packaging" / "pyinstaller" / "stzb-web.spec"
    
    if not spec_file.exists():
        print(f"❌ 找不到 {spec_file}")
        sys.exit(1)
    
    print(f"\n🔨 开始打包...")
    print(f"   Spec文件: {spec_file}")
    
    try:
        subprocess.run(
            [sys.executable, "-m", "PyInstaller", str(spec_file), "--clean", "--noconfirm"],
            cwd=root,
            check=True
        )
        
        # 重命名输出文件
        dist_dir = root / "dist"
        original_exe = dist_dir / "Observer-Of-STZB.exe"
        target_exe = dist_dir / output_name
        
        if original_exe.exists():
            if target_exe.exists():
                target_exe.unlink()
            original_exe.rename(target_exe)
            print(f"\n✅ 打包完成: {target_exe}")
        else:
            print(f"❌ 找不到输出文件: {original_exe}")
            sys.exit(1)
    
    except subprocess.CalledProcessError as e:
        print(f"❌ 打包失败: {e}")
        sys.exit(1)


def generate_readme(ips, expiry_date, output_name, strict_mode):
    """生成授权信息README"""
    root = Path(__file__).resolve().parents[2]
    dist_dir = root / "dist"
    readme_file = dist_dir / f"{Path(output_name).stem}-README.txt"
    
    content = f"""
========================================
Observer Of STZB - Beta 测试版
========================================

授权信息：
- 授权IP: {', '.join(ips)}
- 有效期至: {expiry_date}
- 验证模式: {'严格模式（IP+设备双重验证）' if strict_mode else '宽松模式（IP或设备任一验证即可）'}

使用说明：
1. 双击 {output_name} 启动程序
2. 首次运行会自动绑定当前设备
3. 后续使用需要在授权IP下运行
4. Beta版本到期后将自动停止运行

注意事项：
⚠️  本程序仅供测试使用，请勿传播
⚠️  程序已绑定您的设备和IP，转发给他人无法使用
⚠️  如遇问题，请联系开发者

反馈QQ群: 1063894809

========================================
"""
    
    readme_file.write_text(content.strip(), encoding="utf-8")
    print(f"📄 已生成授权说明: {readme_file}")


def main():
    args = parse_args()
    
    print("=" * 70)
    print(" Beta版本构建工具".center(70))
    print("=" * 70)
    
    # 解析过期日期
    expiry_timestamp = parse_expiry_date(args.expiry)
    expiry_date_str = datetime.fromtimestamp(expiry_timestamp).strftime("%Y-%m-%d")
    
    # 打印配置
    print(f"\n📋 构建配置:")
    print(f"   授权IP: {', '.join(args.ip)}")
    if args.device:
        print(f"   授权设备: {', '.join(args.device)}")
    else:
        print(f"   授权设备: (首次运行自动绑定)")
    print(f"   过期日期: {expiry_date_str}")
    print(f"   IP验证: {'禁用' if args.no_ip_check else '启用'}")
    print(f"   设备验证: {'禁用' if args.no_device_check else '启用'}")
    print(f"   验证模式: {'严格' if args.strict else '宽松'}")
    print(f"   输出文件: {args.output}")
    
    # 确认
    if not args.no_build:
        confirm = input("\n是否继续? (y/n): ")
        if confirm.lower() != 'y':
            print("已取消")
            sys.exit(0)
    
    # 修改配置
    modify_beta_license(
        ips=args.ip,
        devices=args.device,
        expiry_timestamp=expiry_timestamp,
        enable_ip_check=not args.no_ip_check,
        enable_device_check=not args.no_device_check,
        strict_mode=args.strict
    )
    
    # 打包
    if not args.no_build:
        build_exe(args.output)
        generate_readme(args.ip, expiry_date_str, args.output, args.strict)
    
    print("\n" + "=" * 70)
    print(" ✅ 完成".center(70))
    print("=" * 70)


if __name__ == "__main__":
    main()
