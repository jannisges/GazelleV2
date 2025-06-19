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

# Fix for scipy compatibility
try:
    import scipy.signal
    if not hasattr(scipy.signal, 'hann'):
        scipy.signal.hann = scipy.signal.windows.hann
except ImportError:
    pass

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
app.config['MAX_CONTENT_LENGTH'] = 150 * 1024 * 1024  # 150MB max file size

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
        self.total_pause_duration = 0
        self.seek_offset = 0
    
    def load_song(self, file_path):
        try:
            pygame.mixer.music.load(file_path)
            self.current_song = file_path
            return True
        except Exception as e:
            print(f"Error loading audio: {e}")
            return False
    
    def play(self, start_position=0):
        if self.current_song:
            pygame.mixer.music.play(start=start_position)
            self.is_playing = True
            self.start_time = time.time()
            self.total_pause_duration = 0
            self.seek_offset = start_position
            return True
        return False
    
    def pause(self):
        if self.is_playing:
            pygame.mixer.music.pause()
            self.is_playing = False
            self.pause_time = time.time()
    
    def resume(self):
        if not self.is_playing and self.pause_time > 0:
            pygame.mixer.music.unpause()
            self.is_playing = True
            # Add the pause duration to total
            self.total_pause_duration += time.time() - self.pause_time
            self.pause_time = 0
    
    def stop(self):
        pygame.mixer.music.stop()
        self.is_playing = False
        self.start_time = 0
        self.pause_time = 0
        self.total_pause_duration = 0
        self.seek_offset = 0
    
    def seek(self, position):
        """Seek to a specific position during playback"""
        if self.current_song:
            was_playing = self.is_playing
            if was_playing:
                # Stop current playback
                pygame.mixer.music.stop()
                # Restart from new position
                try:
                    pygame.mixer.music.play(start=position)
                    self.is_playing = True
                    self.start_time = time.time()
                    self.total_pause_duration = 0
                    self.seek_offset = position
                    return True
                except Exception as e:
                    print(f"Error seeking: {e}")
                    # If seeking fails, try to resume from current position
                    self.play(self.seek_offset)
                    return False
            else:
                # Not playing, just update the seek offset for next play
                self.seek_offset = position
                return True
        return False
    
    def get_position(self):
        if self.is_playing and self.start_time:
            # Calculate actual position accounting for pauses and seeking
            elapsed = time.time() - self.start_time - self.total_pause_duration
            return max(0, elapsed + self.seek_offset)
        elif self.pause_time > 0:
            # Return position at time of pause
            elapsed = self.pause_time - self.start_time - self.total_pause_duration
            return max(0, elapsed + self.seek_offset)
        return self.seek_offset

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
    
    sequence = db.session.get(Sequence, sequence_ids[0])
    if sequence and sequence.song:
        play_sequence(sequence)

def play_sequence(sequence, start_time=0):
    global current_sequence, is_playing
    
    if is_playing:
        audio_player.stop()
    
    current_sequence = sequence
    is_playing = True
    
    # Load and play audio
    if audio_player.load_song(sequence.song.file_path):
        audio_player.play(start_time)
        
        # Start sequence playback in separate thread
        playback_thread = threading.Thread(target=sequence_playback_loop, args=(sequence, start_time))
        playback_thread.daemon = True
        playback_thread.start()

def sequence_playback_loop(sequence, start_time_offset=0):
    global is_playing
    
    events = sequence.get_events()
    events.sort(key=lambda x: x.get('time', 0))
    
    start_time = time.time()
    event_index = 0
    
    # Skip events that are before the start time offset
    while event_index < len(events) and events[event_index].get('time', 0) < start_time_offset:
        event_index += 1
    
    while is_playing and event_index < len(events):
        current_time = time.time() - start_time + start_time_offset
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
                'channels': device_channels
            }
        })
    
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

@app.route('/api/get-dark-mode')
def get_dark_mode():
    try:
        config_dir = os.path.expanduser('~/.dmx_control')
        config_file = os.path.join(config_dir, 'system.json')
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)
                return jsonify({
                    'success': True,
                    'dark_mode': settings.get('dark_mode', False)
                })
        else:
            return jsonify({
                'success': True,
                'dark_mode': False
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
        # Enhanced audio loading with format validation
        y, sr = librosa.load(file_path, sr=None)  # Keep original sample rate
        duration = librosa.get_duration(y=y, sr=sr)
        
        # Use original full-resolution audio data for maximum quality
        # Convert to absolute amplitude values
        waveform_amplitude = [float(abs(val)) for val in y.tolist()]
        
        # For very long files, we'll use a high resolution but not full resolution to avoid browser memory issues
        max_points = 500000  # 500k points should handle most songs while maintaining quality
        if len(waveform_amplitude) > max_points:
            # Use decimation with anti-aliasing for high-quality downsampling
            try:
                from scipy import signal
                decimation_factor = len(waveform_amplitude) // max_points
                if decimation_factor > 1:
                    # Apply anti-aliasing filter before decimation
                    waveform_amplitude = signal.decimate(np.array(waveform_amplitude), decimation_factor, ftype='fir').tolist()
                    waveform_amplitude = [float(val) for val in waveform_amplitude]
            except ImportError:
                # Simple downsampling without anti-aliasing
                step = len(waveform_amplitude) // max_points
                waveform_amplitude = waveform_amplitude[::step]
        
        # Generate frequency-based coloring data using STFT with high resolution
        def process_frequency_bands():
            # Use smaller chunks for high-resolution frequency analysis
            chunk_size = max(1024, sr // 20)  # At least 1024 samples, or 1/20th of a second
            num_chunks = len(y) // chunk_size
            
            low_band = []
            mid_band = []
            high_band = []
            
            # Define frequency ranges in Hz
            low_freq_max = 250.0    # Bass: 20-250 Hz
            mid_freq_max = 4000.0   # Mids: 250-4000 Hz
            # High: 4000+ Hz
            
            for i in range(num_chunks):
                start_idx = i * chunk_size
                end_idx = min((i + 1) * chunk_size, len(y))
                chunk = y[start_idx:end_idx]
                
                
                if len(chunk) >= 256:  # Need minimum samples for meaningful FFT
                    # Compute FFT for this chunk with appropriate window
                    window = np.hanning(len(chunk))
                    windowed_chunk = chunk * window
                    n_fft = max(1024, len(chunk))
                    fft = np.fft.rfft(windowed_chunk, n=n_fft)
                    magnitude = np.abs(fft)
                    freqs = np.fft.rfftfreq(n_fft, 1/sr)
                    
                    # Split into frequency bands
                    low_mask = freqs <= low_freq_max
                    mid_mask = (freqs > low_freq_max) & (freqs <= mid_freq_max)
                    high_mask = freqs > mid_freq_max
                    
                    # Calculate RMS energy for each band
                    low_energy = float(np.sqrt(np.mean(magnitude[low_mask]**2))) if np.any(low_mask) else 0.0
                    mid_energy = float(np.sqrt(np.mean(magnitude[mid_mask]**2))) if np.any(mid_mask) else 0.0
                    high_energy = float(np.sqrt(np.mean(magnitude[high_mask]**2))) if np.any(high_mask) else 0.0
                    
                    low_band.append(low_energy)
                    mid_band.append(mid_energy)
                    high_band.append(high_energy)
                else:
                    # Not enough samples for FFT
                    low_band.append(0.0)
                    mid_band.append(0.0)
                    high_band.append(0.0)
            
            # Resample frequency data to match amplitude data length
            if len(low_band) != len(waveform_amplitude):
                try:
                    from scipy import interpolate
                    x_old = np.linspace(0, 1, len(low_band))
                    x_new = np.linspace(0, 1, len(waveform_amplitude))
                    
                    f_low = interpolate.interp1d(x_old, low_band, kind='linear', fill_value='extrapolate')
                    f_mid = interpolate.interp1d(x_old, mid_band, kind='linear', fill_value='extrapolate')
                    f_high = interpolate.interp1d(x_old, high_band, kind='linear', fill_value='extrapolate')
                    
                    low_band = [float(val) for val in f_low(x_new)]
                    mid_band = [float(val) for val in f_mid(x_new)]
                    high_band = [float(val) for val in f_high(x_new)]
                except ImportError:
                    # Simple linear interpolation using numpy
                    ratio = len(waveform_amplitude) / len(low_band)
                    new_indices = np.arange(len(waveform_amplitude)) / ratio
                    low_band = [float(np.interp(new_indices, np.arange(len(low_band)), low_band)[i]) for i in range(len(waveform_amplitude))]
                    mid_band = [float(np.interp(new_indices, np.arange(len(mid_band)), mid_band)[i]) for i in range(len(waveform_amplitude))]
                    high_band = [float(np.interp(new_indices, np.arange(len(high_band)), high_band)[i]) for i in range(len(waveform_amplitude))]
            
            return low_band, mid_band, high_band
        
        low_freq_data, mid_freq_data, high_freq_data = process_frequency_bands()
        
        waveform_data = {
            'amplitude': waveform_amplitude,  # Main waveform for display
            'low': low_freq_data,
            'mid': mid_freq_data, 
            'high': high_freq_data
        }
        
        # BPM Analysis
        tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = [float(t) for t in librosa.frames_to_time(beats, sr=sr).tolist()]
        
        # Generate grid markers based on BPM
        beats_per_bar = 4  # Standard 4/4 time
        bar_duration = (60.0 / float(tempo)) * beats_per_bar
        grid_markers = []
        current_time = 0.0
        while current_time < duration:
            grid_markers.append({
                'time': float(current_time),
                'type': 'bar' if len(grid_markers) % beats_per_bar == 0 else 'beat'
            })
            current_time += 60.0 / float(tempo)
        
        # Enhanced audio format info
        audio_info = {
            'sample_rate': int(sr),
            'channels': 1 if len(y.shape) == 1 else y.shape[0],
            'bit_depth': 32,  # librosa loads as float32
            'format': os.path.splitext(filename)[1].lower()
        }
        
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
            'duration': float(duration),
            'waveform_data': waveform_data,
            'bpm': float(tempo),
            'beat_times': beat_times,
            'grid_markers': grid_markers,
            'audio_info': audio_info
        })
    
    except Exception as e:
        return jsonify({'error': f'Error processing audio: {str(e)}'}), 500

@app.route('/api/audio-preview/<int:song_id>')
def audio_preview(song_id):
    """Serve audio files for preview playback"""
    try:
        song = db.session.get(Song, song_id)
        if not song:
            return jsonify({'error': 'Song not found'}), 404
        
        # Security check - ensure file is within upload folder
        file_path = os.path.abspath(song.file_path)
        upload_folder = os.path.abspath(app.config['UPLOAD_FOLDER'])
        
        if not file_path.startswith(upload_folder):
            return jsonify({'error': 'Invalid file path'}), 403
            
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404
            
        # Get file info for proper content type
        file_ext = os.path.splitext(song.filename)[1].lower()
        content_types = {
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav', 
            '.flac': 'audio/flac',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.aac': 'audio/aac'
        }
        
        content_type = content_types.get(file_ext, 'audio/mpeg')
        
        return send_file(
            file_path,
            mimetype=content_type,
            as_attachment=False,
            download_name=song.filename
        )
        
    except Exception as e:
        return jsonify({'error': f'Error serving audio: {str(e)}'}), 500

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
            device = db.session.get(Device, device_id)
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
        device = db.session.get(Device, device_id)
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
        
        device = db.session.get(Device, device_id)
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
        
        device = db.session.get(Device, device_id)
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
        
        patch = db.session.get(PatchedDevice, patch_id)
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
        
        patch = db.session.get(PatchedDevice, patch_id)
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
            sequence = db.session.get(Sequence, sequence_id)
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
        sequence = db.session.get(Sequence, sequence_id)
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
        
        sequence = db.session.get(Sequence, sequence_id)
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
        
        original = db.session.get(Sequence, sequence_id)
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
            playlist = db.session.get(Playlist, playlist_id)
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
        
        playlist = db.session.get(Playlist, playlist_id)
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
        
        playlist = db.session.get(Playlist, playlist_id)
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
        
        playlist = db.session.get(Playlist, playlist_id)
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
        
        playlist = db.session.get(Playlist, playlist_id)
        if not playlist:
            return jsonify({'error': 'Playlist not found'}), 404
        
        sequence = db.session.get(Sequence, sequence_id)
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
        
        playlist = db.session.get(Playlist, playlist_id)
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
        song = db.session.get(Song, sequence_data['song_id'])
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

@app.route('/api/play-sequence', methods=['POST'])
def play_sequence_endpoint():
    try:
        data = request.get_json()
        print(f"Received data: {data}")  # Debug logging
        
        if not data:
            return jsonify({'error': 'No data provided'}), 400
        
        # Check if we have a sequence ID (play existing sequence)
        sequence_id = data.get('sequence_id') or data.get('id') or data.get('sequenceId')
        
        if sequence_id:
            sequence = db.session.get(Sequence, sequence_id)
            if not sequence:
                return jsonify({'error': 'Sequence not found'}), 404
            play_sequence(sequence)
            return jsonify({'success': True})
        
        # Check if we have song_id and events (play temporary sequence)
        song_id = data.get('song_id')
        events = data.get('events', [])
        start_time = data.get('start_time', 0)  # Get start time if provided
        
        if song_id is not None:
            song = db.session.get(Song, song_id)
            if not song:
                return jsonify({'error': 'Song not found'}), 404
            
            # Create a temporary sequence object for playback
            class TempSequence:
                def __init__(self, song, events):
                    self.id = 'temp'
                    self.song = song
                    self._events = events
                
                def get_events(self):
                    return self._events
            
            temp_sequence = TempSequence(song, events)
            play_sequence(temp_sequence, start_time)
            return jsonify({'success': True})
        
        return jsonify({'error': 'Either sequence_id or song_id is required'}), 400
    
    except Exception as e:
        print(f"Error in play_sequence_endpoint: {e}")  # Debug logging
        return jsonify({'error': str(e)}), 500

@app.route('/api/play-sequence-by-id', methods=['POST'])
def play_sequence_by_id():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        
        sequence = db.session.get(Sequence, sequence_id)
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
                    'name': getattr(current_sequence, 'name', 'Temporary Sequence'),
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

@app.route('/api/pause-sequence', methods=['POST'])
def pause_sequence():
    try:
        global is_playing
        
        if is_playing:
            is_playing = False
            audio_player.pause()
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/resume-sequence', methods=['POST'])
def resume_sequence():
    try:
        global is_playing
        
        if not is_playing and current_sequence:
            is_playing = True
            audio_player.resume()
        
        return jsonify({'success': True})
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

@app.route('/api/seek-sequence', methods=['POST'])
def seek_sequence():
    try:
        data = request.get_json()
        position = data.get('position', 0)
        
        if not current_sequence:
            return jsonify({'error': 'No sequence currently loaded'}), 400
        
        # Use the seek functionality in AudioPlayer
        success = audio_player.seek(position)
        
        if success:
            return jsonify({'success': True, 'position': position})
        else:
            return jsonify({'error': 'Seek operation failed'}), 500
    
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
        
        # Get external storage info
        external_storage = scan_external_storage()
        
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
        # Get actual network status using nmcli or ip commands
        network_info = get_network_status()
        
        return jsonify({
            'success': True,
            'data': network_info
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/wifi-networks')
def wifi_networks():
    try:
        # Scan for actual WiFi networks
        networks = scan_wifi_networks()
        
        return jsonify({'success': True, 'networks': networks})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Network management helper functions
def get_network_status():
    """Get current network connection status"""
    try:
        # Try nmcli first (NetworkManager)
        result = subprocess.run(['nmcli', 'connection', 'show', '--active'], 
                              capture_output=True, text=True, timeout=10)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:  # Skip header
                active_connection = lines[1].split()
                if len(active_connection) >= 3:
                    conn_name = active_connection[0]
                    conn_type = active_connection[2]
                    
                    # Get IP address
                    ip_result = subprocess.run(['ip', 'route', 'get', '1'], 
                                             capture_output=True, text=True, timeout=5)
                    ip_address = None
                    if ip_result.returncode == 0:
                        for part in ip_result.stdout.split():
                            if part.startswith('src'):
                                ip_index = ip_result.stdout.split().index(part)
                                if ip_index + 1 < len(ip_result.stdout.split()):
                                    ip_address = ip_result.stdout.split()[ip_index + 1]
                                    break
                    
                    return {
                        'connected': True,
                        'ssid': conn_name,
                        'ip_address': ip_address or 'Unknown',
                        'mode': 'wifi' if 'wifi' in conn_type.lower() else 'ethernet'
                    }
        
        # Fallback: check if we have any network interface up
        result = subprocess.run(['ip', 'addr', 'show'], 
                              capture_output=True, text=True, timeout=5)
        
        if result.returncode == 0 and 'inet ' in result.stdout:
            return {
                'connected': True,
                'ssid': 'Unknown',
                'ip_address': 'Connected',
                'mode': 'unknown'
            }
        
        return {
            'connected': False,
            'ssid': None,
            'ip_address': None,
            'mode': 'disconnected'
        }
        
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, Exception):
        # Return basic connection check
        try:
            result = subprocess.run(['ping', '-c', '1', '8.8.8.8'], 
                                  capture_output=True, timeout=3)
            connected = result.returncode == 0
            return {
                'connected': connected,
                'ssid': 'Unknown' if connected else None,
                'ip_address': 'Connected' if connected else None,
                'mode': 'unknown' if connected else 'disconnected'
            }
        except:
            return {
                'connected': False,
                'ssid': None,
                'ip_address': None,
                'mode': 'disconnected'
            }

def scan_wifi_networks():
    """Scan for available WiFi networks"""
    networks = []
    
    try:
        # Try nmcli first (NetworkManager)
        result = subprocess.run(['nmcli', 'device', 'wifi', 'list'], 
                              capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            current_ssid = get_current_ssid()
            
            for line in lines[1:]:  # Skip header
                parts = line.split()
                if len(parts) >= 6:
                    # Parse nmcli output: * SSID MODE CHAN RATE SIGNAL BARS SECURITY
                    connected = parts[0] == '*'
                    ssid = parts[1] if not connected else parts[2]
                    
                    if ssid == '--':
                        continue
                        
                    # Extract signal strength (remove % and dBm)
                    signal_str = parts[5] if not connected else parts[6]
                    signal = 0
                    try:
                        if signal_str.endswith('%'):
                            signal = int(signal_str[:-1])
                        elif 'dBm' in signal_str:
                            # Convert dBm to percentage (rough approximation)
                            dbm = int(signal_str.split()[0])
                            signal = max(0, min(100, (dbm + 100) * 2))
                    except:
                        signal = 0
                    
                    # Check if encrypted
                    security = ' '.join(parts[7:]) if not connected else ' '.join(parts[8:])
                    encrypted = 'WPA' in security or 'WEP' in security
                    
                    networks.append({
                        'ssid': ssid,
                        'signal': signal,
                        'encrypted': encrypted,
                        'connected': connected or ssid == current_ssid
                    })
            
            return networks
            
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        pass
    
    try:
        # Fallback to iwlist (older systems)
        result = subprocess.run(['iwlist', 'scan'], 
                              capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            current_ssid = get_current_ssid()
            
            # Parse iwlist output
            network = {}
            for line in result.stdout.split('\n'):
                line = line.strip()
                
                if 'Cell' in line and 'Address:' in line:
                    if network and 'ssid' in network:
                        networks.append(network)
                    network = {}
                    
                elif 'ESSID:' in line:
                    ssid = line.split('ESSID:')[1].strip('"')
                    if ssid and ssid != '<hidden>':
                        network['ssid'] = ssid
                        network['connected'] = ssid == current_ssid
                        
                elif 'Quality=' in line:
                    try:
                        quality_part = line.split('Quality=')[1].split()[0]
                        if '/' in quality_part:
                            current, maximum = quality_part.split('/')
                            signal = int((int(current) / int(maximum)) * 100)
                            network['signal'] = signal
                    except:
                        network['signal'] = 0
                        
                elif 'Encryption key:' in line:
                    encrypted = 'on' in line.lower()
                    network['encrypted'] = encrypted
            
            # Add last network
            if network and 'ssid' in network:
                networks.append(network)
                
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError):
        pass
    
    # Remove duplicates and sort by signal strength
    unique_networks = {}
    for network in networks:
        ssid = network.get('ssid')
        if ssid and (ssid not in unique_networks or 
                    network.get('signal', 0) > unique_networks[ssid].get('signal', 0)):
            unique_networks[ssid] = network
    
    return sorted(unique_networks.values(), key=lambda x: x.get('signal', 0), reverse=True)

def get_current_ssid():
    """Get currently connected WiFi SSID"""
    try:
        result = subprocess.run(['nmcli', 'connection', 'show', '--active'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            for line in lines[1:]:
                if 'wifi' in line.lower():
                    return line.split()[0]
    except:
        pass
    
    try:
        result = subprocess.run(['iwgetid', '-r'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass
    
    return None

def scan_external_storage():
    """Scan for mounted external storage devices"""
    external_devices = []
    
    try:
        # Read /proc/mounts to find mounted USB devices
        with open('/proc/mounts', 'r') as f:
            mounts = f.read()
        
        # Look for typical USB mount points
        usb_patterns = ['/media/', '/mnt/', '/run/media/']
        
        for line in mounts.split('\n'):
            if not line.strip():
                continue
                
            parts = line.split()
            if len(parts) >= 3:
                device, mount_point, fs_type = parts[:3]
                
                # Skip system mounts
                if any(mount_point.startswith(pattern) for pattern in usb_patterns):
                    try:
                        # Get storage info
                        statvfs = os.statvfs(mount_point)
                        total = statvfs.f_frsize * statvfs.f_blocks
                        used = total - (statvfs.f_frsize * statvfs.f_bavail)
                        
                        # Get device name
                        device_name = os.path.basename(mount_point)
                        
                        external_devices.append({
                            'device': device,
                            'mount_point': mount_point,
                            'name': device_name,
                            'filesystem': fs_type,
                            'total': total,
                            'used': used,
                            'free': total - used
                        })
                    except OSError:
                        continue
                        
    except Exception:
        pass
    
    return external_devices

# Additional network management routes
@app.route('/api/connect-wifi', methods=['POST'])
def connect_wifi():
    try:
        data = request.get_json()
        ssid = data.get('ssid')
        password = data.get('password')
        
        if not ssid:
            return jsonify({'error': 'SSID is required'}), 400
        
        # Try to connect using nmcli
        cmd = ['nmcli', 'device', 'wifi', 'connect', ssid]
        if password:
            cmd.extend(['password', password])
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0:
            return jsonify({
                'success': True,
                'message': f'Connected to {ssid}'
            })
        else:
            return jsonify({
                'error': f'Failed to connect: {result.stderr.strip()}'
            }), 500
            
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Connection timeout'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/disconnect-wifi', methods=['POST'])
def disconnect_wifi():
    try:
        result = subprocess.run(['nmcli', 'connection', 'down', 'id', 'wifi'], 
                              capture_output=True, text=True, timeout=10)
        
        return jsonify({
            'success': True,
            'message': 'Disconnected from WiFi'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/configure-hotspot', methods=['POST'])
def configure_hotspot():
    try:
        data = request.get_json()
        ssid = data.get('ssid', 'DMX-Control-Hotspot')
        password = data.get('password', 'dmxcontrol123')
        
        # Create hotspot using nmcli
        result = subprocess.run([
            'nmcli', 'connection', 'add', 'type', 'wifi', 'ifname', 'wlan0',
            'con-name', 'Hotspot', 'autoconnect', 'yes', 'ssid', ssid,
            'wifi.mode', 'ap', 'wifi.band', 'bg', 'ipv4.method', 'shared',
            'wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password
        ], capture_output=True, text=True, timeout=15)
        
        if result.returncode == 0:
            # Activate the hotspot
            activate_result = subprocess.run([
                'nmcli', 'connection', 'up', 'Hotspot'
            ], capture_output=True, text=True, timeout=10)
            
            if activate_result.returncode == 0:
                return jsonify({
                    'success': True,
                    'message': f'Hotspot "{ssid}" configured and activated'
                })
            else:
                return jsonify({
                    'error': f'Hotspot configured but failed to activate: {activate_result.stderr.strip()}'
                }), 500
        else:
            return jsonify({
                'error': f'Failed to configure hotspot: {result.stderr.strip()}'
            }), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/disable-hotspot', methods=['POST'])
def disable_hotspot():
    try:
        result = subprocess.run(['nmcli', 'connection', 'down', 'Hotspot'], 
                              capture_output=True, text=True, timeout=10)
        
        return jsonify({
            'success': True,
            'message': 'Hotspot disabled'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# System management routes
@app.route('/api/save-security-settings', methods=['POST'])
def save_security_settings():
    try:
        data = request.get_json()
        
        # Store security settings in a config file
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        config_file = os.path.join(config_dir, 'security.json')
        
        settings = {
            'authentication_enabled': data.get('authentication_enabled', False),
            'password_hash': data.get('password_hash', ''),
            'session_timeout': data.get('session_timeout', 3600),
            'updated_at': datetime.now().isoformat()
        }
        
        with open(config_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Security settings saved'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/system-settings')
def system_settings():
    try:
        config_dir = os.path.expanduser('~/.dmx_control')
        config_file = os.path.join(config_dir, 'system.json')
        
        default_settings = {
            'device_name': 'DMX Control System',
            'auto_start': True,
            'dmx_refresh_rate': 25,
            'audio_buffer_size': 1024,
            'max_sequences': 100,
            'backup_enabled': True,
            'debug_mode': False,
            'dark_mode': False
        }
        
        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                settings = json.load(f)
                # Merge with defaults for missing keys
                for key, value in default_settings.items():
                    if key not in settings:
                        settings[key] = value
        else:
            settings = default_settings
        
        return jsonify({
            'success': True,
            'settings': settings
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/save-system-settings', methods=['POST'])
def save_system_settings():
    try:
        data = request.get_json()
        
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        config_file = os.path.join(config_dir, 'system.json')
        
        settings = {
            'device_name': data.get('device_name', 'DMX Control System'),
            'auto_start': data.get('auto_start', True),
            'dmx_refresh_rate': data.get('dmx_refresh_rate', 25),
            'audio_buffer_size': data.get('audio_buffer_size', 1024),
            'max_sequences': data.get('max_sequences', 100),
            'backup_enabled': data.get('backup_enabled', True),
            'debug_mode': data.get('debug_mode', False),
            'dark_mode': data.get('dark_mode', False),
            'updated_at': datetime.now().isoformat()
        }
        
        with open(config_file, 'w') as f:
            json.dump(settings, f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'System settings saved'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/export-all-settings')
def export_all_settings():
    try:
        config_dir = os.path.expanduser('~/.dmx_control')
        
        # Collect all settings
        all_settings = {
            'exported_at': datetime.now().isoformat(),
            'version': '1.0'
        }
        
        # Load system settings
        system_file = os.path.join(config_dir, 'system.json')
        if os.path.exists(system_file):
            with open(system_file, 'r') as f:
                all_settings['system'] = json.load(f)
        
        # Load security settings (excluding sensitive data)
        security_file = os.path.join(config_dir, 'security.json')
        if os.path.exists(security_file):
            with open(security_file, 'r') as f:
                security_settings = json.load(f)
                # Remove sensitive data
                security_settings.pop('password_hash', None)
                all_settings['security'] = security_settings
        
        # Export database data
        devices = [{'id': d.id, 'name': d.name, 'channels': d.get_channels()} 
                  for d in Device.query.all()]
        all_settings['devices'] = devices
        
        patched_devices = [{'id': p.id, 'device_id': p.device_id, 'dmx_address': p.dmx_address,
                           'x_position': p.x_position, 'y_position': p.y_position} 
                          for p in PatchedDevice.query.all()]
        all_settings['patched_devices'] = patched_devices
        
        playlists = [{'id': p.id, 'name': p.name, 'sequence_ids': p.get_sequence_ids()}
                    for p in Playlist.query.all()]
        all_settings['playlists'] = playlists
        
        # Create export file
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'dmx_settings_export_{timestamp}.json'
        export_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        
        with open(export_path, 'w') as f:
            json.dump(all_settings, f, indent=2)
        
        return send_file(export_path, as_attachment=True, download_name=filename)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/import-settings', methods=['POST'])
def import_settings():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file uploaded'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Read and parse the JSON file
        try:
            settings_data = json.load(file)
        except json.JSONDecodeError:
            return jsonify({'error': 'Invalid JSON file'}), 400
        
        # Validate the file format
        if 'version' not in settings_data:
            return jsonify({'error': 'Invalid settings file format'}), 400
        
        config_dir = os.path.expanduser('~/.dmx_control')
        os.makedirs(config_dir, exist_ok=True)
        
        # Import system settings
        if 'system' in settings_data:
            system_file = os.path.join(config_dir, 'system.json')
            with open(system_file, 'w') as f:
                json.dump(settings_data['system'], f, indent=2)
        
        # Import security settings (user will need to reconfigure passwords)
        if 'security' in settings_data:
            security_file = os.path.join(config_dir, 'security.json')
            with open(security_file, 'w') as f:
                json.dump(settings_data['security'], f, indent=2)
        
        return jsonify({
            'success': True,
            'message': 'Settings imported successfully. Please restart the system to apply changes.'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/restart-system', methods=['POST'])
def restart_system():
    try:
        # First try systemctl restart for the service
        try:
            subprocess.run(['sudo', 'systemctl', 'restart', 'dmx-control.service'], 
                          capture_output=True, timeout=5)
            return jsonify({
                'success': True,
                'message': 'System service restarted'
            })
        except:
            pass
        
        # Fallback: restart the Python application
        import signal
        import sys
        
        def restart_app():
            time.sleep(1)  # Give time for response to be sent
            os.execv(sys.executable, ['python'] + sys.argv)
        
        threading.Thread(target=restart_app).start()
        
        return jsonify({
            'success': True,
            'message': 'Application restarting...'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/factory-reset', methods=['POST'])
def factory_reset():
    try:
        data = request.get_json()
        confirm = data.get('confirm', False)
        
        if not confirm:
            return jsonify({'error': 'Factory reset requires confirmation'}), 400
        
        # Create backup before reset
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = os.path.join(os.path.expanduser('~'), 'dmx_control_backups')
        os.makedirs(backup_dir, exist_ok=True)
        
        # Backup database
        import shutil
        db_path = 'lighting_control.db'  # Update with actual database path
        if os.path.exists(db_path):
            backup_db = os.path.join(backup_dir, f'pre_reset_db_{timestamp}.db')
            shutil.copy2(db_path, backup_db)
        
        # Clear database
        with app.app_context():
            db.drop_all()
            db.create_all()
        
        # Clear config files
        config_dir = os.path.expanduser('~/.dmx_control')
        if os.path.exists(config_dir):
            backup_config = os.path.join(backup_dir, f'pre_reset_config_{timestamp}')
            shutil.copytree(config_dir, backup_config)
            shutil.rmtree(config_dir)
        
        # Clear uploads (but keep a backup)
        upload_dir = app.config.get('UPLOAD_FOLDER', 'uploads')
        if os.path.exists(upload_dir):
            backup_uploads = os.path.join(backup_dir, f'pre_reset_uploads_{timestamp}')
            shutil.copytree(upload_dir, backup_uploads)
            shutil.rmtree(upload_dir)
            os.makedirs(upload_dir, exist_ok=True)
        
        return jsonify({
            'success': True,
            'message': f'Factory reset completed. Backup saved to {backup_dir}'
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/dmx-status')
def get_dmx_status():
    """Get current DMX channel values for real-time monitoring"""
    try:
        return jsonify({
            'success': True,
            'channels': dmx_controller.dmx_data,
            'timestamp': time.time()
        })
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