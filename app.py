from flask import Flask
from flask_migrate import Migrate
import pygame
import threading
from app.models import db, Device, PatchedDevice, Sequence, Playlist
from app.hardware import DMXController, AudioPlayer, setup_gpio, cleanup_gpio, RPI_AVAILABLE
from app.services import playback, process_audio_upload, serve_audio_preview
from app.api import device_api, sequence_api, playback_api, network_api, system_api

# Fix for scipy compatibility
try:
    import scipy.signal
    if not hasattr(scipy.signal, 'hann'):
        scipy.signal.hann = scipy.signal.windows.hann
except ImportError:
    pass

# Create Flask app
app = Flask(__name__)
app.config['SECRET_KEY'] = 'dmx-lighting-control-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///dmx_control.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 150 * 1024 * 1024  # 150MB max file size

# Initialize database and migration
db.init_app(app)
migrate = Migrate(app, db)

# Initialize pygame mixer for audio
pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)

# Setup GPIO pins
setup_gpio()

# Initialize hardware controllers
dmx_controller = DMXController()
audio_player = AudioPlayer()

# Initialize playback system with controller references
playback.init_playback(dmx_controller, audio_player, app)

# Register blueprints
app.register_blueprint(device_api)
app.register_blueprint(sequence_api)
app.register_blueprint(playback_api)
app.register_blueprint(network_api)
app.register_blueprint(system_api)

# Audio processing routes
@app.route('/api/upload-song', methods=['POST'])
def upload_song():
    return process_audio_upload(app)

@app.route('/api/audio-preview/<int:song_id>')
def audio_preview(song_id):
    return serve_audio_preview(app, song_id)

# Basic page routes
@app.route('/')
def index():
    from flask import redirect, url_for
    return redirect(url_for('manage_sequences'))

@app.route('/sequence_editor')
def sequence_editor():
    from flask import render_template
    return render_template('index.html')

@app.route('/patch')
def patch():
    from flask import render_template
    import json
    
    devices = Device.query.all()
    patched_devices_query = PatchedDevice.query.all()
    
    # Convert patched devices to dictionaries for JSON serialization
    patched_devices = []
    for pd in patched_devices_query:
        device_channels = json.loads(pd.device.channels) if pd.device.channels else []
        patched_devices.append({
            'id': pd.id,
            'device_id': pd.device_id,
            'start_address': pd.start_address,
            'x_position': pd.x_position,
            'y_position': pd.y_position,
            'device': {
                'id': pd.device.id,
                'name': pd.device.name,
                'channels': device_channels,
                'shape': pd.device.shape or 'circle',
                'color': pd.device.color or '#ffffff',
                'default_values': pd.device.default_values
            }
        })
    
    return render_template('patch.html', devices=devices, patched_devices=patched_devices)

@app.route('/create-device')
def create_device():
    from flask import render_template
    return render_template('create_device.html')

@app.route('/manage-sequences')
def manage_sequences():
    from flask import render_template
    sequences = Sequence.query.all()
    playlists = Playlist.query.all()
    
    # Convert sequences to dictionaries for JSON serialization
    sequences_data = []
    for seq in sequences:
        sequences_data.append({
            'id': seq.id,
            'name': seq.name,
            'song_id': seq.song_id,
            'events': seq.get_events(),
            'created_at': seq.created_at.isoformat() if seq.created_at else None,
            'song': {
                'id': seq.song.id,
                'name': seq.song.name,
                'duration': seq.song.duration
            } if seq.song else None
        })
    
    # Convert playlists to dictionaries for JSON serialization  
    playlists_data = []
    for playlist in playlists:
        playlists_data.append({
            'id': playlist.id,
            'name': playlist.name,
            'sequences': playlist.get_sequences(),
            'is_active': playlist.is_active,
            'random_mode': playlist.random_mode,
            'created_at': playlist.created_at.isoformat() if playlist.created_at else None
        })
    
    return render_template('manage_sequences.html', sequences=sequences_data, playlists=playlists_data)

@app.route('/settings')
def settings():
    from flask import render_template
    return render_template('settings.html')

if __name__ == '__main__':
    with app.app_context():
        db.create_all()

    # Start DMX controller
    dmx_controller.start()

    # Apply default values on startup
    import time
    time.sleep(0.2)  # Wait for DMX controller to fully initialize
    with app.app_context():
        playback.apply_default_values()

    # Start button handler thread
    if RPI_AVAILABLE:
        button_thread = threading.Thread(target=playback.button_handler)
        button_thread.daemon = True
        button_thread.start()

    try:
        app.run(host='0.0.0.0', port=5000, debug=False)
    finally:
        dmx_controller.stop()
        cleanup_gpio()