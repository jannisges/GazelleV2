# DMX Lighting Control - Project Structure

## File Structure

```
GazelleV2/
├── app.py                              # Main Flask application
├── requirements.txt                    # Python dependencies
├──
├── app/                                # Main application package
│   ├── __init__.py                     # Package initialization
│   │
│   ├── models/                         # Database models
│   │   ├── __init__.py
│   │   └── models.py                   # SQLAlchemy models
│   │
│   ├── hardware/                       # Hardware controllers
│   │   ├── __init__.py
│   │   └── hardware.py                 # DMX & Audio controllers
│   │
│   ├── services/                       # Business logic services
│   │   ├── __init__.py
│   │   ├── playback.py                 # Sequence playback logic
│   │   └── audio_processing.py         # Audio analysis & processing
│   │
│   └── api/                            # REST API endpoints
│       ├── __init__.py
│       ├── device_api.py               # Device management
│       ├── sequence_api.py             # Sequence & playlist management
│       ├── playback_api.py             # Playback control
│       ├── network_api.py              # Network & WiFi management
│       └── system_api.py               # System settings & admin
│
├── templates/                          # Jinja2 HTML templates
│   ├── base.html
│   ├── index.html
│   ├── patch.html
│   ├── create_device.html
│   ├── manage_sequences.html
│   └── settings.html
│
├── static/                             # Static assets
│   ├── css/style.css
│   └── js/
│     └── main.js
│     └── create_device/
│       └── create_device.js
│     └── light_preview/
│       └── light_preview.js
│     └── patch/
│       ├── api-client.js               # API communication for patch operations
│       ├── selection-manager.js        # Device selection and multi-select operations
│       ├── grid-manager.js             # DMX address grid display and interactions
│       ├── plan-view-controller.js     # 2D plan view with zoom, pan, and grid functionality
│       └── patch-manager.js            # Main patch manager coordinating all components
│     └── sequence_editor/
│       ├── waveform.js
│       ├── sequence-editor-core.js      # Core timeline visualization
│       ├── event-modal.js               # Event creation/editing modal
│       ├── playback-controller.js       # Playback and synchronization
│       ├── ui-manager.js                # UI state and file management
│       └── sequence-editor-main.js      # App initialization and coordination
│     └── settings/
│       └── settings.js
│
└── uploads/                            # Audio file storage
```