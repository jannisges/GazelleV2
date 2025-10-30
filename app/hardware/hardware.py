import threading
import time
import pygame
import serial
import sys

try:
    import RPi.GPIO as GPIO
    RPI_AVAILABLE = True
except ImportError:
    RPI_AVAILABLE = False

# GPIO Configuration
BUTTON_PIN = 18

# DMX UART Configuration
DMX_UART_PORT = '/dev/ttyAMA0'
DMX_BAUDRATE = 250000
DMX_BREAK_BAUDRATE = 90000  # For generating the break signal

class DMXController:
    """
    DMX512 Controller using UART hardware on Raspberry Pi
    Sends DMX frames at approximately 44Hz refresh rate
    """
    def __init__(self):
        self.dmx_data = bytearray(512)  # Use bytearray for better performance
        self.running = False
        self.thread = None
        self.serial_port = None
        self.lock = threading.Lock()  # Thread-safe channel updates
        self._init_uart()

    def _init_uart(self):
        """Initialize the UART serial port for DMX transmission"""
        try:
            self.serial_port = serial.Serial(
                port=DMX_UART_PORT,
                baudrate=DMX_BAUDRATE,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_TWO,
                timeout=None,
                write_timeout=None,
                xonxoff=False,
                rtscts=False,
                dsrdtr=False
            )
            # Clear buffers
            self.serial_port.reset_output_buffer()
            self.serial_port.reset_input_buffer()
            print(f"DMX UART initialized on {DMX_UART_PORT} at {DMX_BAUDRATE} baud")
        except Exception as e:
            print(f"Failed to initialize DMX UART: {e}")
            self.serial_port = None

    def start(self):
        """Start the DMX output thread"""
        if not self.running and self.serial_port:
            self.running = True
            self.thread = threading.Thread(target=self._output_loop, daemon=True)
            self.thread.start()
            print("DMX output started")

    def stop(self):
        """Stop the DMX output thread and close serial port"""
        self.running = False
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1.0)
        if self.serial_port and self.serial_port.is_open:
            self.serial_port.close()
        print("DMX output stopped")

    def set_channel(self, channel, value):
        """Set a DMX channel value (1-512)"""
        if 1 <= channel <= 512:
            with self.lock:
                self.dmx_data[channel - 1] = max(0, min(255, int(value)))

    def get_channel(self, channel):
        """Get a DMX channel value (1-512)"""
        if 1 <= channel <= 512:
            with self.lock:
                return self.dmx_data[channel - 1]
        return 0

    def set_channels(self, channel_dict):
        """Set multiple channels at once for better performance"""
        with self.lock:
            for channel, value in channel_dict.items():
                if 1 <= channel <= 512:
                    self.dmx_data[channel - 1] = max(0, min(255, int(value)))

    def clear_all(self):
        """Clear all DMX channels to 0 efficiently"""
        with self.lock:
            self.dmx_data = bytearray(512)  # Reset all to 0 instantly

    def _output_loop(self):
        """Main DMX transmission loop - runs at ~44Hz"""
        frame_time = 0.0227  # ~44Hz (22.7ms per frame)

        while self.running:
            start_time = time.time()

            try:
                self._send_dmx_frame()
            except Exception as e:
                print(f"Error in DMX output loop: {e}")

            # Maintain consistent frame rate
            elapsed = time.time() - start_time
            sleep_time = frame_time - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    def _send_dmx_frame(self):
        """Send a complete DMX512 frame using baudrate switching method"""
        if not self.serial_port or not self.serial_port.is_open:
            return

        try:
            # Build DMX packet
            with self.lock:
                packet = bytearray([0])  # Start code
                packet.extend(self.dmx_data)  # Copy all 512 channels

            # DMX BREAK: Switch to lower baudrate and send 0x00
            # At 90000 baud, one byte (with start/stop bits) = ~111µs
            # This creates the BREAK signal
            self.serial_port.baudrate = DMX_BREAK_BAUDRATE
            self.serial_port.write(bytearray([0]))
            self.serial_port.flush()

            # Mark After Break (MAB): Switch back to DMX baudrate
            # Small delay ensures MAB timing (typically 8-12µs)
            self.serial_port.baudrate = DMX_BAUDRATE
            time.sleep(0.00001)  # 10µs MAB

            # Send DMX packet (start code + 512 channels)
            self.serial_port.write(packet)
            self.serial_port.flush()

        except Exception as e:
            print(f"[ERROR] DMX: {e}")

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

def setup_gpio():
    """Initialize GPIO pins"""
    if RPI_AVAILABLE:
        GPIO.setmode(GPIO.BCM)
        # DMX now uses UART (ttyAMA0) instead of GPIO bit-banging
        # BUTTON_PIN setup moved to playback service to avoid conflicts

def cleanup_gpio():
    """Cleanup GPIO pins"""
    if RPI_AVAILABLE:
        GPIO.cleanup()