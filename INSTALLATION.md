# DMX Lighting Control - Installation Guide

## Quick Start for Testing (Windows/Linux/Mac)

If you want to test the application without a Raspberry Pi:

### 1. Install Python Dependencies
```bash
# Clone the repository
git clone <repository-url> GazelleV2
cd GazelleV2

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Run the Application
```bash
python app.py
```

### 3. Access the Web Interface
Open your browser and go to: `http://localhost:5000`

### 4. Test Features
- Create devices using templates
- Upload audio files (MP3, WAV)
- Create lighting sequences
- Test the web interface

Note: GPIO and DMX output will be simulated on non-Raspberry Pi systems.

## Full Raspberry Pi Installation

### Hardware Setup

#### Required Components
- Raspberry Pi 4B (4GB+ recommended)
- MicroSD card (32GB+ Class 10)
- MAX485E transceiver module
- 3-pin XLR connector (male)
- Momentary push button
- Jumper wires
- Breadboard (optional)

#### Wiring Connections
```
Raspberry Pi -> MAX485E
GPIO14 (Pin 8) -> DI (Data Input)
3.3V (Pin 1)   -> VCC
GND (Pin 6)    -> GND

MAX485E -> XLR Connector
A -> XLR Pin 3 (DMX+)
B -> XLR Pin 2 (DMX-)
GND -> XLR Pin 1 (Ground)

Button Connection:
GPIO18 (Pin 12) -> One side of button
GND (Pin 14)    -> Other side of button
```

#### XLR Pinout (Male connector)
```
  1
 / \
3   2

Pin 1: Ground (Shield)
Pin 2: DMX- (Data Complement)
Pin 3: DMX+ (Data True)
```

### Software Installation

#### 1. Prepare Raspberry Pi OS
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y python3 python3-pip python3-venv git
sudo apt install -y portaudio19-dev python3-dev
sudo apt install -y ffmpeg libavcodec-extra
sudo apt install -y alsa-utils

# Enable GPIO, SPI, and I2C
sudo raspi-config
# Navigate to Interface Options -> Enable GPIO, SPI
```

#### 2. Install Application
```bash
# Change to home directory
cd /home/pi

# Clone repository
git clone <repository-url> GazelleV2
cd GazelleV2

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Create necessary directories
mkdir -p uploads
mkdir -p backups
chmod 755 uploads backups

# Test installation
python3 app.py
```

Press Ctrl+C after seeing "Running on http://0.0.0.0:5000"

#### 3. Configure Auto-Start Service
```bash
# Create systemd service file
sudo nano /etc/systemd/system/dmx-control.service
```

Add this content:
```ini
[Unit]
Description=DMX Lighting Control System
After=network.target sound.target

[Service]
Type=simple
User=pi
Group=pi
WorkingDirectory=/home/pi/GazelleV2
Environment=PATH=/home/pi/GazelleV2/venv/bin
Environment=PYTHONPATH=/home/pi/GazelleV2
ExecStart=/home/pi/GazelleV2/venv/bin/python app.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable dmx-control.service
sudo systemctl start dmx-control.service

# Check status
sudo systemctl status dmx-control.service
```

#### 4. Configure Audio (Optional)
```bash
# Set default audio output to 3.5mm jack
sudo raspi-config
# Navigate to Advanced Options -> Audio -> Force 3.5mm

# Test audio output
speaker-test -t sine -f 1000 -c 2 -s 1

# Install additional audio packages if needed
sudo apt install -y pulseaudio pulseaudio-utils
```

#### 5. Configure Network Access
The application runs on port 5000. To access from other devices:

```bash
# Find Pi's IP address
hostname -I

# Access from browser on same network:
# http://[PI_IP_ADDRESS]:5000
```

### Advanced Configuration

#### 1. Change Default Port
Edit `app.py` and change the last line:
```python
app.run(host='0.0.0.0', port=8080, debug=False)  # Change port to 8080
```

#### 2. Enable HTTPS (Optional)
```bash
# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Modify app.py to use SSL
app.run(host='0.0.0.0', port=5000, ssl_context=('cert.pem', 'key.pem'))
```

#### 3. Configure Firewall
```bash
# Install ufw if not present
sudo apt install ufw

# Allow SSH and web interface
sudo ufw allow ssh
sudo ufw allow 5000/tcp

# Enable firewall
sudo ufw enable
```

#### 4. Set Up Backup Script
```bash
# Create backup script
nano /home/pi/backup_dmx.sh
```

Add:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/pi/GazelleV2/backups"
SOURCE_DIR="/home/pi/GazelleV2"

# Create backup directory if it doesn't exist
mkdir -p $BACKUP_DIR

# Backup database and uploads
tar -czf "$BACKUP_DIR/dmx_backup_$DATE.tar.gz" \
    "$SOURCE_DIR/dmx_control.db" \
    "$SOURCE_DIR/uploads" \
    "$SOURCE_DIR/static" \
    "$SOURCE_DIR/templates"

# Keep only last 10 backups
ls -t $BACKUP_DIR/dmx_backup_*.tar.gz | tail -n +11 | xargs -r rm

echo "Backup completed: dmx_backup_$DATE.tar.gz"
```

Make executable and add to crontab:
```bash
chmod +x /home/pi/backup_dmx.sh

# Add to crontab (daily backup at 2 AM)
crontab -e
# Add this line:
# 0 2 * * * /home/pi/backup_dmx.sh
```

## Testing the Installation

### 1. Basic Functionality Test
```bash
# Check service status
sudo systemctl status dmx-control.service

# View logs
sudo journalctl -u dmx-control.service -f
```

Access web interface: `http://[PI_IP]:5000`

### 2. Hardware Test Scripts

#### Button Test
```bash
nano test_button.py
```

```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

BUTTON_PIN = 18

GPIO.setmode(GPIO.BCM)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

print("Button test - Press Ctrl+C to exit")
print("GPIO18 should be connected to button")

try:
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.LOW:
            print("Button pressed!")
            time.sleep(0.5)  # Debounce
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\nTest stopped")
finally:
    GPIO.cleanup()
```

```bash
python3 test_button.py
```

#### DMX Output Test
```bash
nano test_dmx.py
```

```python
#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time

DMX_PIN = 14

GPIO.setmode(GPIO.BCM)
GPIO.setup(DMX_PIN, GPIO.OUT)

def send_dmx_break():
    GPIO.output(DMX_PIN, GPIO.LOW)
    time.sleep(0.000088)  # 88µs break
    GPIO.output(DMX_PIN, GPIO.HIGH)
    time.sleep(0.000008)  # 8µs mark after break

def send_byte(value):
    # Start bit (LOW)
    GPIO.output(DMX_PIN, GPIO.LOW)
    time.sleep(0.000004)  # 4µs per bit
    
    # 8 data bits (LSB first)
    for i in range(8):
        bit = (value >> i) & 1
        GPIO.output(DMX_PIN, GPIO.HIGH if bit else GPIO.LOW)
        time.sleep(0.000004)
    
    # 2 stop bits (HIGH)
    GPIO.output(DMX_PIN, GPIO.HIGH)
    time.sleep(0.000008)

print("DMX test - sending rainbow pattern")
print("Connect oscilloscope to GPIO14 to verify signal")
print("Press Ctrl+C to stop")

try:
    frame = 0
    while True:
        # Send DMX frame
        send_dmx_break()
        send_byte(0)  # Start code
        
        # Send 512 channels with moving rainbow
        for channel in range(1, 513):
            value = int(127 + 127 * time.sin((frame + channel) * 0.1))
            send_byte(value)
        
        frame += 1
        time.sleep(0.04)  # ~25 FPS
        
        if frame % 25 == 0:
            print(f"Frame {frame} sent")
            
except KeyboardInterrupt:
    print("\nTest stopped")
finally:
    GPIO.cleanup()
```

```bash
python3 test_dmx.py
```

### 3. Audio Test
```bash
# Test audio playback
aplay /usr/share/sounds/alsa/Front_Left.wav

# Test with application
# Upload an audio file through web interface
# Create a simple sequence and test playback
```

### 4. Network Access Test
From another device on the same network:
1. Open web browser
2. Navigate to `http://[PI_IP_ADDRESS]:5000`
3. Test all functionality
4. Verify real-time updates work

## Troubleshooting Common Issues

### Service Won't Start
```bash
# Check logs
sudo journalctl -u dmx-control.service -n 50

# Common issues:
# 1. Python dependencies missing
sudo /home/pi/GazelleV2/venv/bin/pip install -r /home/pi/GazelleV2/requirements.txt

# 2. Permission issues
sudo chown -R pi:pi /home/pi/GazelleV2
chmod +x /home/pi/GazelleV2/app.py

# 3. Database issues
cd /home/pi/GazelleV2
rm dmx_control.db
source venv/bin/activate
python3 -c "from app import db; db.create_all()"
```

### Web Interface Not Accessible
```bash
# Check if port is open
sudo netstat -tlnp | grep :5000

# Check firewall
sudo ufw status

# Allow port if needed
sudo ufw allow 5000/tcp
```

### GPIO Permissions
```bash
# Add user to gpio group
sudo usermod -a -G gpio pi

# Reboot
sudo reboot
```

### Audio Issues
```bash
# Check audio devices
aplay -l

# Set default device
sudo nano /etc/asound.conf
```

Add:
```
pcm.!default {
    type hw
    card 0
    device 0
}
ctl.!default {
    type hw
    card 0
}
```

### DMX Signal Issues
- Verify MAX485E wiring
- Check 120Ω termination on DMX line
- Use oscilloscope to verify signal on GPIO14
- Test with known-good DMX device

### Button Not Working
- Check wiring to GPIO18
- Verify button is normally open
- Test with multimeter
- Check internal pull-up is enabled

## Performance Optimization

### For Raspberry Pi 4
```bash
# Increase GPU memory
sudo nano /boot/config.txt
# Add: gpu_mem=128

# Disable unnecessary services
sudo systemctl disable bluetooth
sudo systemctl disable wifi-powersave@wlan0.service

# Optimize audio buffer
sudo nano /etc/pulse/daemon.conf
# Uncomment and set:
# default-sample-rate = 44100
# default-fragment-size-msec = 25
```

### For Large Audio Files
- Use lower quality audio files for testing
- Consider external USB storage for large libraries
- Monitor SD card wear with large files

### Memory Management
```bash
# Monitor memory usage
free -h
htop

# Set up swap if needed (not recommended for SD cards)
# Use USB storage for swap instead
```

## Updating the Application

```bash
# Stop service
sudo systemctl stop dmx-control.service

# Backup current installation
cd /home/pi
tar -czf dmx_backup_$(date +%Y%m%d).tar.gz GazelleV2/

# Pull updates
cd GazelleV2
git pull origin main

# Update dependencies
source venv/bin/activate
pip install -r requirements.txt

# Restart service
sudo systemctl start dmx-control.service

# Check status
sudo systemctl status dmx-control.service
```

This completes the installation guide. The system should now be ready for creating professional lighting shows synchronized to music!