"""Build and embed the real WidgetKit extension into an already built Folio.app.

Requires a matching Apple signing identity/team. Build with full Xcode locally,
or sign a previously compiled CI extension locally. No ad-hoc fallback.
"""
import argparse
from datetime import datetime, timezone
import fnmatch
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


def run(*args):
    subprocess.run(args, check=True)


def validate_extension(extension, version):
    info = plistlib.loads((extension / 'Contents/Info.plist').read_bytes())
    if (info.get('CFBundleIdentifier') != 'dev.hermes.surface.widgets'
            or info.get('NSExtension', {}).get('NSExtensionPointIdentifier') != 'com.apple.widgetkit-extension'
            or info.get('CFBundleShortVersionString') != version
            or not (extension / 'Contents/MacOS' / info.get('CFBundleExecutable', '')).is_file()
            or not (extension / 'Contents/Resources/Metadata.appintents/extract.actionsdata').is_file()):
        raise RuntimeError('Extension identity, version, executable or App Intents metadata does not match.')
    return info


def check_team(bundle, team):
    signature = subprocess.run(['codesign', '-dv', '--verbose=2', str(bundle)],
                               check=True, capture_output=True, text=True).stderr
    if 'TeamIdentifier=' + team not in signature.splitlines():
        raise RuntimeError('Signing identity does not belong to the requested team.')


def embed_profile(bundle, directory, identifier, team):
    if directory is None:
        return {}
    profile = directory / (identifier + '.provisionprofile')
    decoded = subprocess.run(['security', 'cms', '-D', '-i', str(profile)],
                             check=True, capture_output=True).stdout
    payload = plistlib.loads(decoded)
    entitlements = payload.get('Entitlements', {})
    application_id = team + '.' + identifier
    expires = payload.get('ExpirationDate')
    if (team not in payload.get('TeamIdentifier', [])
            or 'OSX' not in payload.get('Platform', [])
            or entitlements.get('com.apple.application-identifier') != application_id
            or expires is None
            or expires.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
        raise RuntimeError('macOS development profile is expired or belongs to another app/team.')
    group = team + '.dev.hermes.surface.widgets'
    if not any(fnmatch.fnmatchcase(group, allowed)
               for allowed in entitlements.get('com.apple.security.application-groups', [])):
        raise RuntimeError('Development profile does not authorize the App Group; enable App Groups and regenerate it.')
    shutil.copy2(profile, bundle / 'Contents/embedded.provisionprofile')
    return {'com.apple.application-identifier': application_id,
            'com.apple.developer.team-identifier': team}


def project(directory, source, legacy_probe=False):
    objects = {}

    def add(object_key, **properties):
        key = hashlib.sha256(object_key.encode()).hexdigest()[:24].upper()
        objects[key] = properties
        return key

    refs = []
    builds = []
    files = [source / name for name in ['Shared.swift', 'Markdown.swift', 'FolioWidgets.swift']]
    if legacy_probe:
        files = [source / 'Shared.swift', source / 'Markdown.swift',
                 source.parent / 'tests/LegacyWidgetProbe.swift',
                 source.parent / 'tests/FolioLegacySelection.intentdefinition']
    for file in files:
        name = file.name
        ref = add(name, isa='PBXFileReference', lastKnownFileType=(
                  'file.intentdefinition' if file.suffix == '.intentdefinition' else 'sourcecode.swift'),
                  path=str(file), sourceTree='<absolute>', intentDefinitionClassGenerationLanguage='Swift')
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
    parser.add_argument('--prebuilt-extension', type=Path, help='Sign and embed a matching CI-built extension without local Xcode.')
    parser.add_argument('--keychain', type=Path, help='Optional dedicated keychain containing the signing identity.')
    parser.add_argument('--profiles-dir', type=Path, help='Directory containing matching macOS development profiles for host and widget.')
    parser.add_argument('--development', action='store_true', help='Use development/debug entitlements; requires matching development profiles.')
    parser.add_argument('--compile-only', action='store_true', help='Build an unsigned extension for CI validation only; do not install or enable it.')
    parser.add_argument('--legacy-probe', action='store_true', help='Isolated SiriKit configuration probe; compile-only, never production packaging.')
    parser.add_argument('--output', type=Path, default=Path('local-build/widget-ci'))
    args = parser.parse_args()
    if args.legacy_probe and not args.compile_only:
        parser.error('--legacy-probe requires --compile-only.')
    if args.compile_only and args.prebuilt_extension:
        parser.error('--compile-only and --prebuilt-extension are mutually exclusive.')
    if args.development and not args.profiles_dir:
        parser.error('--development requires --profiles-dir.')
    if args.compile_only:
        run('xcodebuild', '-version')
        source = Path(__file__).resolve().parent.parent / 'src-tauri/native/widgets'
        output = args.output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        version = json.loads((source.parents[1] / 'tauri.conf.json').read_text())['version']
        with tempfile.TemporaryDirectory(prefix='folio-widget-check-') as tmp:
            proj = Path(tmp) / 'FolioWidgets.xcodeproj'
            project(proj, source, args.legacy_probe)
            run('xcodebuild', '-project', str(proj), '-target', 'FolioWidgets',
                '-configuration', 'Release', 'build',
                'CONFIGURATION_BUILD_DIR=' + str(output),
                'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
                'FOLIO_APP_GROUP=buildcheck.folio.widgets', 'MARKETING_VERSION=' + version,
                'CURRENT_PROJECT_VERSION=' + version)
        extension = output / 'FolioWidgets.appex'
        info = plistlib.loads((extension / 'Contents/Info.plist').read_bytes())
        assert info['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.widgetkit-extension'
        assert (extension / 'Contents/MacOS' / info['CFBundleExecutable']).is_file()
        metadata = [str(p.relative_to(extension)) for p in extension.rglob('*')
                    if p.is_file() and '.appintents/' in str(p)]
        if not metadata and not args.legacy_probe:
            raise RuntimeError('Xcode built the binary but did not extract App Intents metadata.')
        report = dict(version=version, mode='legacy-configuration-probe' if args.legacy_probe else 'unsigned-build-check', installable=False, metadata=metadata)
        (output / 'BUILD_REPORT.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
        return
    if not args.app or not args.team or not args.identity:
        parser.error('Signed embedding requires --app, --team and --identity.')
    if args.identity == '-' or len(args.team) != 10 or not args.team.isalnum():
        parser.error('Use an Apple signing identity and its 10-character team identifier.')
    if not args.prebuilt_extension:
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
        embedded = app / 'Contents/PlugIns/FolioWidgets.appex'
        if embedded.exists():
            parser.error('Widget extension already embedded; use a freshly built app.')
        if args.prebuilt_extension:
            extension = args.prebuilt_extension.resolve()
        else:
            proj = tmp / 'FolioWidgets.xcodeproj'
            project(proj, source)
            run('xcodebuild', '-project', str(proj), '-target', 'FolioWidgets',
                '-configuration', 'Release', 'build',
                'CONFIGURATION_BUILD_DIR=' + str(tmp / 'products'),
                'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO',
                'FOLIO_APP_GROUP=' + group, 'MARKETING_VERSION=' + info['CFBundleShortVersionString'],
                'CURRENT_PROJECT_VERSION=' + info.get('CFBundleVersion', info['CFBundleShortVersionString']))
            extension = tmp / 'products/FolioWidgets.appex'
        extension_info = validate_extension(extension, info['CFBundleShortVersionString'])
        prepared = tmp / 'prepared/FolioWidgets.appex'
        shutil.copytree(extension, prepared)
        extension_info['FolioAppGroup'] = group
        (prepared / 'Contents/Info.plist').write_bytes(plistlib.dumps(extension_info))
        widget_entitlement = tmp / 'widget.entitlements'
        widget_entitlement.write_bytes(plistlib.dumps({
            **embed_profile(prepared, args.profiles_dir, 'dev.hermes.surface.widgets', args.team),
            'com.apple.security.app-sandbox': True,
            'com.apple.security.application-groups': [group],
            **({'com.apple.security.get-task-allow': True} if args.development else {}),
        }))
        signing = ['codesign', '--force', '--sign', args.identity, '--options', 'runtime']
        if args.keychain:
            signing += ['--keychain', str(args.keychain.resolve())]
        run(*signing, '--entitlements', str(widget_entitlement), str(prepared))
        run('codesign', '--verify', '--strict', str(prepared))
        check_team(prepared, args.team)
        embedded.parent.mkdir(exist_ok=True)
        shutil.copytree(prepared, embedded)
        info['FolioAppGroup'] = group
        info_path.write_bytes(plistlib.dumps(info))
        entitlement = tmp / 'host.entitlements'
        entitlement.write_bytes(plistlib.dumps({
            **embed_profile(app, args.profiles_dir, 'dev.hermes.surface', args.team),
            **({'com.apple.security.get-task-allow': True} if args.development else {}),
            'com.apple.security.application-groups': [group]}))
        # Framework/native binaries require the same trusted identity. Sign
        # inside-out without a broad --deep signing operation.
        for dylib in (app / 'Contents').rglob('*.dylib'):
            if 'FolioWidgets.appex' not in dylib.parts:
                run(*signing, str(dylib))
        run(*signing, '--entitlements', str(entitlement), str(app))
        run('codesign', '--verify', '--deep', '--strict', str(app))
        check_team(app, args.team)
    print(json.dumps({'app': str(app), 'appGroup': group, 'widget': 'FolioWidgets.appex'}))


if __name__ == '__main__':
    main()
