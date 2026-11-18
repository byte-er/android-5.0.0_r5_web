wl12xx-objs		= main.o cmd.o io.o event.o tx.o rx.o ps.o acx.o \
			  boot.o init.o debugfs.o scan.o

# The version string used to come from "git describe" in TI's development
# tree; this copy is not a git checkout, so use a fixed string.
define filechk_version.h
	(echo 'static const char *wl12xx_timestamp = __TIMESTAMP__;'; \
	echo 'static const char *wl12xx_git_head = "ti-compat-wl12xx-r5.SP3";')
endef

$(obj)/version.h: $(src)/Makefile
	@$(call filechk,version.h)

$(obj)/main.c: $(src)/version.h

# convert all wl12xx-objs to $(src)/file form
define WL12XX_OBJS_SRC
$(shell echo $(wl12xx-objs) |
	awk '{for (i=1;i<=NF;i++) {printf "$(src)/%s ", $$i} }')
endef

wl12xx_spi-objs 	= spi.o
wl12xx_sdio-objs	= sdio.o

wl12xx-$(CONFIG_NL80211_TESTMODE)	+= testmode.o
obj-$(CONFIG_WL12XX)			+= wl12xx.o
obj-$(CONFIG_WL12XX_SPI)		+= wl12xx_spi.o
obj-$(CONFIG_COMPAT_WL12XX_SDIO)		+= wl12xx_sdio.o

# small builtin driver bit
obj-$(CONFIG_WL12XX_PLATFORM_DATA)	+= wl12xx_platform_data.o
