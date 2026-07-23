#!/bin/bash
echo "Avvio di Google Chrome con accelerazione hardware NVIDIA RTX 4090 e WebGL abilitato..."
__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia google-chrome-stable --ignore-gpu-blocklist --enable-gpu --disable-gpu-sandbox --no-sandbox --user-data-dir=/tmp/chrome_temp_profile http://localhost:8000
