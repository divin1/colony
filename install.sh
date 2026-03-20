#!/bin/sh
# Colony install script
# Usage: curl -fsSL https://raw.githubusercontent.com/divin1/colony/main/install.sh | sh
#
# Options (environment variables):
#   COLONY_VERSION    specific version tag, e.g. v0.2.0 (default: latest)
#   COLONY_INSTALL_DIR  installation directory (default: ~/.local/bin)

set -eu

REPO="divin1/colony"
BINARY_NAME="colony"
INSTALL_DIR="${COLONY_INSTALL_DIR:-$HOME/.local/bin}"

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
BINARY="${BINARY_NAME}-${PLATFORM}"

# Resolve download URL
if [ -n "${COLONY_VERSION:-}" ]; then
  URL="https://github.com/${REPO}/releases/download/${COLONY_VERSION}/${BINARY}"
else
  URL="https://github.com/${REPO}/releases/latest/download/${BINARY}"
fi

echo "Installing colony for ${PLATFORM}..."

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

# Download binary
DEST="${INSTALL_DIR}/${BINARY_NAME}"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --progress-bar "$URL" -o "$DEST"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$DEST" "$URL"
else
  echo "Error: curl or wget is required" >&2
  exit 1
fi

chmod +x "$DEST"

echo ""
echo "Installed: ${DEST}"

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
