#!/bin/bash

# DMX Lighting Control System - Raspberry Pi Installer
# This script automates the complete installation process

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="DMX Lighting Control"
APP_DIR="/home/pi/GazelleV2"
SERVICE_NAME="dmx-control"
PYTHON_VERSION="3.9"
USER="pi"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root. Please run as the 'pi' user."
        print_status "Usage: ./install.sh"
        exit 1
    fi
}

# Function to check if running on Raspberry Pi
check_raspberry_pi() {
    if [[ ! -f /proc/device-tree/model ]] || ! grep -q "Raspberry Pi" /proc/device-tree/model 2>/dev/null; then
        print_warning "This doesn't appear to be a Raspberry Pi."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Installation cancelled."
            exit 1
        fi
    else
        PI_MODEL=$(cat /proc/device-tree/model)
        print_success "Detected: $PI_MODEL"
    fi
}

# Function to check available disk space
check_disk_space() {
    AVAILABLE_SPACE=$(df / | awk 'NR==2 {print $4}')
    REQUIRED_SPACE=2097152  # 2GB in KB
    
    if [[ $AVAILABLE_SPACE -lt $REQUIRED_SPACE ]]; then
        print_error "Insufficient disk space. At least 2GB free space required."
        print_status "Available: $(($AVAILABLE_SPACE / 1024))MB, Required: 2048MB"
        exit 1
    fi
    
    print_success "Sufficient disk space available: $(($AVAILABLE_SPACE / 1024))MB"
}

# Function to update system packages
update_system() {
    print_status "Updating system packages..."
    
    sudo apt update
    sudo apt upgrade -y
    
    print_success "System packages updated"
}

# Function to install system dependencies
install_system_dependencies() {
    print_status "Installing system dependencies..."
    
    # Core dependencies
    sudo apt install -y \
        python3 \
        python3-pip \
        python3-venv \
        python3-dev \
        git \
        curl \
        wget \
        nano \
        htop \
        tree
    
    # Audio dependencies
    sudo apt install -y \
        portaudio19-dev \
        libasound2-dev \
        ffmpeg \
        libavcodec-extra \
        alsa-utils \
        pulseaudio \
        pulseaudio-utils
    
    # Network dependencies
    sudo apt install -y \
        hostapd \
        dnsmasq \
        iptables-persistent \
        wireless-tools \
        wpasupplicant
    
    # Build dependencies
    sudo apt install -y \
        build-essential \
        cmake \
        pkg-config \
        libjpeg-dev \
        libpng-dev \
        libtiff-dev \
        libavcodec-dev \
        libavformat-dev \
        libswscale-dev \
        libgtk-3-dev \
        libcanberra-gtk3-dev \
        libxvidcore-dev \
        libx264-dev \
        libopenexr-dev \
        libatlas-base-dev \
        gfortran
    
    print_success "System dependencies installed"
}

# Function to enable required interfaces
enable_interfaces() {
    print_status "Enabling GPIO, SPI, and I2C interfaces..."
    
    # Enable GPIO
    if ! grep -q "^dtparam=gpio=on" /boot/config.txt; then
        echo "dtparam=gpio=on" | sudo tee -a /boot/config.txt
    fi
    
    # Enable SPI
    if ! grep -q "^dtparam=spi=on" /boot/config.txt; then
        echo "dtparam=spi=on" | sudo tee -a /boot/config.txt
    fi
    
    # Enable I2C
    if ! grep -q "^dtparam=i2c_arm=on" /boot/config.txt; then
        echo "dtparam=i2c_arm=on" | sudo tee -a /boot/config.txt
    fi
    
    # Set GPU memory
    if ! grep -q "^gpu_mem=" /boot/config.txt; then
        echo "gpu_mem=128" | sudo tee -a /boot/config.txt
    fi
    
    # Force audio to 3.5mm jack
    if ! grep -q "^dtparam=audio=on" /boot/config.txt; then
        echo "dtparam=audio=on" | sudo tee -a /boot/config.txt
    fi
    
    print_success "Interfaces enabled (reboot required to take effect)"
}

# Function to add user to required groups
setup_user_permissions() {
    print_status "Setting up user permissions..."
    
    sudo usermod -a -G gpio,spi,i2c,audio,dialout pi
    
    print_success "User permissions configured"
}

# Function to download/clone application
download_application() {
    print_status "Setting up application directory..."
    
    # Remove existing directory if it exists
    if [[ -d "$APP_DIR" ]]; then
        print_warning "Existing installation found at $APP_DIR"
        read -p "Remove existing installation? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$APP_DIR"
            print_success "Existing installation removed"
        else
            print_status "Keeping existing installation, updating files..."
        fi
    fi
    
    # Create directory if it doesn't exist
    if [[ ! -d "$APP_DIR" ]]; then
        mkdir -p "$APP_DIR"
    fi
    
    # If we're in the GazelleV2 directory, copy files
    if [[ $(basename "$PWD") == "GazelleV2" ]]; then
        print_status "Copying application files from current directory..."
        cp -r . "$APP_DIR/"
    else
        print_error "Please run this script from the GazelleV2 directory"
        exit 1
    fi
    
    # Set correct ownership
    sudo chown -R pi:pi "$APP_DIR"
    
    print_success "Application files installed"
}

# Function to create Python virtual environment
setup_python_environment() {
    print_status "Setting up Python virtual environment..."
    
    cd "$APP_DIR"
    
    # Create virtual environment
    python3 -m venv venv
    
    # Activate and upgrade pip
    source venv/bin/activate
    pip install --upgrade pip setuptools wheel
    
    # Install Python dependencies
    print_status "Installing Python dependencies (this may take a while)..."
    pip install -r requirements.txt
    
    deactivate
    
    print_success "Python environment configured"
}

# Function to create necessary directories
create_directories() {
    print_status "Creating application directories..."
    
    cd "$APP_DIR"
    
    mkdir -p uploads
    mkdir -p backups
    mkdir -p logs
    mkdir -p external_storage
    
    chmod 755 uploads backups logs external_storage
    
    print_success "Directories created"
}

# Function to initialize database
initialize_database() {
    print_status "Initializing database..."
    
    cd "$APP_DIR"
    source venv/bin/activate
    
    # Initialize database
    python3 -c "
from app import app, db
with app.app_context():
    db.create_all()
    print('Database initialized successfully')
"
    
    deactivate
    
    print_success "Database initialized"
}

# Function to create systemd service
create_service() {
    print_status "Creating systemd service..."
    
    sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null <<EOF
[Unit]
Description=DMX Lighting Control System
After=network.target sound.target multi-user.target
Wants=network.target

[Service]
Type=simple
User=pi
Group=pi
WorkingDirectory=${APP_DIR}
Environment=PATH=${APP_DIR}/venv/bin
Environment=PYTHONPATH=${APP_DIR}
Environment=PYTHONUNBUFFERED=1
ExecStart=${APP_DIR}/venv/bin/python app.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
TimeoutStartSec=60
TimeoutStopSec=30

# Security settings
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${APP_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    sudo systemctl daemon-reload
    sudo systemctl enable ${SERVICE_NAME}.service
    
    print_success "Systemd service created and enabled"
}

# Function to configure audio
setup_audio() {
    print_status "Configuring audio system..."
    
    # Set default audio output to 3.5mm jack
    sudo tee /etc/asound.conf > /dev/null <<EOF
pcm.!default {
    type hw
    card 0
    device 0
}
ctl.!default {
    type hw
    card 0
}
EOF
    
    # Configure PulseAudio
    if [[ ! -f /home/pi/.config/pulse/client.conf ]]; then
        mkdir -p /home/pi/.config/pulse
        tee /home/pi/.config/pulse/client.conf > /dev/null <<EOF
default-sample-rate = 44100
default-fragment-size-msec = 25
EOF
    fi
    
    print_success "Audio system configured"
}

# Function to configure firewall
setup_firewall() {
    print_status "Configuring firewall..."
    
    # Install and configure ufw
    sudo apt install -y ufw
    
    # Reset to defaults
    sudo ufw --force reset
    
    # Set default policies
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    
    # Allow SSH
    sudo ufw allow ssh
    
    # Allow DMX Control web interface
    sudo ufw allow 5000/tcp comment 'DMX Control Web Interface'
    
    # Allow mDNS
    sudo ufw allow 5353/udp comment 'mDNS'
    
    # Enable firewall
    sudo ufw --force enable
    
    print_success "Firewall configured"
}

# Function to create backup script
create_backup_script() {
    print_status "Creating backup script..."
    
    tee /home/pi/backup_dmx.sh > /dev/null <<'EOF'
#!/bin/bash

# DMX Control System Backup Script
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/pi/GazelleV2/backups"
SOURCE_DIR="/home/pi/GazelleV2"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Starting backup: $DATE"

# Stop service temporarily
sudo systemctl stop dmx-control.service

# Create backup
tar -czf "$BACKUP_DIR/dmx_backup_$DATE.tar.gz" \
    -C "$SOURCE_DIR" \
    dmx_control.db \
    uploads \
    --exclude="*.pyc" \
    --exclude="__pycache__" \
    --exclude="venv" \
    --exclude="logs/*.log"

# Restart service
sudo systemctl start dmx-control.service

# Keep only last 10 backups
ls -t "$BACKUP_DIR"/dmx_backup_*.tar.gz | tail -n +11 | xargs -r rm

echo "Backup completed: dmx_backup_$DATE.tar.gz"
echo "Size: $(ls -lh "$BACKUP_DIR/dmx_backup_$DATE.tar.gz" | awk '{print $5}')"
EOF
    
    chmod +x /home/pi/backup_dmx.sh
    
    # Add to crontab (weekly backup on Sunday at 2 AM)
    (crontab -l 2>/dev/null; echo "0 2 * * 0 /home/pi/backup_dmx.sh") | crontab -
    
    print_success "Backup script created and scheduled"
}

# Function to create test scripts
create_test_scripts() {
    print_status "Creating hardware test scripts..."
    
    # Button test script
    tee "$APP_DIR/test_button.py" > /dev/null <<'EOF'
#!/usr/bin/env python3
"""
DMX Control - Button Test Script
Tests the hardware button connected to GPIO18
"""

import RPi.GPIO as GPIO
import time
import sys

BUTTON_PIN = 18

def test_button():
    print("DMX Control - Button Test")
    print("=" * 40)
    print(f"Testing button on GPIO{BUTTON_PIN}")
    print("Press the button to test (Ctrl+C to exit)")
    print()
    
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    
    try:
        button_pressed = False
        while True:
            current_state = GPIO.input(BUTTON_PIN)
            
            if current_state == GPIO.LOW and not button_pressed:
                print(f"[{time.strftime('%H:%M:%S')}] Button PRESSED!")
                button_pressed = True
            elif current_state == GPIO.HIGH and button_pressed:
                print(f"[{time.strftime('%H:%M:%S')}] Button RELEASED")
                button_pressed = False
            
            time.sleep(0.01)  # 100Hz polling
            
    except KeyboardInterrupt:
        print("\nTest stopped by user")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        GPIO.cleanup()
        print("GPIO cleaned up")

if __name__ == "__main__":
    try:
        test_button()
    except ImportError:
        print("Error: RPi.GPIO not available. This test requires a Raspberry Pi.")
        sys.exit(1)
EOF
    
    # DMX output test script
    tee "$APP_DIR/test_dmx.py" > /dev/null <<'EOF'
#!/usr/bin/env python3
"""
DMX Control - DMX Output Test Script
Tests DMX512 output on GPIO14 with MAX485E interface
"""

import RPi.GPIO as GPIO
import time
import math
import sys

DMX_PIN = 14

class DMXTester:
    def __init__(self):
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(DMX_PIN, GPIO.OUT)
        self.frame_count = 0
        
    def send_break(self):
        """Send DMX break signal"""
        GPIO.output(DMX_PIN, GPIO.LOW)
        time.sleep(0.000088)  # 88µs break
        
    def send_mab(self):
        """Send Mark After Break"""
        GPIO.output(DMX_PIN, GPIO.HIGH)
        time.sleep(0.000008)  # 8µs MAB
        
    def send_byte(self, value):
        """Send a single byte (0-255)"""
        # Start bit (LOW)
        GPIO.output(DMX_PIN, GPIO.LOW)
        time.sleep(0.000004)  # 4µs per bit at 250kbps
        
        # 8 data bits (LSB first)
        for i in range(8):
            bit = (value >> i) & 1
            GPIO.output(DMX_PIN, GPIO.HIGH if bit else GPIO.LOW)
            time.sleep(0.000004)
        
        # 2 stop bits (HIGH)
        GPIO.output(DMX_PIN, GPIO.HIGH)
        time.sleep(0.000008)
    
    def send_frame(self, channels):
        """Send complete DMX frame"""
        self.send_break()
        self.send_mab()
        self.send_byte(0)  # Start code
        
        # Send channel data
        for value in channels:
            self.send_byte(value)
    
    def test_static_pattern(self):
        """Test with static values"""
        print("Testing static pattern (all channels at 50%)...")
        channels = [127] * 512  # 50% on all channels
        
        for i in range(100):  # Send 100 frames
            self.send_frame(channels)
            time.sleep(0.04)  # 25 FPS
            if i % 25 == 0:
                print(f"Sent {i} frames...")
    
    def test_chase_pattern(self):
        """Test with chasing pattern"""
        print("Testing chase pattern...")
        
        for frame in range(512):
            channels = [0] * 512
            channels[frame % 512] = 255  # One channel at 100%
            
            self.send_frame(channels)
            time.sleep(0.04)  # 25 FPS
            
            if frame % 50 == 0:
                print(f"Chase position: {frame % 512}")
    
    def test_rainbow_pattern(self):
        """Test with rainbow color pattern"""
        print("Testing rainbow pattern...")
        
        try:
            while True:
                channels = [0] * 512
                
                # Generate rainbow on first 12 channels (4 RGB fixtures)
                for fixture in range(4):
                    base_channel = fixture * 3
                    if base_channel + 2 < 512:
                        hue = (self.frame_count + fixture * 90) % 360
                        r, g, b = self.hsv_to_rgb(hue, 1.0, 1.0)
                        channels[base_channel] = int(r * 255)
                        channels[base_channel + 1] = int(g * 255)
                        channels[base_channel + 2] = int(b * 255)
                
                self.send_frame(channels)
                self.frame_count += 1
                time.sleep(0.04)  # 25 FPS
                
                if self.frame_count % 25 == 0:
                    print(f"Rainbow frame: {self.frame_count}")
                    
        except KeyboardInterrupt:
            print("Rainbow test stopped")
    
    def hsv_to_rgb(self, h, s, v):
        """Convert HSV to RGB"""
        h = h / 360.0
        i = int(h * 6.0)
        f = (h * 6.0) - i
        p = v * (1.0 - s)
        q = v * (1.0 - s * f)
        t = v * (1.0 - s * (1.0 - f))
        
        if i % 6 == 0:
            return v, t, p
        elif i % 6 == 1:
            return q, v, p
        elif i % 6 == 2:
            return p, v, t
        elif i % 6 == 3:
            return p, q, v
        elif i % 6 == 4:
            return t, p, v
        else:
            return v, p, q
    
    def cleanup(self):
        """Clean up GPIO"""
        GPIO.cleanup()

def main():
    print("DMX Control - DMX Output Test")
    print("=" * 40)
    print(f"Testing DMX output on GPIO{DMX_PIN}")
    print("Connect oscilloscope or DMX tester to verify signal")
    print()
    
    tester = DMXTester()
    
    try:
        print("1. Static pattern test")
        tester.test_static_pattern()
        print()
        
        print("2. Chase pattern test")
        tester.test_chase_pattern()
        print()
        
        print("3. Rainbow pattern test (Ctrl+C to stop)")
        tester.test_rainbow_pattern()
        
    except KeyboardInterrupt:
        print("\nTest stopped by user")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        tester.cleanup()
        print("GPIO cleaned up")

if __name__ == "__main__":
    try:
        main()
    except ImportError:
        print("Error: RPi.GPIO not available. This test requires a Raspberry Pi.")
        sys.exit(1)
EOF
    
    # Make scripts executable
    chmod +x "$APP_DIR/test_button.py"
    chmod +x "$APP_DIR/test_dmx.py"
    
    print_success "Test scripts created"
}

# Function to optimize system performance
optimize_system() {
    print_status "Optimizing system performance..."
    
    # Disable unnecessary services
    sudo systemctl disable bluetooth.service
    sudo systemctl disable hciuart.service
    sudo systemctl disable triggerhappy.service
    
    # Optimize kernel parameters
    if ! grep -q "vm.swappiness" /etc/sysctl.conf; then
        echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
    fi
    
    if ! grep -q "vm.vfs_cache_pressure" /etc/sysctl.conf; then
        echo "vm.vfs_cache_pressure=50" | sudo tee -a /etc/sysctl.conf
    fi
    
    # Optimize audio latency
    if ! grep -q "^audio_pwm_mode" /boot/config.txt; then
        echo "audio_pwm_mode=2" | sudo tee -a /boot/config.txt
    fi
    
    print_success "System optimized"
}

# Function to start services and test
start_and_test() {
    print_status "Starting DMX Control service..."
    
    # Start the service
    sudo systemctl start ${SERVICE_NAME}.service
    
    # Wait a moment for startup
    sleep 5
    
    # Check service status
    if sudo systemctl is-active --quiet ${SERVICE_NAME}.service; then
        print_success "DMX Control service is running!"
        
        # Get IP addresses
        IP_ADDRESSES=$(hostname -I)
        
        print_status "Service Information:"
        echo "  - Service Status: Active"
        echo "  - Web Interface: http://localhost:5000"
        for IP in $IP_ADDRESSES; do
            echo "  - Network Access: http://$IP:5000"
        done
        echo "  - Service Logs: sudo journalctl -u ${SERVICE_NAME}.service -f"
        echo "  - Test Scripts: $APP_DIR/test_button.py, $APP_DIR/test_dmx.py"
        
    else
        print_error "Failed to start DMX Control service"
        print_status "Check logs with: sudo journalctl -u ${SERVICE_NAME}.service -n 50"
        return 1
    fi
}

# Function to create desktop shortcuts
create_desktop_shortcuts() {
    print_status "Creating desktop shortcuts..."
    
    # Create desktop directory if it doesn't exist
    mkdir -p /home/pi/Desktop
    
    # Web interface shortcut
    tee /home/pi/Desktop/DMX-Control.desktop > /dev/null <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=DMX Control
Comment=Open DMX Lighting Control Web Interface
Exec=chromium-browser --app=http://localhost:5000
Icon=applications-multimedia
Terminal=false
Categories=AudioVideo;Audio;
EOF
    
    # Service control shortcut
    tee /home/pi/Desktop/DMX-Service.desktop > /dev/null <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=DMX Service Control
Comment=Control DMX Service
Exec=lxterminal -e "sudo systemctl status dmx-control.service; read -p 'Press Enter to continue...'"
Icon=utilities-system-monitor
Terminal=false
Categories=System;
EOF
    
    chmod +x /home/pi/Desktop/*.desktop
    
    print_success "Desktop shortcuts created"
}

# Function to display installation summary
show_summary() {
    clear
    echo -e "${GREEN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                    INSTALLATION COMPLETE!                    ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo
    echo -e "${BLUE}DMX Lighting Control System${NC} has been successfully installed!"
    echo
    echo -e "${YELLOW}📍 IMPORTANT INFORMATION:${NC}"
    echo
    echo "🌐 Web Interface Access:"
    
    # Get IP addresses
    IP_ADDRESSES=$(hostname -I)
    echo "   • Local: http://localhost:5000"
    for IP in $IP_ADDRESSES; do
        echo "   • Network: http://$IP:5000"
    done
    echo
    
    echo "🔧 Service Management:"
    echo "   • Status: sudo systemctl status dmx-control.service"
    echo "   • Start:  sudo systemctl start dmx-control.service"
    echo "   • Stop:   sudo systemctl stop dmx-control.service"
    echo "   • Logs:   sudo journalctl -u dmx-control.service -f"
    echo
    
    echo "🧪 Hardware Testing:"
    echo "   • Button Test: $APP_DIR/test_button.py"
    echo "   • DMX Test:    $APP_DIR/test_dmx.py"
    echo
    
    echo "💾 File Locations:"
    echo "   • Application: $APP_DIR"
    echo "   • Backups:     $APP_DIR/backups"
    echo "   • Uploads:     $APP_DIR/uploads"
    echo "   • Logs:        $APP_DIR/logs"
    echo
    
    echo -e "${YELLOW}⚠️  NEXT STEPS:${NC}"
    echo "1. Reboot the system to ensure all changes take effect:"
    echo "   sudo reboot"
    echo
    echo "2. After reboot, test the hardware connections:"
    echo "   python3 $APP_DIR/test_button.py"
    echo "   python3 $APP_DIR/test_dmx.py"
    echo
    echo "3. Open the web interface and start creating your light show!"
    echo
    
    echo -e "${GREEN}🎉 Enjoy your new DMX Lighting Control System!${NC}"
    echo
    
    # Ask if user wants to reboot now
    read -p "Would you like to reboot now to complete the installation? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status "Rebooting system..."
        sudo reboot
    else
        print_warning "Please reboot manually when convenient: sudo reboot"
    fi
}

# Main installation function
main() {
    clear
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║           DMX Lighting Control System Installer              ║"
    echo "║                  Raspberry Pi Edition                        ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo
    echo "This script will install and configure the complete DMX Lighting"
    echo "Control System on your Raspberry Pi."
    echo
    echo -e "${YELLOW}What will be installed:${NC}"
    echo "• System dependencies and libraries"
    echo "• Python environment and application"
    echo "• GPIO and hardware interface configuration"
    echo "• Audio system configuration"
    echo "• Network and firewall setup"
    echo "• Auto-start service configuration"
    echo "• Test scripts and tools"
    echo
    echo -e "${YELLOW}Estimated time: 15-30 minutes${NC}"
    echo
    
    read -p "Do you want to continue with the installation? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status "Installation cancelled by user."
        exit 0
    fi
    
    echo
    print_status "Starting installation..."
    
    # Run installation steps
    check_root
    check_raspberry_pi
    check_disk_space
    
    print_status "Step 1/15: Updating system packages..."
    update_system
    
    print_status "Step 2/15: Installing system dependencies..."
    install_system_dependencies
    
    print_status "Step 3/15: Enabling hardware interfaces..."
    enable_interfaces
    
    print_status "Step 4/15: Setting up user permissions..."
    setup_user_permissions
    
    print_status "Step 5/15: Installing application..."
    download_application
    
    print_status "Step 6/15: Setting up Python environment..."
    setup_python_environment
    
    print_status "Step 7/15: Creating directories..."
    create_directories
    
    print_status "Step 8/15: Initializing database..."
    initialize_database
    
    print_status "Step 9/15: Creating system service..."
    create_service
    
    print_status "Step 10/15: Configuring audio..."
    setup_audio
    
    print_status "Step 11/15: Setting up firewall..."
    setup_firewall
    
    print_status "Step 12/15: Creating backup system..."
    create_backup_script
    
    print_status "Step 13/15: Creating test scripts..."
    create_test_scripts
    
    print_status "Step 14/15: Optimizing system..."
    optimize_system
    
    print_status "Step 15/15: Starting services..."
    start_and_test
    
    create_desktop_shortcuts
    
    show_summary
}

# Run main function
main "$@"