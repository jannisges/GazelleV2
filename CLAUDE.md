# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web-based DMX lighting control system designed for Raspberry Pi that synchronizes lighting sequences with music. The application creates professional light shows with precise timing control and real-time DMX512 output.

## Development Commands

### Running the Application
```bash
# Development mode (auto-detects hardware availability)
python3 app.py

# With virtual environment
source venv/bin/activate
python3 app.py
```

### System Service Management
```bash
# Control the installed service
sudo systemctl start dmx-control.service
sudo systemctl stop dmx-control.service
sudo systemctl status dmx-control.service
sudo journalctl -u dmx-control.service -f
```

### Hardware Testing
```bash
# Test GPIO button (Raspberry Pi only)
python3 test_button.py

# Test DMX output (Raspberry Pi only)
python3 test_dmx.py
```

### Installation
```bash
# Complete system setup (Raspberry Pi)
./install.sh

# Manual Python dependencies
pip install -r requirements.txt
```

## Architecture Overview

### Core Components

**Flask Application (`app.py`)**
- Main web server and API endpoints
- SQLAlchemy database models for devices, sequences, playlists
- Hardware abstraction layer for GPIO/DMX output
- Audio playback synchronization engine

**Hardware Controllers**
- `DMXController`: Real-time DMX512 signal generation via GPIO14
- `AudioPlayer`: pygame-based audio playback with position tracking  
- GPIO button handler on pin 18 for hardware triggers

**Database Models**
- `Device`: Lighting fixture definitions with channel configurations
- `PatchedDevice`: DMX address assignments and 2D positioning
- `Song`: Audio files with waveform data for visualization
- `Sequence`: Lighting events synchronized to audio timeline
- `Playlist`: Collections of sequences for automated playback

### Frontend Structure

**Templates (Jinja2)**
- `base.html`: Bootstrap navigation and layout
- `index.html`: Main sequencer interface with waveform editor
- `patch.html`: DMX patching and 2D fixture positioning
- `create_device.html`: Device configuration with channel types
- `manage_sequences.html`: Sequence and playlist management

**JavaScript Modules**
- `main.js`: Core utilities and drag-and-drop functionality
- `waveform.js`: Audio visualization and timeline controls
- `sequence-editor.js`: Event editing and playback synchronization
- `light-preview.js`: 2D fixture visualization and real-time preview

### Hardware Integration

**DMX Output**
- Professional DMX512 protocol via MAX485E transceiver
- 512-channel universe with 25fps refresh rate
- Hardware abstraction with development mode fallback

**GPIO Interface**
- Button trigger on GPIO18 for show automation
- Automatic hardware detection with graceful fallbacks
- Service-based auto-start configuration

## Key Technical Details

### Audio Processing
- librosa for waveform analysis and duration detection
- pygame mixer for precise playback control
- Real-time position tracking for sequence synchronization

### Database Schema
- SQLite with SQLAlchemy ORM
- JSON fields for flexible channel and event storage
- Foreign key relationships for data integrity

### Hardware Timing
- DMX refresh at 25fps (40ms intervals)
- Sequence events processed at 10ms precision
- Threading for concurrent audio and DMX operation

### Development Environment
- Automatic hardware detection (RPi.GPIO availability)
- Mock hardware modes for development on non-Pi systems
- Bootstrap 5 responsive web interface

## File Organization

- `/templates/`: Jinja2 HTML templates
- `/static/css/`: Styling and responsive design
- `/static/js/`: Client-side application logic  
- `/uploads/`: Audio file storage (auto-created)
- `/backups/`: Automated system backups
- `test_*.py`: Hardware validation scripts
- `install.sh`: Complete Raspberry Pi setup automation

## Development Troubleshooting

- You can't run the current project because the venv is a windows venv.