"""DubKanka: amateur dubbing studio for friends."""
import os

# The desktop app passes its own version (desktop/package.json); running from source reports the next release.
__version__ = os.environ.get("DUBKANKA_VERSION") or "1.1.1"
