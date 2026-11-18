#!/system/bin/sh
# Reset the u-boot boot counter (u-boot forces recovery after 8 boots that
# never reached this point).
dd if=/dev/zero of=/rom/devconf/BootCnt bs=4 count=1
