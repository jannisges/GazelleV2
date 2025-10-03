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
    """Handle hardware button presses - simple edge detection with debouncing"""
    global last_trigger_time

    if not RPI_AVAILABLE:
        return

    try:
        # Setup button with pull-up resistor (button press = LOW)
        GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        print(f"[INFO] Button handler started on GPIO {BUTTON_PIN}")

        # Simple state machine
        button_was_high = True

        while True:
            button_is_high = GPIO.input(BUTTON_PIN) == GPIO.HIGH
            current_time = time.time()

            # Detect falling edge (button pressed)
            if button_was_high and not button_is_high:
                # Debounce by waiting and checking again
                time.sleep(0.05)

                # Confirm button is still pressed
                if GPIO.input(BUTTON_PIN) == GPIO.LOW:
                    # Check cooldown period
                    if current_time - last_trigger_time >= 2.0:
                        print(f"[INFO] Button pressed - triggering playback")
                        last_trigger_time = current_time

                        # Trigger playback in background to avoid blocking
                        threading.Thread(target=trigger_sequence_playback, daemon=True).start()

                        # Wait for button release to prevent repeat triggers
                        while GPIO.input(BUTTON_PIN) == GPIO.LOW:
                            time.sleep(0.05)

                        print(f"[INFO] Button released")
                        button_was_high = True
                        time.sleep(0.1)  # Extra debounce after release
                        continue

            button_was_high = button_is_high
            time.sleep(0.02)

    except Exception as e:
        print(f"[ERROR] Button handler error: {e}")
        import traceback
        traceback.print_exc()
        return

def trigger_sequence_playback():
    """Trigger playback from hardware button - must acquire lock to execute"""
    global current_sequence, is_playing, flask_app

    # Try to acquire lock - if already locked, exit immediately
    lock_acquired = playback_lock.acquire(blocking=False)
    if not lock_acquired:
        print("[WARNING] Trigger ignored - playback already starting")
        return

    try:
        print("[INFO] Lock acquired - starting playback trigger")

        if not flask_app:
            print("[ERROR] Flask app not initialized")
            return

        with flask_app.app_context():
            # Get active playlists
            active_playlists = Playlist.query.filter_by(is_active=True).all()
            if not active_playlists:
                print("[WARNING] No active playlists found")
                return

            # Get first sequence from first playlist
            playlist = active_playlists[0]
            sequence_ids = playlist.get_sequences()
            if not sequence_ids:
                print("[WARNING] Playlist has no sequences")
                return

            sequence = db.session.get(Sequence, sequence_ids[0])
            if not sequence or not sequence.song:
                print("[WARNING] Sequence or song not found")
                return

            print(f"[INFO] Playing sequence: {sequence.name if hasattr(sequence, 'name') else 'Unnamed'}")
            play_sequence(sequence)

            # Hold lock briefly to ensure playback fully initializes
            time.sleep(0.5)
            print("[INFO] Playback started successfully")

    except Exception as e:
        print(f"[ERROR] Playback trigger failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        playback_lock.release()
        print("[INFO] Lock released")

def play_sequence(sequence, start_time=0):
    """Play a lighting sequence"""
    global current_sequence, is_playing

    print(f"[INFO] play_sequence called for: {sequence.song.file_path if sequence.song else 'No song'}")

    # Stop any existing playback completely
    if is_playing:
        print("[INFO] Stopping existing playback")
        stop_playback()

    current_sequence = sequence
    is_playing = True

    # Load and play audio
    if audio_player.load_song(sequence.song.file_path):
        print("[INFO] Audio loaded, starting playback")
        audio_player.play(start_time)

        # Start sequence playback in separate thread
        playback_thread = threading.Thread(target=sequence_playback_loop, args=(sequence, start_time))
        playback_thread.daemon = True
        playback_thread.start()
        print("[INFO] Playback thread started")
    else:
        print("[ERROR] Failed to load audio file")

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

    print("[INFO] Stopping playback")
    is_playing = False
    current_sequence = None

    if audio_player:
        audio_player.stop()
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