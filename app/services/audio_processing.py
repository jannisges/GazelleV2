import os
import json
import numpy as np
import librosa
from flask import jsonify, request, send_file
from app.models.models import Song, db

# Fix for scipy compatibility
try:
    import scipy.signal
    if not hasattr(scipy.signal, 'hann'):
        scipy.signal.hann = scipy.signal.windows.hann
except ImportError:
    pass

def process_audio_upload(app):
    """Process uploaded audio file and extract waveform data"""
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
        low_freq_data, mid_freq_data, high_freq_data = process_frequency_bands(y, sr, len(waveform_amplitude))
        
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

def process_frequency_bands(y, sr, target_length):
    """Process audio into frequency bands for visualization"""
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
    if len(low_band) != target_length:
        try:
            from scipy import interpolate
            x_old = np.linspace(0, 1, len(low_band))
            x_new = np.linspace(0, 1, target_length)
            
            f_low = interpolate.interp1d(x_old, low_band, kind='linear', fill_value='extrapolate')
            f_mid = interpolate.interp1d(x_old, mid_band, kind='linear', fill_value='extrapolate')
            f_high = interpolate.interp1d(x_old, high_band, kind='linear', fill_value='extrapolate')
            
            low_band = [float(val) for val in f_low(x_new)]
            mid_band = [float(val) for val in f_mid(x_new)]
            high_band = [float(val) for val in f_high(x_new)]
        except ImportError:
            # Simple linear interpolation using numpy
            ratio = target_length / len(low_band)
            new_indices = np.arange(target_length) / ratio
            low_band = [float(np.interp(new_indices, np.arange(len(low_band)), low_band)[i]) for i in range(target_length)]
            mid_band = [float(np.interp(new_indices, np.arange(len(mid_band)), mid_band)[i]) for i in range(target_length)]
            high_band = [float(np.interp(new_indices, np.arange(len(high_band)), high_band)[i]) for i in range(target_length)]
    
    return low_band, mid_band, high_band

def serve_audio_preview(app, song_id):
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