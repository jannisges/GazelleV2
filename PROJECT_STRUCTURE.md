# DMX Lighting Control - Project Structure

## Overview
The DMX Lighting Control application has been refactored from a monolithic 2,184-line `app.py` file into a well-organized modular structure with proper separation of concerns.

## File Structure

```
GazelleV2/
├── app.py                          # Main Flask application
├── requirements.txt                # Python dependencies
├── 
├── app/                           # Main application package
│   ├── __init__.py               # Package initialization
│   │
│   ├── models/                   # Database models
│   │   ├── __init__.py          
│   │   └── models.py            # SQLAlchemy models
│   │
│   ├── hardware/                 # Hardware controllers
│   │   ├── __init__.py          
│   │   └── hardware.py          # DMX & Audio controllers
│   │
│   ├── services/                 # Business logic services
│   │   ├── __init__.py          
│   │   ├── playback.py          # Sequence playback logic
│   │   └── audio_processing.py  # Audio analysis & processing
│   │
│   └── api/                      # REST API endpoints
│       ├── __init__.py          
│       ├── device_api.py        # Device management
│       ├── sequence_api.py      # Sequence & playlist management
│       ├── playback_api.py      # Playback control
│       ├── network_api.py       # Network & WiFi management
│       └── system_api.py        # System settings & admin
│
├── templates/                    # Jinja2 HTML templates
│   ├── base.html
│   ├── index.html
│   ├── patch.html
│   ├── create_device.html
│   ├── manage_sequences.html
│   └── settings.html
│
├── static/                       # Static assets
│   ├── css/style.css
│   └── js/
│       ├── main.js
│       ├── waveform.js
│       ├── sequence-editor.js
│       └── light-preview.js
│
└── uploads/                      # Audio file storage
```

## Module Responsibilities

### 📁 **app/models/**
- **models.py**: Database models and ORM definitions
  - `Device`: Lighting fixture definitions
  - `PatchedDevice`: DMX address assignments  
  - `Song`: Audio files with waveform data
  - `Sequence`: Lighting events synchronized to audio
  - `Playlist`: Collections of sequences
  - `Settings`: Configuration storage

### 📁 **app/hardware/**
- **hardware.py**: Hardware abstraction layer
  - `DMXController`: Real-time DMX512 signal generation
  - `AudioPlayer`: pygame-based audio playback
  - GPIO setup and cleanup functions
  - Raspberry Pi hardware detection

### 📁 **app/services/**
- **playback.py**: Core lighting sequence logic
  - Sequence playback orchestration
  - DMX event execution
  - Hardware button handling
  - Timing and synchronization

- **audio_processing.py**: Audio analysis pipeline
  - File upload and validation
  - Waveform extraction using librosa
  - Frequency band analysis (low/mid/high)
  - BPM detection and grid generation

### 📁 **app/api/**
- **device_api.py**: Device & patch management
  - Device CRUD operations
  - DMX patching and addressing
  - 2D positioning for visualization
  - Import/export functionality

- **sequence_api.py**: Sequence & playlist management
  - Sequence CRUD operations
  - Playlist management
  - Import/export sequences
  - Sequence duplication

- **playback_api.py**: Live show control
  - Play/pause/stop/seek controls
  - Master dimmer and color controls
  - Blackout functionality
  - Real-time DMX status monitoring

- **network_api.py**: Network connectivity
  - WiFi scanning and connection
  - Hotspot configuration
  - Network status monitoring
  - Storage device detection

- **system_api.py**: System administration
  - Security settings management
  - System configuration
  - Settings import/export
  - Factory reset and restart

## Benefits Achieved

✅ **Maintainability**: Clear separation of concerns  
✅ **Modularity**: Independent, reusable components  
✅ **Scalability**: Easy to add new features  
✅ **Testing**: Modules can be tested in isolation  
✅ **Readability**: Much easier to navigate codebase  
✅ **Organization**: Logical folder structure  
✅ **Imports**: Clean import hierarchy with proper packages  

## Size Reduction

- **Original**: 1 file, 2,184 lines
- **Refactored**: 10 modules, main app only 115 lines (95% reduction)
- **Total**: Same functionality, dramatically improved structure

## Import Structure

The modular design uses clean import hierarchies:

```python
# Main app imports
from app.models import db, Device, PatchedDevice, Sequence, Playlist
from app.hardware import DMXController, AudioPlayer, setup_gpio, cleanup_gpio
from app.services import playback, process_audio_upload, serve_audio_preview
from app.api import device_api, sequence_api, playback_api, network_api, system_api
```

This structure provides a professional, maintainable codebase that follows Python best practices for package organization.