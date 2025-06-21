// Playback controller for sequence editor
class PlaybackController {
    constructor() {
        this.isPlaying = false;
        this.currentPosition = 0;
        this.playStartTime = 0;
        this.playStartPosition = 0;
        this.lastUIUpdate = 0;
        this.playbackInterval = null;
        this.currentSong = null;
        this.currentSequence = { events: [] };
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        const playPauseBtn = document.getElementById('playPauseButton');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => this.togglePlayback());
        }
        
        const stopBtn = document.getElementById('stopBtn');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopSequence());
        }
        
        // Listen for waveform seek events
        const waveformCanvas = document.getElementById('waveformCanvas');
        if (waveformCanvas) {
            waveformCanvas.addEventListener('waveform-seek', (e) => {
                this.seekToPosition(e.detail.time);
            });
        }
    }
    
    setCurrentSong(song) {
        this.currentSong = song;
    }
    
    setCurrentSequence(sequence) {
        this.currentSequence = sequence;
    }
    
    togglePlayback() {
        if (this.isPlaying) {
            this.pauseSequence();
        } else {
            this.playSequence();
        }
    }
    
    playSequence() {
        if (!this.currentSong) {
            alert('Please load a song first');
            return;
        }
        
        console.log('Starting playback from position:', this.currentPosition);
        
        fetch('/api/play-sequence', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                song_id: this.currentSong.id,
                events: this.currentSequence.events,
                start_time: this.currentPosition
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Play response:', data);
            if (data.success) {
                this.isPlaying = true;
                this.updatePlayButton();
                
                // Set playing state for components
                if (window.sequenceEditor) {
                    window.sequenceEditor.setPlaying(true);
                }
                
                // Get initial server position for accurate tracking
                fetch('/api/playback-status')
                .then(response => response.json())
                .then(statusData => {
                    if (statusData.is_playing && statusData.current_time !== undefined) {
                        this.syncWithServerPosition(statusData.current_time);
                    }
                    this.startPlaybackTracking();
                })
                .catch(() => {
                    // Fallback to client position if server check fails
                    this.playStartTime = Date.now();
                    this.playStartPosition = this.currentPosition;
                    this.startPlaybackTracking();
                });
            }
        })
        .catch(error => {
            console.error('Error starting playback:', error);
            alert('Error starting playback: ' + error.message);
        });
    }
    
    pauseSequence() {
        fetch('/api/pause-sequence', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.isPlaying = false;
                this.stopPlaybackTracking();
                this.updatePlayButton();
                
                // Set stopped state for components
                if (window.sequenceEditor) {
                    window.sequenceEditor.setPlaying(false);
                }
            }
        })
        .catch(error => console.error('Error pausing playback:', error));
    }
    
    stopSequence() {
        fetch('/api/stop-sequence', { method: 'POST' })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.isPlaying = false;
                this.currentPosition = 0;
                this.stopPlaybackTracking();
                this.updatePlayButton();
                this.updatePositionDisplay(0);
                this.updateSynchronizedComponents(0);
                
                // Set stopped state for components
                if (window.sequenceEditor) {
                    window.sequenceEditor.setPlaying(false);
                }
            }
        })
        .catch(error => console.error('Error stopping playback:', error));
    }
    
    seekToPosition(time) {
        console.log('Seeking to position:', time);
        this.currentPosition = Math.max(0, time);
        
        // Reset client-side tracking variables
        this.playStartTime = Date.now();
        this.playStartPosition = this.currentPosition;
        
        this.updatePositionDisplay(this.currentPosition);
        this.updateSynchronizedComponents(this.currentPosition);
        
        // If playing, seek without stopping playback
        if (this.isPlaying) {
            console.log('Seeking during playback to position:', time);
            
            fetch('/api/seek-sequence', { 
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ position: this.currentPosition })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Seeked successfully during playback');
                    // Reset tracking to sync with new position
                    this.playStartTime = Date.now();
                    this.playStartPosition = this.currentPosition;
                } else {
                    console.error('Seek failed:', data.error);
                }
            })
            .catch(error => {
                console.error('Error seeking during playback:', error);
            });
        }
    }
    
    startPlaybackTracking() {
        this.stopPlaybackTracking(); // Clear any existing intervals
        console.log('Starting playback tracking');
        
        // Record the start time for smooth client-side tracking
        this.playStartTime = Date.now();
        this.playStartPosition = this.currentPosition;
        this.lastUIUpdate = 0;
        
        // Start client-side playline updates
        this.playbackInterval = setInterval(() => {
            if (this.isPlaying) {
                this.updateClientPosition();
            } else {
                this.stopPlaybackTracking();
            }
        }, 16);
    }
    
    updateClientPosition() {
        if (!this.isPlaying) return;
        
        // Calculate current position based on elapsed time since play started
        const elapsedMs = Date.now() - this.playStartTime;
        const elapsedSeconds = elapsedMs / 1000;
        this.currentPosition = this.playStartPosition + elapsedSeconds;
        
        // Stop if we've reached the end
        if (this.currentSong && this.currentPosition >= this.currentSong.duration) {
            this.currentPosition = this.currentSong.duration;
            this.isPlaying = false;
            this.stopPlaybackTracking();
            this.updatePlayButton();
            
            // Set stopped state for components
            if (window.sequenceEditor) {
                window.sequenceEditor.setPlaying(false);
            }
            return;
        }
        
        // Throttle UI updates to reduce load (max 20fps for UI updates)
        const now = Date.now();
        if (now - this.lastUIUpdate < 50) {
            return; // Skip this update cycle
        }
        this.lastUIUpdate = now;
        
        // Update UI elements
        this.updatePositionDisplay(this.currentPosition);
        this.updateSynchronizedComponents(this.currentPosition);
        
        // Set playing state for waveform renderer and sequence editor
        if (window.waveformRenderer) {
            window.waveformRenderer.setPlaying(true);
        }
        if (window.sequenceEditor) {
            window.sequenceEditor.setPlaying(true);
        }
    }
    
    syncWithServerPosition(serverPosition) {
        this.currentPosition = serverPosition;
        this.playStartTime = Date.now();
        this.playStartPosition = serverPosition;
        
        console.log('Synced client position to server:', serverPosition);
    }
    
    stopPlaybackTracking() {
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
        
        // Ensure proper cleanup of animation loops
        if (window.waveformRenderer) {
            window.waveformRenderer.setPlaying(false);
        }
        if (window.sequenceEditor) {
            window.sequenceEditor.setPlaying(false);
        }
    }
    
    updatePositionDisplay(time) {
        const currentPosElement = document.getElementById('currentPosition');
        if (currentPosElement) {
            currentPosElement.textContent = this.formatTime(time);
        }
    }
    
    updateSynchronizedComponents(time) {
        // Update synchronized components directly
        if (window.waveformRenderer) {
            window.waveformRenderer.setCurrentTime(time);
        }
        if (window.sequenceEditor) {
            window.sequenceEditor.setCurrentTime(time);
        }
    }
    
    updatePlayButton() {
        const playButton = document.getElementById('playPauseButton');
        if (playButton) {
            if (this.isPlaying) {
                playButton.innerHTML = '<i class="bi bi-pause"></i> Pause';
                playButton.onclick = () => this.pauseSequence();
            } else {
                playButton.innerHTML = '<i class="bi bi-play"></i> Play';
                playButton.onclick = () => this.playSequence();
            }
        }
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
    
    getCurrentPosition() {
        return this.currentPosition;
    }
    
    isCurrentlyPlaying() {
        return this.isPlaying;
    }
}