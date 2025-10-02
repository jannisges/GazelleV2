import threading
import time
import pygame

try:
    import RPi.GPIO as GPIO
    RPI_AVAILABLE = True
except ImportError:
    RPI_AVAILABLE = False

# GPIO Configuration
DMX_PIN = 14
BUTTON_PIN = 18

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
        GPIO.setup(DMX_PIN, GPIO.OUT)
        # BUTTON_PIN setup moved to playback service to avoid conflicts

def cleanup_gpio():
    """Cleanup GPIO pins"""
    if RPI_AVAILABLE:
        GPIO.cleanup()