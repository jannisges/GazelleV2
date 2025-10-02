import threading
import time
from app.models.models import Playlist, Sequence, PatchedDevice, db
from app.hardware.hardware import RPI_AVAILABLE, setup_gpio

if RPI_AVAILABLE:
    import RPi.GPIO as GPIO

# GPIO Configuration
BUTTON_PIN = 18

# Global variables
current_sequence = None
is_playing = False
dmx_controller = None
audio_player = None

def init_playback(dmx_ctrl, audio_ctrl):
    """Initialize playback with controller references"""
    global dmx_controller, audio_player
    dmx_controller = dmx_ctrl
    audio_player = audio_ctrl

def button_handler():
    """Handle hardware button presses"""
    if not RPI_AVAILABLE:
        return
    
    setup_gpio()
    
    while True:
        if GPIO.input(BUTTON_PIN) == GPIO.LOW:
            # Button pressed, trigger playback
            trigger_sequence_playback()
            time.sleep(0.5)  # Debounce
        time.sleep(0.1)

def trigger_sequence_playback():
    """Trigger playback from hardware button"""
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
    """Play a lighting sequence"""
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
    """Main loop for sequence playback"""
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
    """Execute a single DMX event"""
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

def stop_playback():
    """Stop current playback"""
    global is_playing, current_sequence
    
    is_playing = False
    current_sequence = None
    if audio_player:
        audio_player.stop()
    
    # Clear all DMX channels
    if dmx_controller:
        for i in range(512):
            dmx_controller.set_channel(i + 1, 0)

def pause_playback():
    """Pause current playback"""
    global is_playing
    
    if is_playing:
        is_playing = False
        if audio_player:
            audio_player.pause()

def resume_playback():
    """Resume paused playback"""
    global is_playing
    
    if not is_playing and current_sequence:
        is_playing = True
        if audio_player:
            audio_player.resume()

def get_playback_status():
    """Get current playback status"""
    if is_playing and current_sequence:
        position = audio_player.get_position() if audio_player else 0
        duration = current_sequence.song.duration
        progress = (position / duration * 100) if duration > 0 else 0
        
        return {
            'is_playing': True,
            'current_sequence': {
                'id': current_sequence.id,
                'name': getattr(current_sequence, 'name', 'Temporary Sequence'),
                'song_name': current_sequence.song.name
            },
            'current_time': position,
            'total_time': duration,
            'progress': progress
        }
    else:
        return {'is_playing': False}