import time
from flask import Blueprint, request, jsonify
from app.models.models import Sequence, Song, PatchedDevice, db
from app.services import playback

playback_api = Blueprint('playback_api', __name__)

@playback_api.route('/api/play-sequence', methods=['POST'])
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
            playback.play_sequence(sequence)
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
            playback.play_sequence(temp_sequence, start_time)
            return jsonify({'success': True})
        
        return jsonify({'error': 'Either sequence_id or song_id is required'}), 400
    
    except Exception as e:
        print(f"Error in play_sequence_endpoint: {e}")  # Debug logging
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/play-sequence-by-id', methods=['POST'])
def play_sequence_by_id():
    try:
        data = request.get_json()
        sequence_id = data.get('sequence_id')
        
        sequence = db.session.get(Sequence, sequence_id)
        if not sequence:
            return jsonify({'error': 'Sequence not found'}), 404
        
        playback.play_sequence(sequence)
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/playback-status')
def playback_status():
    try:
        status = playback.get_playback_status()
        return jsonify(status)
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/pause-sequence', methods=['POST'])
def pause_sequence():
    try:
        playback.pause_playback()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/resume-sequence', methods=['POST'])
def resume_sequence():
    try:
        playback.resume_playback()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/stop-sequence', methods=['POST'])
def stop_sequence():
    try:
        playback.stop_playback()
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/seek-sequence', methods=['POST'])
def seek_sequence():
    try:
        data = request.get_json()
        position = data.get('position', 0)
        
        if not playback.current_sequence:
            return jsonify({'error': 'No sequence currently loaded'}), 400
        
        # Use the seek functionality in AudioPlayer
        success = playback.audio_player.seek(position)
        
        if success:
            return jsonify({'success': True, 'position': position})
        else:
            return jsonify({'error': 'Seek operation failed'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/blackout', methods=['POST'])
def blackout():
    try:
        # Set all channels to 0 efficiently
        playback.dmx_controller.clear_all()

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/master-dimmer', methods=['POST'])
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
                    current_value = playback.dmx_controller.get_channel(dmx_address)
                    new_value = int(current_value * value / 100)
                    playback.dmx_controller.set_channel(dmx_address, new_value)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/master-color', methods=['POST'])
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
                    playback.dmx_controller.set_channel(dmx_address, r)
                elif channel_type == 'green_channel':
                    playback.dmx_controller.set_channel(dmx_address, g)
                elif channel_type == 'blue_channel':
                    playback.dmx_controller.set_channel(dmx_address, b)
        
        return jsonify({'success': True})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/dmx-status')
def get_dmx_status():
    """Get current DMX channel values for real-time monitoring"""
    try:
        return jsonify({
            'success': True,
            'channels': playback.dmx_controller.dmx_data,
            'timestamp': time.time()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/set-dmx-channels', methods=['POST'])
def set_dmx_channels():
    """Set multiple DMX channels at once (for editor preview)"""
    try:
        data = request.get_json()
        channels = data.get('channels', {})

        # Update DMX channels
        for channel_str, value in channels.items():
            channel = int(channel_str)
            if 1 <= channel <= 512:
                playback.dmx_controller.set_channel(channel, value)

        return jsonify({'success': True})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@playback_api.route('/api/test-dmx', methods=['POST'])
def test_dmx():
    """Test DMX output by setting channel 1 to full"""
    try:
        data = request.get_json()
        channel = data.get('channel', 1)
        value = data.get('value', 255)

        print(f"[TEST] Setting DMX channel {channel} to {value}")
        playback.dmx_controller.set_channel(channel, value)

        # Wait a moment and read it back
        time.sleep(0.1)
        actual_value = playback.dmx_controller.get_channel(channel)

        return jsonify({
            'success': True,
            'channel': channel,
            'requested_value': value,
            'actual_value': actual_value,
            'serial_port_active': playback.dmx_controller.serial_port is not None
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500