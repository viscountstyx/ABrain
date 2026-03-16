# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for ABrain
# Build with: pyinstaller abrain.spec

import os
from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

block_cipher = None

# Collect pywebview and PySide6 WebEngine data files
datas = [
    ("ui", "ui"),  # bundle entire ui/ directory
]
datas += collect_data_files("webview")

a = Analysis(
    ["main.py"],
    pathex=["."],
    binaries=collect_dynamic_libs("PySide6"),
    datas=datas,
    hiddenimports=[
        "webview",
        "webview.platforms.qt",
        "PySide6.QtWebEngineWidgets",
        "PySide6.QtWebEngineCore",
        "PySide6.QtWidgets",
        "PySide6.QtCore",
        "PySide6.QtGui",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="abrain",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="abrain",
)
