#!/bin/sh
# Colony install script
# Usage: curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
#
# Options (environment variables):
#   COLONY_VERSION      specific version tag, e.g. v0.2.0 (default: latest)
#   COLONY_INSTALL_DIR  installation directory (default: ~/.local/bin)

set -eu

REPO="divin1/colony"
BINARY_NAME="colony"
INSTALL_DIR="${COLONY_INSTALL_DIR:-$HOME/.local/bin}"
WEB_DIR="$HOME/.local/share/colony"

# Detect OS
OS=$(uname -s)
case "$OS" in
  Linux*)  OS="linux"  ;;
  Darwin*) OS="darwin" ;;
  *) echo "Error: unsupported OS: $OS" >&2; exit 1 ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        ARCH="x64"   ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Error: unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

PLATFORM="${OS}-${ARCH}"
TARBALL="${BINARY_NAME}-${PLATFORM}.tar.gz"

# Resolve download URL
if [ -n "${COLONY_VERSION:-}" ]; then
  URL="https://github.com/${REPO}/releases/download/${COLONY_VERSION}/${TARBALL}"
else
  URL="https://github.com/${REPO}/releases/latest/download/${TARBALL}"
fi

echo "Installing colony for ${PLATFORM}..."

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$WEB_DIR"

# Download and extract tarball
TMPDIR=$(mktemp -d)
TMPFILE="${TMPDIR}/${TARBALL}"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL --progress-bar "$URL" -o "$TMPFILE"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$TMPFILE" "$URL"
else
  echo "Error: curl or wget is required" >&2
  rm -rf "$TMPDIR"
  exit 1
fi

tar -xzf "$TMPFILE" -C "$TMPDIR"

# Install binary
DEST="${INSTALL_DIR}/${BINARY_NAME}"
cp "${TMPDIR}/colony" "$DEST"
chmod +x "$DEST"

# Install web UI
rm -rf "${WEB_DIR}/web"
cp -r "${TMPDIR}/web" "${WEB_DIR}/web"

rm -rf "$TMPDIR"

echo ""
echo "Installed: ${DEST}"
echo "Web UI:    ${WEB_DIR}/web"

# Verify the binary works
if "$DEST" --version >/dev/null 2>&1; then
  VERSION=$("$DEST" --version)
  echo "Version:   ${VERSION}"
fi

# Check if INSTALL_DIR is already on PATH
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    echo ""
    echo "colony is ready. Run 'colony --help' to get started."
    ;;
  *)
    echo ""
    echo "Add colony to your PATH by adding this line to your shell config"
    echo "(~/.bashrc, ~/.zshrc, ~/.profile, etc.):"
    echo ""
    echo "  export PATH=\"\$PATH:${INSTALL_DIR}\""
    echo ""
    echo "Then open a new shell and run: colony --help"
    ;;
esac
