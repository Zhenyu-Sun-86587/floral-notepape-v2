"""Build and embed the real WidgetKit extension into an already built Folio.app.

Requires full Xcode and a matching Apple signing identity/team. No ad-hoc
fallback: a typechecked Swift binary alone is not a working WidgetKit product.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


def run(*args):
    subprocess.run(args, check=True)


def project(directory, source):
    objects = {}

    def add(object_key, **properties):
        key = hashlib.sha256(object_key.encode()).hexdigest()[:24].upper()
        objects[key] = properties
        return key

    refs = []
    builds = []
    for name in ['Shared.swift', 'FolioWidgets.swift']:
        ref = add(name, isa='PBXFileReference', lastKnownFileType='sourcecode.swift',
                  path=str(source / name), sourceTree='<absolute>')
        refs.append(ref)
        builds.append(add(name + '-build', isa='PBXBuildFile', fileRef=ref))
    product = add('product', isa='PBXFileReference', explicitFileType='wrapper.app-extension',
                  path='FolioWidgets.appex', sourceTree='BUILT_PRODUCTS_DIR')
    products = add('products', isa='PBXGroup', children=[product], name='Products', sourceTree='<group>')
    group = add('group', isa='PBXGroup', children=refs + [products], sourceTree='<group>')
    sources = add('sources', isa='PBXSourcesBuildPhase', buildActionMask=2147483647,
                  files=builds, runOnlyForDeploymentPostprocessing=0)
    frameworks = add('frameworks', isa='PBXFrameworksBuildPhase', buildActionMask=2147483647,
                     files=[], runOnlyForDeploymentPostprocessing=0)
    settings = dict(
        SDKROOT='macosx', MACOSX_DEPLOYMENT_TARGET='15.0', SWIFT_VERSION='5.0',
        PRODUCT_NAME='FolioWidgets', PRODUCT_BUNDLE_IDENTIFIER='dev.hermes.surface.widgets',
        INFOPLIST_FILE=str(source / 'Info.plist'),
        CODE_SIGN_ENTITLEMENTS=str(source / 'Widgets.entitlements'),
        APPLICATION_EXTENSION_API_ONLY='YES', SKIP_INSTALL='YES',
        GENERATE_INFOPLIST_FILE='NO', SWIFT_OPTIMIZATION_LEVEL='-O',
        CODE_SIGN_STYLE='Manual', CURRENT_PROJECT_VERSION='1')
    config = add('config', isa='XCBuildConfiguration', name='Release', buildSettings=settings)
    configs = add('configs', isa='XCConfigurationList', buildConfigurations=[config],
                  defaultConfigurationIsVisible=0, defaultConfigurationName='Release')
    target = add('target', isa='PBXNativeTarget', name='FolioWidgets', productName='FolioWidgets',
                 productType='com.apple.product-type.app-extension', productReference=product,
                 buildConfigurationList=configs, buildPhases=[sources, frameworks],
                 buildRules=[], dependencies=[])
    root = add('root', isa='PBXProject', compatibilityVersion='Xcode 14.0',
               developmentRegion='zh-Hans', knownRegions=['zh-Hans', 'en'],
               mainGroup=group, productRefGroup=products, projectDirPath='', projectRoot='',
               targets=[target], buildConfigurationList=configs, attributes={})
    directory.mkdir(parents=True)
    (directory / 'project.pbxproj').write_bytes(plistlib.dumps(dict(
        archiveVersion='1', classes={}, objectVersion='56', objects=objects, rootObject=root)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path)
    parser.add_argument('--team')
    parser.add_argument('--identity')
    parser.add_argument('--compile-only', action='store_true', help='Build an unsigned extension for CI validation only; do not install or enable it.')
    parser.add_argument('--output', type=Path, default=Path('local-build/widget-ci'))
    args = parser.parse_args()
    if args.compile_only:
        run('xcodebuild', '-version')
        source = Path(__file__).resolve().parent.parent / 'src-tauri/native/widgets'
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        version = json.loads((source.parents[1] / 'tauri.conf.json').read_text())['version']
        with tempfile.TemporaryDirectory(prefix='folio-widget-check-') as tmp:
            proj = Path(tmp) / 'FolioWidgets.xcodeproj'
            project(proj, source)
            run('xcodebuild', '-project', str(proj), '-target', 'FolioWidgets',
                '-configuration', 'Release', 'build',
                'CONFIGURATION_BUILD_DIR=' + str(output),
                'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
                'FOLIO_APP_GROUP=buildcheck.folio.widgets', 'MARKETING_VERSION=' + version)
        extension = output / 'FolioWidgets.appex'
        info = plistlib.loads((extension / 'Contents/Info.plist').read_bytes())
        assert info['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.widgetkit-extension'
        assert (extension / 'Contents/MacOS' / info['CFBundleExecutable']).is_file()
        metadata = [str(p.relative_to(extension)) for p in extension.rglob('*')
                    if p.is_file() and '.appintents/' in str(p)]
        if not metadata:
            raise RuntimeError('Xcode built the binary but did not extract App Intents metadata.')
        report = dict(version=version, mode='unsigned-build-check', installable=False, metadata=metadata)
        (output / 'BUILD_REPORT.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
        return
    if not args.app or not args.team or not args.identity:
        parser.error('Signed embedding requires --app, --team and --identity.')
    if args.identity == '-' or len(args.team) != 10 or not args.team.isalnum():
        parser.error('Use an Apple signing identity and its 10-character team identifier.')
    run('xcodebuild', '-version')
    app = args.app.resolve()
    info_path = app / 'Contents/Info.plist'
    info = plistlib.loads(info_path.read_bytes())
    if info.get('CFBundleIdentifier') != 'dev.hermes.surface' or info.get('CFBundleExecutable') != 'folio':
        parser.error('The input must be the built Folio.app, not an unrelated app.')
    source = Path(__file__).resolve().parent.parent / 'src-tauri/native/widgets'
    group = args.team + '.dev.hermes.surface.widgets'
    with tempfile.TemporaryDirectory(prefix='folio-widget-build-') as tmp:
        tmp = Path(tmp)
        proj = tmp / 'FolioWidgets.xcodeproj'
        project(proj, source)
        run('xcodebuild', '-project', str(proj), '-target', 'FolioWidgets',
            '-configuration', 'Release', 'build',
            'CONFIGURATION_BUILD_DIR=' + str(tmp / 'products'),
            'DEVELOPMENT_TEAM=' + args.team, 'CODE_SIGN_IDENTITY=' + args.identity,
            'FOLIO_APP_GROUP=' + group, 'MARKETING_VERSION=' + info['CFBundleShortVersionString'])
        extension = tmp / 'products/FolioWidgets.appex'
        run('codesign', '--verify', '--strict', str(extension))
        embedded = app / 'Contents/PlugIns/FolioWidgets.appex'
        if embedded.exists():
            parser.error('Widget extension already embedded; use a freshly built app.')
        embedded.parent.mkdir(exist_ok=True)
        shutil.copytree(extension, embedded)
        info['FolioAppGroup'] = group
        info_path.write_bytes(plistlib.dumps(info))
        entitlement = tmp / 'host.entitlements'
        entitlement.write_bytes(plistlib.dumps({'com.apple.security.application-groups': [group]}))
        # Framework/native binaries require the same trusted identity. Sign
        # inside-out without a broad --deep signing operation.
        for dylib in (app / 'Contents').rglob('*.dylib'):
            if 'FolioWidgets.appex' not in dylib.parts:
                run('codesign', '--force', '--sign', args.identity, str(dylib))
        run('codesign', '--force', '--sign', args.identity, '--entitlements', str(entitlement), str(app))
        run('codesign', '--verify', '--deep', '--strict', str(app))
    print(json.dumps({'app': str(app), 'appGroup': group, 'widget': 'FolioWidgets.appex'}))


if __name__ == '__main__':
    main()
