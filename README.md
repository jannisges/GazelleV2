# DMX Lighting Control System

A comprehensive web-based DMX lighting control system designed to run on Raspberry Pi. This application allows you to create synchronized light shows with music, manage DMX devices, and control lighting sequences through an intuitive web interface.

## Features

### Core Functionality
- **Audio Synchronization**: Upload MP3, WAV, FLAC, or AIFF files and sync lighting sequences
- **Waveform Visualization**: Interactive waveform display with zoom and timeline controls
- **Sequence Editor**: Create and edit lighting events with precise timing
- **2D Light Preview**: Real-time visualization of light fixtures and their current state
- **DMX Output**: Direct DMX512 output via GPIO on Raspberry Pi (MAX485 interface)

### Device Management
- **Device Creation**: Define custom lighting devices with multiple channel types
- **Device Templates**: Pre-built templates for common lighting fixtures
- **DMX Patching**: Drag-and-drop device patching to DMX addresses (1-512)
- **2D Positioning**: Visual placement of fixtures in a 2D plan view

### Playlist & Sequence Management
- **Sequence Storage**: Save and organize lighting sequences
- **Playlist Creation**: Group sequences into playlists with random mode support
- **Sequence Editing**: Load existing sequences for modification
- **Import/Export**: Backup and share sequences and settings

### Hardware Integration
- **GPIO Button Control**: Physical button for triggering sequence playback
- **Automatic Playback**: Button-triggered playlist rotation
- **Hardware DMX Output**: Professional DMX512 signal generation

### System Features
- **WiFi Management**: Connect to networks or create hotspot mode
- **Storage Management**: Monitor internal storage and manage external devices
- **Security**: Optional web interface password protection
- **Settings Backup**: Export/import complete system configuration

## Hardware Requirements

### Raspberry Pi Setup
- **Raspberry Pi 4B** (recommended) or 3B+
- **MicroSD Card**: 32GB+ (Class 10)
- **Power Supply**: 5V 3A USB-C
- **Audio Output**: 3.5mm jack or USB audio interface
- **Network**: WiFi or Ethernet connection

### DMX Interface
- **MAX485E IC**: RS-485 transceiver
- **3-pin XLR Connector**: DMX output
- **Resistors**: 120Ω termination, pull-up/pull-down as needed

### Wiring Diagram
```
Raspberry Pi GPIO14 (TXD) -> MAX485E DI (Data Input)
Raspberry Pi GPIO18      -> Button (Pull-up enabled)
MAX485E A               -> XLR Pin 3 (DMX+)
MAX485E B               -> XLR Pin 2 (DMX-)
XLR Pin 1               -> Ground
```

### Optional Components
- **Speakers/Headphones**: Connected to 3.5mm jack
- **External Storage**: USB drives for additional storage
- **Case**: For protection and professional appearance

## Software Installation

### Prerequisites
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install system dependencies
sudo apt install -y python3 python3-pip python3-venv git
sudo apt install -y portaudio19-dev python3-dev
sudo apt install -y ffmpeg libavcodec-extra

# Enable GPIO and SPI
sudo raspi-config
# Navigate to Interface Options -> Enable SPI and GPIO
```

### Application Setup
1. **Clone the repository**:
```bash
cd /home/pi
git clone <repository-url> GazelleV2
cd GazelleV2
```

2. **Create virtual environment**:
```bash
python3 -m venv venv
source venv/bin/activate
```

3. **Install Python dependencies**:
```bash
pip install -r requirements.txt
```

4. **Initialize the database**:
```bash
python3 app.py
# Press Ctrl+C after "Running on http://0.0.0.0:5000"
```

5. **Create upload directory**:
```bash
mkdir -p uploads
chmod 755 uploads
```

### Service Installation (Auto-start)
1. **Create systemd service**:
```bash
sudo nano /etc/systemd/system/dmx-control.service
```

2. **Add service configuration**:
```ini
[Unit]
Description=DMX Lighting Control System
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/GazelleV2
Environment=PATH=/home/pi/GazelleV2/venv/bin
ExecStart=/home/pi/GazelleV2/venv/bin/python app.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. **Enable the service**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable dmx-control.service
sudo systemctl start dmx-control.service
```

## Testing Instructions

### 1. Basic Web Interface Test
```bash
# Start the application manually
cd /home/pi/GazelleV2
source venv/bin/activate
python3 app.py
```

Open a web browser and navigate to:
- Local: `http://localhost:5000`
- Network: `http://[pi-ip-address]:5000`

Verify all pages load:
- Main application page
- Patch page
- Create Device page
- Manage Sequences page
- Settings page

### 2. Device Creation Test
1. Navigate to "Create Device" page
2. Try device templates:
   - Click "RGB Par Can" template
   - Verify channels are populated correctly
   - Save device and check it appears in Patch page

### 3. DMX Patching Test
1. Go to Patch page
2. Drag a device from the library to DMX address 1
3. Verify the address boxes show as "occupied"
4. Check 2D plan view shows the fixture
5. Try moving fixtures in 2D view

### 4. Audio Upload Test
1. Go to Main page
2. Click "Upload Audio"
3. Select a test audio file (MP3/WAV)
4. Verify waveform appears
5. Check duration and song info display correctly

### 5. Sequence Creation Test
1. With audio loaded, right-click on sequence timeline
2. Add a dimmer event at 5 seconds
3. Save the sequence
4. Check it appears in Manage Sequences

### 6. Hardware Tests (Raspberry Pi only)

#### GPIO Button Test
```bash
# Install GPIO test script
nano test_button.py
```

```python
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(18, GPIO.IN, pull_up_down=GPIO.PUD_UP)

print("Press button (GPIO18) - Ctrl+C to exit")
try:
    while True:
        if GPIO.input(18) == GPIO.LOW:
            print("Button pressed!")
            time.sleep(0.5)
        time.sleep(0.1)
except KeyboardInterrupt:
    GPIO.cleanup()
```

```bash
python3 test_button.py
```

#### DMX Output Test
```bash
# Install DMX test script
nano test_dmx.py
```

```python
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(14, GPIO.OUT)

def send_dmx_break():
    GPIO.output(14, GPIO.LOW)
    time.sleep(0.000088)
    GPIO.output(14, GPIO.HIGH)
    time.sleep(0.000008)

def send_byte(byte_value):
    # Start bit
    GPIO.output(14, GPIO.LOW)
    time.sleep(0.000004)
    
    # Data bits
    for i in range(8):
        bit = (byte_value >> i) & 1
        GPIO.output(14, GPIO.HIGH if bit else GPIO.LOW)
        time.sleep(0.000004)
    
    # Stop bits
    GPIO.output(14, GPIO.HIGH)
    time.sleep(0.000008)

print("Sending DMX test pattern...")
try:
    while True:
        send_dmx_break()
        send_byte(0)  # Start code
        
        # Send 512 channels
        for i in range(512):
            value = (i + int(time.time())) % 256
            send_byte(value)
        
        time.sleep(0.04)  # 25 FPS
except KeyboardInterrupt:
    GPIO.cleanup()
```

```bash
python3 test_dmx.py
```

### 7. Network Access Test
1. Connect to WiFi via Settings page
2. Access interface from another device on network
3. Test hotspot mode functionality
4. Verify all features work over network

### 8. Performance Tests
- Upload large audio files (>10MB)
- Create sequences with 100+ events
- Test multiple simultaneous connections
- Monitor system resources

## Development Testing (Windows/Linux)

For development without Raspberry Pi hardware:

### 1. Setup Virtual Environment
```bash
git clone <repository-url>
cd GazelleV2
python -m venv venv

# Windows
venv\Scripts\activate

# Linux/Mac
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Mock Hardware Mode
The application automatically detects if RPi.GPIO is available and falls back to simulation mode.

### 3. Run Application
```bash
python app.py
```

Access at `http://localhost:5000`

### 4. Test Features
All web interface features work in development mode:
- Device creation and patching
- Audio upload and waveform display
- Sequence creation and editing
- Settings management

GPIO and DMX functions are simulated with console output.

## API Documentation

### Device Management
- `POST /api/save-device` - Create/update device
- `GET /api/get-device/<id>` - Get device details
- `DELETE /api/delete-device` - Delete device

### Patching
- `POST /api/patch-device` - Patch device to DMX address
- `POST /api/unpatch-device` - Remove patch
- `GET /api/patched-devices` - Get all patches

### Sequences
- `POST /api/save-sequence` - Save sequence
- `GET /api/get-sequence/<id>` - Get sequence
- `DELETE /api/delete-sequence` - Delete sequence
- `POST /api/play-sequence-by-id` - Play sequence

### Playback Control
- `POST /api/stop-sequence` - Stop playback
- `POST /api/blackout` - Blackout all lights
- `GET /api/playback-status` - Get current status

### System Management
- `GET /api/storage-info` - Storage information
- `GET /api/network-status` - Network status
- `GET /api/wifi-networks` - Available networks

## Troubleshooting

### Common Issues

1. **Audio files won't upload**
   - Check file format (MP3, WAV, FLAC, AIFF)
   - Verify uploads directory exists and is writable
   - Check available storage space

2. **DMX output not working**
   - Verify GPIO wiring to MAX485E
   - Check 120Ω termination on DMX line
   - Test with DMX tester or oscilloscope

3. **Button not responding**
   - Check GPIO18 wiring
   - Verify pull-up resistor or enable internal pull-up
   - Test with multimeter

4. **Web interface slow**
   - Check available RAM (minimum 1GB free)
   - Reduce audio file sizes
   - Clear browser cache

5. **WiFi connection issues**
   - Verify network credentials
   - Check signal strength
   - Try manual network configuration

### Log Files
```bash
# Application logs
sudo journalctl -u dmx-control.service -f

# System logs
sudo journalctl -f

# Check service status
sudo systemctl status dmx-control.service
```

### Reset to Factory Defaults
1. Stop the service: `sudo systemctl stop dmx-control.service`
2. Delete database: `rm dmx_control.db`
3. Clear uploads: `rm -rf uploads/*`
4. Restart service: `sudo systemctl start dmx-control.service`

## Support and Contributing

### Getting Help
- Check troubleshooting section
- Review log files for errors
- Test hardware connections
- Verify software dependencies

### Contributing
1. Fork the repository
2. Create a feature branch
3. Make changes and test thoroughly
4. Submit a pull request

### License
This project is open source. Please check the LICENSE file for details.

## Safety Considerations

⚠️ **Important Safety Notes**:
- DMX signals can reach 5V - ensure proper isolation
- Use proper fusing for lighting equipment
- Follow electrical safety standards in your region
- Test thoroughly before connecting expensive equipment
- Consider professional installation for permanent setups

---

*This project is designed for educational and hobbyist use. For professional installations, consult with qualified lighting technicians.*