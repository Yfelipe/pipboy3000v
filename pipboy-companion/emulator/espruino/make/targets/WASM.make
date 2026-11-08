# Link a WASI "reactor": no main(); the host calls the exported functions below.
# Set WASI_SDK_PATH to an unpacked https://github.com/WebAssembly/wasi-sdk release.

ifndef WASI_SDK_PATH
$(error WASI_SDK_PATH is not set (see emulator/build.sh))
endif

export CC=$(WASI_SDK_PATH)/bin/clang --target=wasm32-wasip1 --sysroot=$(WASI_SDK_PATH)/share/wasi-sysroot
export LD=$(CC)

# The Makefile defines OPTIMIZEFLAGS (empty) before including this file
ifeq ($(strip $(OPTIMIZEFLAGS)),)
OPTIMIZEFLAGS = -O2
endif
LDFLAGS += -mexec-model=reactor \
  -Wl,--strip-debug \
  -Wl,-z,stack-size=1048576 \
  -Wl,--initial-memory=16777216 \
  -Wl,--export=jsInit \
  -Wl,--export=jsIdle \
  -Wl,--export=jsKill \
  -Wl,--export=jshPushIOCharEvent \
  -Wl,--export=jshGetDeviceToTransmit \
  -Wl,--export=jshGetCharToTransmit \
  -Wl,--export=wasmConsoleDevice \
  -Wl,--export=wasmSendPinWatchEvent \
  -Wl,--export=wasmPinFromName \
  -Wl,--export=wasmAlloc \
  -Wl,--export=wasmFree \
  -Wl,--export=wasmStorageWrite \
  -Wl,--export=wasmFlashBuffer \
  -Wl,--export=wasmFlashSize \
  -Wl,--export=wasmLcdBuffer \
  -Wl,--export=wasmLcdWidth \
  -Wl,--export=wasmLcdHeight \
  -Wl,--export=wasmLcdTakeDirty

proj: $(PLATFORM_CONFIG_FILE) $(PROJ_NAME)

$(PROJ_NAME): $(OBJS)
	@echo $($(quiet_)link)
	@$(call link)
