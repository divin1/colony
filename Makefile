BUN       := $(shell which bun || echo ~/.bun/bin/bun)
INSTALL   := $(HOME)/.local/bin/colony
WEB_DIR   := $(HOME)/.local/share/colony/web
OUTFILE   := colony

# Detect platform
_OS   := $(shell uname -s | tr '[:upper:]' '[:lower:]')
_ARCH := $(shell uname -m)

ifeq ($(_ARCH),x86_64)
  _ARCH := x64
else ifeq ($(_ARCH),aarch64)
  _ARCH := arm64
endif

TARGET := bun-$(_OS)-$(_ARCH)

.PHONY: build build-web install clean

## Build the colony binary for the current platform
build:
	$(BUN) build --compile \
		--target=$(TARGET) \
		packages/cli/src/index.ts \
		--outfile $(OUTFILE)
	@echo "Built: $(OUTFILE) ($(TARGET))"

## Build the web UI static files
build-web:
	cd packages/web && $(BUN) run build
	@echo "Built: packages/web/out/"

## Build binary + web UI and install both
install: build build-web
	@mkdir -p $(dir $(INSTALL))
	cp $(OUTFILE) $(INSTALL)
	@echo "Installed: $(INSTALL)"
	@mkdir -p $(WEB_DIR)
	rm -rf $(WEB_DIR)
	cp -r packages/web/out $(WEB_DIR)
	@echo "Installed: $(WEB_DIR)"
	@$(INSTALL) --version

## Remove local build artifacts
clean:
	rm -f $(OUTFILE)
	rm -rf packages/web/out packages/web/.next
