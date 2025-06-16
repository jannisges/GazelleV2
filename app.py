from flask import Flask, render_template, request, jsonify, send_file
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
import os
import json
import threading
import time
import pygame
import numpy as np
import librosa
from datetime import datetime
import shutil
import psutil

try:
    import RPi.GPIO as GPIO
    RPI_AVAILABLE = True
except ImportError:
    RPI_AVAILABLE = False

app = Flask(__name__)
app.config['SECRET_KEY'] = 'dmx-lighting-control-secret-key'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///dmx_control.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100MB max file size

db = SQLAlchemy(app)
migrate = Migrate(app, db)

# GPIO Configuration
DMX_PIN = 14
BUTTON_PIN = 18

# DMX and Audio Control
dmx_controller = None
audio_player = None
current_sequence = None
is_playing = False

# Initialize pygame mixer for audio
pygame.mixer.init(frequency=44100, size=-16, channels=2, buffer=512)

# GPIO Setup (only on Raspberry Pi)
if RPI_AVAILABLE:
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(DMX_PIN, GPIO.OUT)
    GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)

# Database Models
class Device(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    channels = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def get_channels(self):
        return json.loads(self.channels) if self.channels else []
    
    def set_channels(self, channels):
        self.channels = json.dumps(channels)

class PatchedDevice(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    device_id = db.Column(db.Integer, db.ForeignKey('device.id'), nullable=False)
    start_address = db.Column(db.Integer, nullable=False)
    x_position = db.Column(db.Float, default=0)
    y_position = db.Column(db.Float, default=0)
    device = db.relationship('Device', backref='patches')

class Song(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    filename = db.Column(db.String(200), nullable=False)
    file_path = db.Column(db.String(500), nullable=False)
    duration = db.Column(db.Float)
    waveform_data = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

class Sequence(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    song_id = db.Column(db.Integer, db.ForeignKey('song.id'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    events = db.Column(db.Text)  # JSON string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    song = db.relationship('Song', backref='sequences')
    
    def get_events(self):
        return json.loads(self.events) if self.events else []
    
    def set_events(self, events):
        self.events = json.dumps(events)

class Playlist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    sequences = db.Column(db.Text)  # JSON array of sequence IDs
    is_active = db.Column(db.Boolean, default=True)
    random_mode = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def get_sequences(self):
        return json.loads(self.sequences) if self.sequences else []
    
    def set_sequences(self, sequences):
        self.sequences = json.dumps(sequences)

class Settings(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    key = db.Column(db.String(100), unique=True, nullable=False)
    value = db.Column(db.Text)

# DMX Controller Class
class DMXController:
    def __init__(self):
        self.dmx_data = [0] * 512
        self.running = False
        self.thread = None
    
    def start(self):
        if not self.running:
            self.running = True
            self.thread = threading.Thread(target=self._output_loop)
            self.thread.daemon = True
            self.thread.start()
    
    def stop(self):
        self.running = False
        if self.thread:
            self.thread.join()
    
    def set_channel(self, channel, value):
        if 1 <= channel <= 512:
            self.dmx_data[channel - 1] = max(0, min(255, int(value)))
    
    def get_channel(self, channel):
        if 1 <= channel <= 512:
            return self.dmx_data[channel - 1]
        return 0
    
    def _output_loop(self):
        while self.running:
            if RPI_AVAILABLE:
                self._send_dmx_frame()
            time.sleep(0.04)  # ~25 FPS
    
    def _send_dmx_frame(self):
        if not RPI_AVAILABLE:
            return
        
        # DMX Break
        GPIO.output(DMX_PIN, GPIO.LOW)
        time.sleep(0.000088)  # 88µs break
        
        # DMX Mark After Break
        GPIO.output(DMX_PIN, GPIO.HIGH)
        time.sleep(0.000008)  # 8µs MAB
        
        # Send Start Code (0)
        self._send_byte(0)
        
        # Send DMX Data
        for value in self.dmx_data:
            self._send_byte(value)
    
    def _send_byte(self, byte_value):
        if not RPI_AVAILABLE:
            return
        
        # Start bit
        GPIO.output(DMX_PIN, GPIO.LOW)
        time.sleep(0.000004)  # 4µs per bit at 250kbps
        
        # Data bits (LSB first)
        for i in range(8):
            bit = (byte_value >> i) & 1
            GPIO.output(DMX_PIN, GPIO.HIGH if bit else GPIO.LOW)
            time.sleep(0.000004)
        
        # Stop bits
        GPIO.output(DMX_PIN, GPIO.HIGH)
        time.sleep(0.000008)  # 2 stop bits

# Audio Player Class
class AudioPlayer:
    def __init__(self):
        self.current_song = None
        self.is_playing = False
        self.start_time = 0
        self.pause_time = 0
    
    def load_song(self, file_path):
        try:
            pygame.mixer.music.load(file_path)
            self.current_song = file_path
            return True
        except Exception as e:
            print(f"Error loading audio: {e}")
            return False
    
    def play(self):
        if self.current_song:
            pygame.mixer.music.play()
            self.is_playing = True
            self.start_time = time.time()
            return True
        return False
    
    def pause(self):
        pygame.mixer.music.pause()
        self.is_playing = False
        self.pause_time = time.time()
    
    def resume(self):
        pygame.mixer.music.unpause()
        self.is_playing = True
    
    def stop(self):
        pygame.mixer.music.stop()
        self.is_playing = False
        self.start_time = 0
        self.pause_time = 0
    
    def get_position(self):
        if self.is_playing and self.start_time:
            return time.time() - self.start_time
        return 0

# Initialize controllers
dmx_controller = DMXController()
audio_player = AudioPlayer()

# Button handling thread
def button_handler():
    if not RPI_AVAILABLE:
        return
    
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.LOW:
            # Button pressed, trigger playback
            trigger_sequence_playback()
            time.sleep(0.5)  # Debounce
        time.sleep(0.1)

def trigger_sequence_playback():
    global current_sequence, is_playing
    
    # Get active playlists and select a sequence
    active_playlists = Playlist.query.filter_by(is_active=True).all()
    if not active_playlists:
        return
    
    # For now, just play the first sequence from the first active playlist
    playlist = active_playlists[0]
    sequence_ids = playlist.get_sequences()
    if not sequence_ids:
        return
    
    sequence = Sequence.query.get(sequence_ids[0])
    if sequence and sequence.song:
        play_sequence(sequence)

def play_sequence(sequence):
    global current_sequence, is_playing
    
    if is_playing:
        audio_player.stop()
    
    current_sequence = sequence
    is_playing = True
    
    # Load and play audio
    if audio_player.load_song(sequence.song.file_path):
        audio_player.play()
        
        # Start sequence playback in separate thread
        playback_thread = threading.Thread(target=sequence_playback_loop, args=(sequence,))
        playback_thread.daemon = True
        playback_thread.start()

def sequence_playback_loop(sequence):
    global is_playing
    
    events = sequence.get_events()
    events.sort(key=lambda x: x.get('time', 0))
    
    start_time = time.time()
    event_index = 0
    
    while is_playing and event_index < len(events):
        current_time = time.time() - start_time
        event = events[event_index]
        
        if current_time >= event.get('time', 0):
            # Execute event
            execute_dmx_event(event)
            event_index += 1
        
        time.sleep(0.01)  # 10ms precision

def execute_dmx_event(event):
    device_id = event.get('device_id')
    event_type = event.get('type')
    value = event.get('value', 0)
    
    patched_device = PatchedDevice.query.filter_by(device_id=device_id).first()
    if not patched_device:
        return
    
    device = patched_device.device
    channels = device.get_channels()
    
    for i, channel in enumerate(channels):
        dmx_address = patched_device.start_address + i
        channel_type = channel.get('type')
        
        if event_type == 'dimmer' and channel_type == 'dimmer_channel':
            dmx_controller.set_channel(dmx_address, int(value * 255 / 100))
        elif event_type == 'color':
            color = event.get('color', {})
            if channel_type == 'red_channel':
                dmx_controller.set_channel(dmx_address, color.get('r', 0))
            elif channel_type == 'green_channel':
                dmx_controller.set_channel(dmx_address, color.get('g', 0))
            elif channel_type == 'blue_channel':
                dmx_controller.set_channel(dmx_address, color.get('b', 0))
            elif channel_type == 'white_channel':
                dmx_controller.set_channel(dmx_address, color.get('w', 0))

# Routes
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/patch')
def patch():
    devices = Device.query.all()
    patched_devices = PatchedDevice.query.all()
    return render_template('patch.html', devices=devices, patched_devices=patched_devices)

@app.route('/create-device')
def create_device():
    return render_template('create_device.html')

@app.route('/manage-sequences')
def manage_sequences():
    sequences = Sequence.query.all()
    playlists = Playlist.query.all()
    return render_template('manage_sequences.html', sequences=sequences, playlists=playlists)

@app.route('/settings')
def settings():
    return render_template('settings.html')

# API Routes
@app.route('/api/upload-song', methods=['POST'])
def upload_song():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    # Check file extension
    allowed_extensions = {'.mp3', '.wav', '.flac', '.aiff'}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        return jsonify({'error': 'Unsupported file format'}), 400
    
    # Save file
    if not os.path.exists(app.config['UPLOAD_FOLDER']):
        os.makedirs(app.config['UPLOAD_FOLDER'])
    
    filename = file.filename
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)
    
    # Process audio
    try:
        y, sr = librosa.load(file_path)
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Generate waveform data for visualization
        hop_length = len(y) // 1000  # 1000 points for waveform
        waveform = librosa.amplitude_to_db(np.abs(librosa.stft(y, hop_length=hop_length)))
        waveform_data = waveform.mean(axis=0).tolist()
        
        # Save to database
        song = Song(
            name=os.path.splitext(filename)[0],
            filename=filename,
            file_path=file_path,
            duration=duration,
            waveform_data=json.dumps(waveform_data)
        )
        db.session.add(song)
        db.session.commit()
        
        return jsonify({
            'id': song.id,
            'name': song.name,
            'duration': duration,
            'waveform_data': waveform_data
        })
    
    except Exception as e:
        return jsonify({'error': f'Error processing audio: {str(e)}'}), 500

@app.route('/api/save-device', methods=['POST'])
def save_device():
    try:
        data = request.get_json()
        name = data.get('name')
        channels = data.get('channels', [])
        device_id = data.get('id')
        
        if not name:
            return jsonify({'error': 'Device name is required'}), 400
        
        if device_id:
            # Update existing device
            device = Device.query.get(device_id)
            if not device:
                return jsonify({'error': 'Device not found'}), 404
            device.name = name
            device.set_channels(channels)
        else:
            # Create new device
            device = Device(name=name)
            device.set_channels(channels)
            db.session.add(device)
        
        db.session.commit()
        return jsonify({'success': True, 'device_id': device.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/get-device/<int:device_id>')
def get_device(device_id):
    try:
        device = Device.query.get(device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        return jsonify({
            'success': True,
            'device': {
                'id': device.id,
                'name': device.name,
                'channels': device.channels
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-device', methods=['POST'])
def delete_device():
    try:
        data = request.get_json()
        device_id = data.get('device_id')
        
        device = Device.query.get(device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        # Remove all patches for this device
        PatchedDevice.query.filter_by(device_id=device_id).delete()
        
        # Delete the device
        db.session.delete(device)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/patch-device', methods=['POST'])
def patch_device():
    try:
        data = request.get_json()
        device_id = data.get('device_id')
        start_address = data.get('start_address')
        
        device = Device.query.get(device_id)
        if not device:
            return jsonify({'error': 'Device not found'}), 404
        
        channels = device.get_channels()
        channel_count = len(channels)
        
        # Check if addresses are available
        for i in range(channel_count):
            address = start_address + i
            if address > 512:
                return jsonify({'error': 'Address range exceeds DMX universe (512 channels)'}), 400
            
            existing = PatchedDevice.query.filter(
                PatchedDevice.start_address <= address,
                PatchedDevice.start_address + db.func.json_array_length(PatchedDevice.device.has(Device.channels)) > address
            ).first()
            
            if existing:
                return jsonify({'error': f'Address {address} is already occupied'}), 400
        
        # Create patch
        patch = PatchedDevice(
            device_id=device_id,
            start_address=start_address,
            x_position=50,
            y_position=50
        )
        
        db.session.add(patch)
        db.session.commit()
        
        return jsonify({'success': True, 'patch_id': patch.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/unpatch-device', methods=['POST'])
def unpatch_device():
    try:
        data = request.get_json()
        patch_id = data.get('patch_id')
        
        patch = PatchedDevice.query.get(patch_id)
        if not patch:
            return jsonify({'error': 'Patch not found'}), 404
        
        db.session.delete(patch)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/update-patch-position', methods=['POST'])
def update_patch_position():
    try:
        data = request.get_json()
        patch_id = data.get('patch_id')
        x_position = data.get('x_position')
        y_position = data.get('y_position')
        
        patch = PatchedDevice.query.get(patch_id)
        if not patch:
            return jsonify({'error': 'Patch not found'}), 404
        
        patch.x_position = x_position
        patch.y_position = y_position
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/patched-devices')
def get_patched_devices():
    try:
        patches = PatchedDevice.query.all()
        result = []
        
        for patch in patches:
            result.append({
                'id': patch.id,
                'device_id': patch.device_id,
                'start_address': patch.start_address,
                'x_position': patch.x_position,
                'y_position': patch.y_position,
                'device': {
                    'id': patch.device.id,
                    'name': patch.device.name,
                    'channels': patch.device.get_channels()
                }
            })
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/clear-all-patch', methods=['POST'])
def clear_all_patch():
    try:
        PatchedDevice.query.delete()
        db.session.commit()
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/export-patch')
def export_patch():
    try:
        patches = PatchedDevice.query.all()
        export_data = {
            'devices': [],
            'patches': []
        }
        
        # Export devices
        for device in Device.query.all():
            export_data['devices'].append({
                'id': device.id,
                'name': device.name,
                'channels': device.get_channels()
            })
        
        # Export patches
        for patch in patches:
            export_data['patches'].append({
                'device_id': patch.device_id,
                'start_address': patch.start_address,
                'x_position': patch.x_position,
                'y_position': patch.y_position
            })
        
        return jsonify({'success': True, 'data': export_data})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save-sequence', methods=['POST'])
def save_sequence():
    try:
        data = request.get_json()
        song_id = data.get('song_id')
        name = data.get('name')
        events = data.get('events', [])
        sequence_id = data.get('id')
        
        if not song_id or not name:
            return jsonify({'error': 'Song ID and name are required'}), 400
        
        if sequence_id:
            # Update existing sequence
            sequence = Sequence.query.get(sequence_id)
            if not sequence:
                return jsonify({'error': 'Sequence not found'}), 404
            sequence.name = name
            sequence.set_events(events)
        else:
            # Create new sequence
            sequence = Sequence(song_id=song_id, name=name)
            sequence.set_events(events)
            db.session.add(sequence)
        
        db.session.commit()
        return jsonify({'success': True, 'sequence_id': sequence.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/get-sequence/<int:sequence_id>')
def get_sequence(sequence_id):
    try:
        sequence = Sequence.query.get(sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        return jsonify({
            'success': True,
            'sequence': {
                'id': sequence.id,
                'name': sequence.name,
                'song_id': sequence.song_id,
                'events': sequence.get_events(),
                'song': {
                    'id': sequence.song.id,
                    'name': sequence.song.name,
                    'duration': sequence.song.duration,
                    'waveform_data': json.loads(sequence.song.waveform_data) if sequence.song.waveform_data else []
                }
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-sequence', methods=['POST'])
def delete_sequence():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        
        sequence = Sequence.query.get(sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        # Remove from playlists
        playlists = Playlist.query.all()
        for playlist in playlists:
            sequences = playlist.get_sequences()
            if sequence_id in sequences:
                sequences.remove(sequence_id)
                playlist.set_sequences(sequences)
        
        db.session.delete(sequence)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/duplicate-sequence', methods=['POST'])
def duplicate_sequence():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        new_name = data.get('new_name')
        
        original = Sequence.query.get(sequence_id)
        if not original:
            return jsonify({'error': 'Sequence not found'}), 404
        
        duplicate = Sequence(
            song_id=original.song_id,
            name=new_name,
            events=original.events
        )
        
        db.session.add(duplicate)
        db.session.commit()
        
        return jsonify({'success': True, 'sequence_id': duplicate.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/save-playlist', methods=['POST'])
def save_playlist():
    try:
        data = request.get_json()
        name = data.get('name')
        sequences = data.get('sequences', [])
        is_active = data.get('is_active', True)
        random_mode = data.get('random_mode', False)
        playlist_id = data.get('id')
        
        if not name:
            return jsonify({'error': 'Playlist name is required'}), 400
        
        if playlist_id:
            # Update existing playlist
            playlist = Playlist.query.get(playlist_id)
            if not playlist:
                return jsonify({'error': 'Playlist not found'}), 404
            playlist.name = name
            playlist.set_sequences(sequences)
            playlist.is_active = is_active
            playlist.random_mode = random_mode
        else:
            # Create new playlist
            playlist = Playlist(name=name, is_active=is_active, random_mode=random_mode)
            playlist.set_sequences(sequences)
            db.session.add(playlist)
        
        db.session.commit()
        return jsonify({'success': True, 'playlist_id': playlist.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-playlist', methods=['POST'])
def delete_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        
        playlist = Playlist.query.get(playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        db.session.delete(playlist)
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/toggle-playlist', methods=['POST'])
def toggle_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        is_active = data.get('is_active')
        
        playlist = Playlist.query.get(playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        playlist.is_active = is_active
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/toggle-random-mode', methods=['POST'])
def toggle_random_mode():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        random_mode = data.get('random_mode')
        
        playlist = Playlist.query.get(playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        playlist.random_mode = random_mode
        db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/add-to-playlist', methods=['POST'])
def add_to_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        sequence_id = data.get('sequence_id')
        
        if not playlist_id or not sequence_id:
            return jsonify({'error': 'Playlist ID and Sequence ID are required'}), 400
        
        playlist = Playlist.query.get(playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        sequence = Sequence.query.get(sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        sequences = playlist.get_sequences()
        if sequence_id not in sequences:
            sequences.append(sequence_id)
            playlist.set_sequences(sequences)
            db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/remove-from-playlist', methods=['POST'])
def remove_from_playlist():
    try:
        data = request.get_json()
        playlist_id = data.get('playlist_id')
        sequence_id = data.get('sequence_id')
        
        if not playlist_id or not sequence_id:
            return jsonify({'error': 'Playlist ID and Sequence ID are required'}), 400
        
        playlist = Playlist.query.get(playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        sequences = playlist.get_sequences()
        if sequence_id in sequences:
            sequences.remove(sequence_id)
            playlist.set_sequences(sequences)
            db.session.commit()
        
        return jsonify({'success': True})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/import-sequence', methods=['POST'])
def import_sequence():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        if not file.filename.endswith('.json'):
            return jsonify({'error': 'Only JSON files are supported'}), 400
        
        try:
            sequence_data = json.loads(file.read().decode('utf-8'))
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON format'}), 400
        
        # Validate required fields
        required_fields = ['name', 'song_id', 'events']
        for field in required_fields:
            if field not in sequence_data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Validate song exists
        song = Song.query.get(sequence_data['song_id'])
        if not song:
            return jsonify({'error': 'Referenced song not found'}), 404
        
        # Validate events format
        events = sequence_data['events']
        if not isinstance(events, list):
            return jsonify({'error': 'Events must be an array'}), 400
        
        for event in events:
            if not all(key in event for key in ['time', 'channel', 'value']):
                return jsonify({'error': 'Each event must have time, channel, and value'}), 400
        
        # Create new sequence
        sequence = Sequence(
            song_id=sequence_data['song_id'],
            name=sequence_data['name'],
            events=json.dumps(events)
        )
        
        db.session.add(sequence)
        db.session.commit()
        
        return jsonify({'success': True, 'sequence_id': sequence.id})
    
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@app.route('/api/export-sequences')
def export_sequences():
    try:
        sequence_ids = request.args.get('ids', '').split(',')
        if not sequence_ids or sequence_ids == ['']:
            # Export all sequences if no IDs specified
            sequences = Sequence.query.all()
        else:
            # Export specific sequences
            sequences = Sequence.query.filter(Sequence.id.in_(sequence_ids)).all()
        
        if not sequences:
            return jsonify({'error': 'No sequences found'}), 404
        
        export_data = []
        for sequence in sequences:
            export_data.append({
                'id': sequence.id,
                'name': sequence.name,
                'song_id': sequence.song_id,
                'song_name': sequence.song.name,
                'events': sequence.get_events(),
                'created_at': sequence.created_at.isoformat()
            })
        
        # Create export filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'sequences_export_{timestamp}.json'
        
        # Save to temporary file
        export_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        
        with open(export_path, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        return send_file(export_path, as_attachment=True, download_name=filename)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/play-sequence-by-id', methods=['POST'])
def play_sequence_by_id():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        
        sequence = Sequence.query.get(sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        play_sequence(sequence)
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/playback-status')
def playback_status():
    try:
        global current_sequence, is_playing, audio_player
        
        if is_playing and current_sequence:
            position = audio_player.get_position()
            duration = current_sequence.song.duration
            progress = (position / duration * 100) if duration > 0 else 0
            
            return jsonify({
                'is_playing': True,
                'current_sequence': {
                    'id': current_sequence.id,
                    'name': current_sequence.name,
                    'song_name': current_sequence.song.name
                },
                'current_time': position,
                'total_time': duration,
                'progress': progress
            })
        else:
            return jsonify({'is_playing': False})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/stop-sequence', methods=['POST'])
def stop_sequence():
    try:
        global is_playing, current_sequence
        
        is_playing = False
        current_sequence = None
        audio_player.stop()
        
        # Clear all DMX channels
        for i in range(512):
            dmx_controller.set_channel(i + 1, 0)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/blackout', methods=['POST'])
def blackout():
    try:
        # Set all channels to 0
        for i in range(512):
            dmx_controller.set_channel(i + 1, 0)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/master-dimmer', methods=['POST'])
def master_dimmer():
    try:
        data = request.get_json()
        value = data.get('value', 100)
        
        # Apply dimmer to all patched dimmer channels
        patches = PatchedDevice.query.all()
        for patch in patches:
            channels = patch.device.get_channels()
            for i, channel in enumerate(channels):
                if channel.get('type') == 'dimmer_channel':
                    dmx_address = patch.start_address + i
                    current_value = dmx_controller.get_channel(dmx_address)
                    new_value = int(current_value * value / 100)
                    dmx_controller.set_channel(dmx_address, new_value)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/master-color', methods=['POST'])
def master_color():
    try:
        data = request.get_json()
        color_hex = data.get('color', '#ffffff')
        
        # Convert hex to RGB
        color_hex = color_hex.lstrip('#')
        r = int(color_hex[0:2], 16)
        g = int(color_hex[2:4], 16)
        b = int(color_hex[4:6], 16)
        
        # Apply color to all patched color channels
        patches = PatchedDevice.query.all()
        for patch in patches:
            channels = patch.device.get_channels()
            for i, channel in enumerate(channels):
                dmx_address = patch.start_address + i
                channel_type = channel.get('type')
                
                if channel_type == 'red_channel':
                    dmx_controller.set_channel(dmx_address, r)
                elif channel_type == 'green_channel':
                    dmx_controller.set_channel(dmx_address, g)
                elif channel_type == 'blue_channel':
                    dmx_controller.set_channel(dmx_address, b)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Settings and system management routes
@app.route('/api/storage-info')
def storage_info():
    try:
        # Get internal storage info
        statvfs = os.statvfs('.')
        total = statvfs.f_frsize * statvfs.f_blocks
        used = total - (statvfs.f_frsize * statvfs.f_bavail)
        
        internal_storage = {
            'total': total,
            'used': used,
            'free': total - used
        }
        
        # Get external storage info (placeholder)
        external_storage = []
        # In a real implementation, you would scan for mounted USB devices
        
        return jsonify({
            'success': True,
            'data': {
                'internal': internal_storage,
                'external': external_storage
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/network-status')
def network_status():
    try:
        # Placeholder implementation
        # In a real implementation, you would check actual network status
        return jsonify({
            'success': True,
            'data': {
                'connected': True,
                'ssid': 'Test Network',
                'ip_address': '192.168.1.100',
                'mode': 'wifi'
            }
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/wifi-networks')
def wifi_networks():
    try:
        # Placeholder implementation
        # In a real implementation, you would scan for actual WiFi networks
        networks = [
            {'ssid': 'Home WiFi', 'signal': 85, 'encrypted': True, 'connected': True},
            {'ssid': 'Guest Network', 'signal': 70, 'encrypted': False, 'connected': False},
            {'ssid': 'Neighbor WiFi', 'signal': 45, 'encrypted': True, 'connected': False}
        ]
        
        return jsonify({'success': True, 'networks': networks})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    
    # Start DMX controller
    dmx_controller.start()
    
    # Start button handler thread
    if RPI_AVAILABLE:
        button_thread = threading.Thread(target=button_handler)
        button_thread.daemon = True
        button_thread.start()
    
    try:
        app.run(host='0.0.0.0', port=5000, debug=True)
    finally:
        dmx_controller.stop()
        if RPI_AVAILABLE:
            GPIO.cleanup()