"""Embed a local ad-hoc WidgetKit experiment in an isolated real Folio build.

Requires a full-Xcode CI-built extension from the same source revision.
The experimental host must use dev.folio.surface.containerexperiment, so this
script cannot accidentally re-sign the currently installed production app.
"""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import subprocess


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--prebuilt-extension', type=Path, required=True)
    args = parser.parse_args()
    app = args.app.resolve()
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    identifier = 'dev.folio.surface.containerexperiment'
    if info.get('CFBundleIdentifier') != identifier or info.get('CFBundleExecutable') != 'folio':
        parser.error('Input must be an isolated dev.folio.surface.containerexperiment Folio app.')
    extension = app / 'Contents/PlugIns/FolioWidgets.appex'
    if extension.exists():
        parser.error('Extension already present; use a fresh experimental build.')
    template = args.prebuilt_extension.resolve()
    metadata = template / 'Contents/Resources/Metadata.appintents'
    if not (metadata / 'extract.actionsdata').is_file():
        parser.error('Extension must contain full-Xcode extracted App Intents metadata.')
    template_info = plistlib.loads((template / 'Contents/Info.plist').read_bytes())
    if template_info.get('CFBundleShortVersionString') != info['CFBundleShortVersionString']:
        parser.error('Host and CI extension versions do not match.')
    extension.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(template, extension)
    template_info.update(CFBundleIdentifier=identifier + '.widgets', CFBundleExecutable='FolioWidgets',
                         CFBundleDisplayName='笺影沙盒实验', CFBundleShortVersionString=info['CFBundleShortVersionString'],
                         CFBundleVersion=info['CFBundleVersion'], FolioWidgetPrivateContainer=identifier + '.widgets')
    template_info.pop('FolioAppGroup', None)
    (extension / 'Contents/Info.plist').write_bytes(plistlib.dumps(template_info))
    entitlements = app.parent / 'private-widget.entitlements'
    entitlements.write_bytes(plistlib.dumps({'com.apple.security.app-sandbox': True}))
    run('codesign', '--force', '--sign', '-', '--entitlements', str(entitlements), str(extension))
    info.pop('FolioAppGroup', None)
    info['FolioWidgetPrivateContainer'] = identifier + '.widgets'
    info['CFBundleDisplayName'] = '笺影沙盒实验'
    info_path.write_bytes(plistlib.dumps(info))
    for dylib in (app / 'Contents').rglob('*.dylib'):
        if 'FolioWidgets.appex' not in dylib.parts:
            run('codesign', '--force', '--sign', '-', str(dylib))
    run('codesign', '--force', '--sign', '-', str(app))
    run('codesign', '--verify', '--deep', '--strict', str(app))
    if list(app.rglob('*.provisionprofile')):
        raise RuntimeError('Experimental build unexpectedly contains a provisioning profile.')
    report = dict(app=str(app), version=info['CFBundleShortVersionString'], signing='ad-hoc',
                  appGroup=False, provisioningProfile=False, metadata='full-Xcode-CI',
                  systemLoaded='not-tested', crossContainerRead='not-tested')
    (app.parent / 'PRIVATE_WIDGET_BUILD_REPORT.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
