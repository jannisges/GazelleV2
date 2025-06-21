# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
```bash
# Development mode
python3 app.py

# Production mode (with systemd service)
sudo systemctl start dmx-control.service
sudo systemctl status dmx-control.service
```

### Environment Setup
```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Initialize database
python3 app.py  # Creates tables on first run
```

### Database Operations
- Database is SQLite stored as `dmx_control.db`
- Flask-SQLAlchemy handles ORM and migrations
- Schema auto-created on first run via `db.create_all()` in app.py:113

## Architecture Overview

### Core Application Structure
- **Flask app** (`app.py`) - Main application entry point with route definitions
- **MVC Pattern** - Models, API controllers, and HTML templates
- **Hardware Abstraction** - Raspberry Pi GPIO and DMX output with fallback simulation
- **Real-time Systems** - Threading for DMX output (~25 FPS) and button handling

### Key Components

#### Database Models (`app/models/models.py`)
- `Device` - DMX device definitions with channel configurations (JSON stored)
- `PatchedDevice` - Device instances mapped to DMX addresses with 2D positions
- `Song` - Audio files with waveform data and metadata
- `Sequence` - Lighting sequences linked to songs with event data (JSON stored)
- `Playlist` - Collections of sequences for automated playback

#### Hardware Controllers (`app/hardware/hardware.py`)
- `DMXController` - Threaded DMX512 output via GPIO14 (or simulation)
- `AudioPlayer` - Pygame-based audio playback with synchronization
- GPIO handling with `RPI_AVAILABLE` flag for cross-platform development

#### Business Logic (`app/services/`)
- `playback.py` - Sequence playback coordination and hardware button handling
- `audio_processing.py` - Audio file analysis and waveform generation using librosa

#### API Endpoints (`app/api/`)
- `device_api.py` - Device CRUD and management
- `sequence_api.py` - Sequence and playlist operations
- `playback_api.py` - Real-time playback control
- `network_api.py` - WiFi and network management (Raspberry Pi specific)
- `system_api.py` - System settings and administrative functions

### Frontend Architecture
- **Vanilla JavaScript** - No frameworks, modular JS files per page
- **Canvas-based Visualizations** - Waveform rendering and 2D fixture positioning
- **Real-time Updates** - WebSocket-like polling for playback status
- **Drag & Drop** - Device patching interface with visual feedback

### Hardware Integration
- **DMX Output** - GPIO14 via MAX485E RS-485 transceiver
- **Button Input** - GPIO18 with pull-up resistor for sequence triggering
- **Cross-platform** - Automatic hardware detection with simulation fallback

### Data Flow
1. Audio files uploaded → librosa analysis → waveform data stored
2. Devices created → patched to DMX addresses → positioned in 2D space
3. Sequences created → events timed to audio → stored as JSON
4. Playback triggered → audio starts → DMX values interpolated → GPIO output

### Threading Model
- **Main Thread** - Flask web server
- **DMX Thread** - Continuous 25 FPS DMX frame output
- **Button Thread** - Hardware button monitoring (Raspberry Pi only)
- **Playback Thread** - Sequence event scheduling and interpolation

## Development Notes

### Testing Without Hardware
- Application detects `RPI_AVAILABLE` flag and falls back to console simulation
- All web interface features work in development mode
- DMX output prints to console instead of GPIO

### Key File Locations
- Main application: `app.py`
- Database models: `app/models/models.py`
- Hardware controllers: `app/hardware/hardware.py`
- Frontend JS modules: `static/js/[page]/[page].js`
- HTML templates: `templates/[page].html`

### Audio File Handling
- Supported formats: MP3, WAV, FLAC, AIFF
- Storage location: `uploads/` directory
- Max file size: 150MB (configured in app.py:24)
- Waveform analysis: librosa with scipy compatibility fixes (app.py:11-16)

### DMX Implementation
- 512 channels, 8-bit values (0-255)
- Channel addressing: 1-based indexing
- Frame rate: ~25 FPS continuous output
- Protocol: DMX512 standard via RS-485