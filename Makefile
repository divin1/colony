BUN       := $(shell which bun || echo ~/.bun/bin/bun)
INSTALL   := $(HOME)/.local/bin/colony
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

.PHONY: build install clean

## Build the colony binary for the current platform
build:
	$(BUN) build --compile \
		--target=$(TARGET) \
		packages/cli/src/index.ts \
		--outfile $(OUTFILE)
	@echo "Built: $(OUTFILE) ($(TARGET))"

## Build and replace the installed colony binary
install: build
	@mkdir -p $(dir $(INSTALL))
	cp $(OUTFILE) $(INSTALL)
	@echo "Installed: $(INSTALL)"
	@$(INSTALL) --version

## Remove the local build artifact
clean:
	rm -f $(OUTFILE)
