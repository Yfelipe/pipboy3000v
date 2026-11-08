# WebAssembly (WASI) family: Espruino as a library driven by a JavaScript host.
#
# -DLINUX selects the POSIX code paths in the filesystem and Pip-Boy libraries (fopen,
# readdir, stat), which WASI's libc provides over the host's virtual filesystem.
# Nothing from targets/linux is used; the hardware layer is targets/wasm.

DEFINES += -DLINUX -DWASM
INCLUDE += -I$(ROOT)/targets/wasm
SOURCES += \
targets/wasm/main.c \
targets/wasm/jshardware.c \
targets/wasm/lcd_wasm.c

CFLAGS_C_COMPILER += -std=gnu99
CFLAGS += -Wno-unused-function -Wno-switch -Wno-unused-but-set-variable
# WASI libc keeps some POSIX/BSD functions behind feature macros
DEFINES += -D_WASI_EMULATED_SIGNAL -D_GNU_SOURCE
LIBS += -lwasi-emulated-signal
