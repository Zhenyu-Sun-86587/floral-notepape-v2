"""Construct the production WidgetKit configurations without launching a widget."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
native = root / 'src-tauri/native'
source = (native / 'widgets/FolioWidgets.swift').read_text()
entrypoint = '@main\nstruct FolioWidgets:'
if source.count(entrypoint) != 1:
    raise RuntimeError('WidgetBundle entry point changed; update the configuration test harness.')

with tempfile.TemporaryDirectory(prefix='folio-widget-configuration-') as directory:
    directory = Path(directory)
    library = directory / 'FolioWidgets.swift'
    # Use the real production definitions; only the test owns an executable entry point.
    library.write_text(source.replace(entrypoint, 'struct FolioWidgets:'))
    binary = directory / 'configuration-check'
    subprocess.run([
        'xcrun', 'swiftc', '-O', '-parse-as-library',
        str(native / 'widgets/Shared.swift'), str(native / 'widgets/Markdown.swift'),
        str(library), str(native / 'tests/WidgetConfiguration.swift'), '-o', str(binary)
    ], check=True)
    subprocess.run([str(binary)], check=True)
