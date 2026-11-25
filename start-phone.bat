@echo off
cd /d "%~dp0"
echo Open the address below in Chrome on your phone (phone and PC on the same Wi-Fi).
echo If Windows asks about the firewall, allow Python on private networks.
echo.
python serve.py --phone
