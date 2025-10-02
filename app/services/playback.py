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
flask_app = None
playback_lock = threading.Lock()
last_trigger_time = 0

def init_playback(dmx_ctrl, audio_ctrl, app_instance=None):
    """Initialize playback with controller references"""
    global dmx_controller, audio_player, flask_app
    dmx_controller = dmx_ctrl
    audio_player = audio_ctrl
    flask_app = app_instance

def button_handler():
    """Handle hardware button presses using reliable polling with atomic debouncing"""
    global last_trigger_time
    
    if not RPI_AVAILABLE:
        return
    
    # GPIO should already be set up by main app, just configure the button pin
    try:
        # Don't call GPIO.setmode() again - it's already been called
        GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        
        # Check initial button state
        initial_state = GPIO.input(BUTTON_PIN)
        print(f"[INFO] Button handler initialized, initial state: {initial_state}")
        
        last_trigger_time = 0
        button_state = GPIO.HIGH  # Track button state
        
        while True:
            current_state = GPIO.input(BUTTON_PIN)
            current_time = time.time()
            
            # Detect button press (HIGH to LOW transition)
            if button_state == GPIO.HIGH and current_state == GPIO.LOW:
                # Button just pressed - check debounce time
                if current_time - last_trigger_time > 2.0:
                    print(f"[INFO] Button pressed, starting sequence playback")
                    
                    # Immediately update last_trigger_time to prevent double triggers
                    last_trigger_time = current_time
                    
                    # Wait for button release to ensure clean press
                    while GPIO.input(BUTTON_PIN) == GPIO.LOW:
                        time.sleep(0.05)
                    
                    # Now trigger the sequence
                    trigger_sequence_playback()
                    
                    # Extra delay to prevent any bounce issues
                    time.sleep(0.5)
            
            # Update button state for next iteration
            button_state = current_state
            time.sleep(0.05)  # Fast polling for responsive button detection
            
    except Exception as e:
        print(f"[DEBUG] GPIO setup error: {e}")
        print(f"[DEBUG] Exception details: {type(e).__name__}: {str(e)}")
        return

def trigger_sequence_playback():
    """Trigger playback from hardware button"""
    global current_sequence, is_playing, flask_app
    
    # Use lock to prevent concurrent execution
    if not playback_lock.acquire(blocking=False):
        print("[INFO] Playback already in progress, ignoring button press")
        return
    
    try:
        
        if not flask_app:
            return
        
        with flask_app.app_context():
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
    
    finally:
        playback_lock.release()

def play_sequence(sequence, start_time=0):
    """Play a lighting sequence"""
    global current_sequence, is_playing
    
    # Stop any existing playback completely
    stop_playback()
    
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
    global flask_app
    
    device_id = event.get('device_id')
    event_type = event.get('type')
    value = event.get('value', 0)
    
    if not flask_app:
        return
    
    with flask_app.app_context():
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
        # Small delay to ensure pygame fully stops
        time.sleep(0.1)
    
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