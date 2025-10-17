import threading
import time
import random
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
current_playlist_index = 0  # Track which playlist we're on
current_sequence_index = 0  # Track which sequence in playlist
shuffled_sequence_order = []  # Store shuffled order for random mode

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
    global current_sequence, is_playing, flask_app, current_playlist_index, current_sequence_index, shuffled_sequence_order

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

            # Ensure playlist index is valid
            if current_playlist_index >= len(active_playlists):
                current_playlist_index = 0

            # Get current playlist
            playlist = active_playlists[current_playlist_index]
            sequence_ids = playlist.get_sequences()
            if not sequence_ids:
                print("[WARNING] Playlist has no sequences")
                # Move to next playlist
                current_playlist_index = (current_playlist_index + 1) % len(active_playlists)
                current_sequence_index = 0
                shuffled_sequence_order = []
                return

            # Select sequence based on random mode
            if playlist.random_mode:
                # Random mode: shuffle once, then play in that order
                # Check if we need to create a new shuffle (playlist changed or finished)
                if (not shuffled_sequence_order or
                    set(shuffled_sequence_order) != set(sequence_ids) or
                    current_sequence_index >= len(shuffled_sequence_order)):
                    shuffled_sequence_order = sequence_ids.copy()
                    random.shuffle(shuffled_sequence_order)
                    current_sequence_index = 0
                    print(f"[INFO] Random mode: shuffled playlist")

                sequence_id = shuffled_sequence_order[current_sequence_index]
                print(f"[INFO] Random mode: playing {current_sequence_index + 1}/{len(shuffled_sequence_order)} from shuffled order")

                # Move to next in shuffled order
                current_sequence_index += 1
                if current_sequence_index >= len(shuffled_sequence_order):
                    # Finished shuffled playlist, move to next playlist and reshuffle
                    current_sequence_index = 0
                    current_playlist_index = (current_playlist_index + 1) % len(active_playlists)
                    shuffled_sequence_order = []
            else:
                # Cycle mode: pick next sequence in order
                if current_sequence_index >= len(sequence_ids):
                    current_sequence_index = 0
                sequence_id = sequence_ids[current_sequence_index]
                print(f"[INFO] Cycle mode: selecting sequence {current_sequence_index + 1}/{len(sequence_ids)}")

                # Move to next sequence for next button press
                current_sequence_index += 1
                if current_sequence_index >= len(sequence_ids):
                    # Finished playlist, move to next one
                    current_sequence_index = 0
                    current_playlist_index = (current_playlist_index + 1) % len(active_playlists)

            sequence = db.session.get(Sequence, sequence_id)
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

    print(f"[PLAYBACK] Starting sequence loop with {len(events)} events")

    start_time = time.time()
    event_index = 0
    active_events = []  # Track events that need to be cleared at end_time

    # Skip events that are before the start time offset
    while event_index < len(events) and events[event_index].get('time', 0) < start_time_offset:
        event_index += 1

    print(f"[PLAYBACK] Starting from event index {event_index}")

    while is_playing and (event_index < len(events) or active_events):
        current_time = time.time() - start_time + start_time_offset

        # Execute new events
        while event_index < len(events):
            event = events[event_index]
            if current_time >= event.get('time', 0):
                print(f"[PLAYBACK] Executing event {event_index}: {event}")
                execute_dmx_event(event)

                # Track all events for cleanup at end_time
                active_events.append(event)
                event_index += 1
            else:
                break

        # Check for events that need to be cleared
        events_to_remove = []
        for active_event in active_events:
            # Calculate end_time from start time + duration
            event_start_time = active_event.get('time', 0)
            event_duration = active_event.get('duration', 2.0)  # Default 2 seconds
            event_end_time = event_start_time + event_duration

            if current_time >= event_end_time:
                print(f"[PLAYBACK] Event ended at {event_end_time:.2f}s (duration: {event_duration}s) - clearing DMX")
                clear_dmx_event(active_event)
                events_to_remove.append(active_event)

        # Remove cleared events from active list
        for event in events_to_remove:
            active_events.remove(event)

        time.sleep(0.01)  # 10ms precision

    print(f"[PLAYBACK] Sequence loop finished")

def execute_dmx_event(event):
    """Execute a single DMX event"""
    global flask_app

    patched_device_id = event.get('device_id')
    event_type = event.get('type')
    value = event.get('value', 0)

    print(f"[DMX] Executing event - patched_device_id: {patched_device_id}, type: {event_type}, value: {value}")

    if not flask_app:
        print("[DMX] ERROR: No flask_app")
        return

    with flask_app.app_context():
        # Query by patched device ID (not device template ID)
        patched_device = db.session.get(PatchedDevice, patched_device_id)
        if not patched_device:
            print(f"[DMX] ERROR: No patched device found for ID {patched_device_id}")
            return

        device = patched_device.device
        channels = device.get_channels()

        print(f"[DMX] Found device: {device.name}, start_address: {patched_device.start_address}, channels: {len(channels)}")

        for i, channel in enumerate(channels):
            dmx_address = patched_device.start_address + i
            channel_type = channel.get('type')

            if event_type == 'dimmer' and channel_type == 'dimmer_channel':
                dmx_value = int(value * 255 / 100)
                print(f"[DMX] Setting dimmer CH{dmx_address} = {dmx_value}")
                dmx_controller.set_channel(dmx_address, dmx_value)
            elif event_type == 'color':
                # Handle both hex string and RGB dict formats
                color_value = event.get('color')
                if isinstance(color_value, str):
                    # Convert hex to RGB
                    hex_color = color_value.lstrip('#')
                    r = int(hex_color[0:2], 16)
                    g = int(hex_color[2:4], 16)
                    b = int(hex_color[4:6], 16)
                    color = {'r': r, 'g': g, 'b': b}
                    print(f"[DMX] Converted hex {color_value} to RGB: r={r}, g={g}, b={b}")
                else:
                    color = color_value or {}

                if channel_type == 'red_channel':
                    print(f"[DMX] Setting red CH{dmx_address} = {color.get('r', 0)}")
                    dmx_controller.set_channel(dmx_address, color.get('r', 0))
                elif channel_type == 'green_channel':
                    print(f"[DMX] Setting green CH{dmx_address} = {color.get('g', 0)}")
                    dmx_controller.set_channel(dmx_address, color.get('g', 0))
                elif channel_type == 'blue_channel':
                    print(f"[DMX] Setting blue CH{dmx_address} = {color.get('b', 0)}")
                    dmx_controller.set_channel(dmx_address, color.get('b', 0))
                elif channel_type == 'white_channel':
                    print(f"[DMX] Setting white CH{dmx_address} = {color.get('w', 0)}")
                    dmx_controller.set_channel(dmx_address, color.get('w', 0))
            elif event_type == 'position':
                if channel_type == 'pan':
                    print(f"[DMX] Setting pan CH{dmx_address} = {value.get('pan', 0)}")
                    dmx_controller.set_channel(dmx_address, value.get('pan', 0))
                elif channel_type == 'tilt':
                    print(f"[DMX] Setting tilt CH{dmx_address} = {value.get('tilt', 0)}")
                    dmx_controller.set_channel(dmx_address, value.get('tilt', 0))

def clear_dmx_event(event):
    """Clear DMX channels for an event (set to 0)"""
    global flask_app

    patched_device_id = event.get('device_id')
    event_type = event.get('type')

    print(f"[DMX] Clearing event - patched_device_id: {patched_device_id}, type: {event_type}")

    if not flask_app:
        print("[DMX] ERROR: No flask_app")
        return

    with flask_app.app_context():
        # Query by patched device ID (not device template ID)
        patched_device = db.session.get(PatchedDevice, patched_device_id)
        if not patched_device:
            print(f"[DMX] ERROR: No patched device found for ID {patched_device_id}")
            return

        device = patched_device.device
        channels = device.get_channels()

        print(f"[DMX] Clearing device: {device.name}, start_address: {patched_device.start_address}, channels: {len(channels)}")

        for i, channel in enumerate(channels):
            dmx_address = patched_device.start_address + i
            channel_type = channel.get('type')

            # Clear channels based on event type
            if event_type == 'dimmer' and channel_type == 'dimmer_channel':
                print(f"[DMX] Clearing dimmer CH{dmx_address} = 0")
                dmx_controller.set_channel(dmx_address, 0)
            elif event_type == 'color':
                if channel_type in ['red_channel', 'green_channel', 'blue_channel', 'white_channel']:
                    print(f"[DMX] Clearing color channel CH{dmx_address} = 0")
                    dmx_controller.set_channel(dmx_address, 0)
            elif event_type == 'position':
                if channel_type in ['pan', 'tilt']:
                    print(f"[DMX] Clearing position channel CH{dmx_address} = 0")
                    dmx_controller.set_channel(dmx_address, 0)

def stop_playback():
    """Stop current playback"""
    global is_playing, current_sequence

    print("[INFO] Stopping playback")
    is_playing = False
    current_sequence = None

    if audio_player:
        audio_player.stop()
        time.sleep(0.1)

    # Clear all DMX channels efficiently
    if dmx_controller:
        dmx_controller.clear_all()

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