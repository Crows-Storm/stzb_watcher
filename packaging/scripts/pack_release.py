#!/usr/bin/env python3
"""
赠予版打包脚本

用途：将构建好的exe和用户文档打包成zip
"""

import argparse
import shutil
import zipfile
from pathlib import Path
from datetime import datetime


def parse_args():
    parser = argparse.ArgumentParser(description="打包赠予版发布包")
    
    parser.add_argument(
        "--exe",
        required=True,
        help="exe文件路径（例如：dist/Observer-Beta-User1.exe）"
    )
    
    parser.add_argument(
        "--user",
        default="User",
        help="用户名称（用于命名压缩包）"
    )
    
    parser.add_argument(
        "--output-dir",
        default="releases",
        help="输出目录（默认：releases/）"
    )
    
    return parser.parse_args()


def main():
    args = parse_args()
    
    print("=" * 70)
    print(" 赠予版打包工具".center(70))
    print("=" * 70)
    
    # 路径设置
    root = Path(__file__).resolve().parents[2]
    exe_path = root / args.exe
    output_dir = root / args.output_dir
    
    # 文档路径
    user_guide_md = root / "docs" / "windows-user-guide.md"
    readme_txt = root / "docs" / "赠予版-README.txt"
    
    # 检查文件是否存在
    if not exe_path.exists():
        print(f"❌ 找不到exe文件: {exe_path}")
        return 1
    
    if not user_guide_md.exists():
        print(f"❌ 找不到用户手册: {user_guide_md}")
        return 1
    
    if not readme_txt.exists():
        print(f"⚠️  找不到README: {readme_txt}（将跳过）")
        readme_txt = None
    
    # 创建输出目录
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # 生成压缩包名称
    timestamp = datetime.now().strftime("%Y%m%d")
    zip_name = f"Observer-赠予版-{args.user}-{timestamp}.zip"
    zip_path = output_dir / zip_name
    
    print(f"\n📦 开始打包...")
    print(f"   EXE: {exe_path.name}")
    print(f"   用户手册: {user_guide_md.name}")
    if readme_txt:
        print(f"   README: {readme_txt.name}")
    print(f"   输出: {zip_path}")
    
    # 创建压缩包
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        # 添加exe（重命名为统一名称）
        zf.write(exe_path, "Observer-Of-STZB.exe")
        
        # 添加用户手册
        zf.write(user_guide_md, "windows-user-guide.md")
        
        # 添加README（如果存在）
        if readme_txt:
            zf.write(readme_txt, "使用必读.txt")
    
    print(f"\n✅ 打包完成: {zip_path}")
    print(f"   文件大小: {zip_path.stat().st_size / 1024 / 1024:.2f} MB")
    
    print("\n📋 压缩包内容:")
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for info in zf.infolist():
            size_mb = info.file_size / 1024 / 1024
            print(f"   - {info.filename:<30} ({size_mb:.2f} MB)")
    
    print("\n" + "=" * 70)
    print(" 完成！可以将此压缩包发送给用户。".center(70))
    print("=" * 70)
    
    return 0


if __name__ == "__main__":
    exit(main())
