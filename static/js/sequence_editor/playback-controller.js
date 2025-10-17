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
        this.activeEvents = new Set(); // Track currently active events
        this.lastCheckedTime = 0; // Track last event check time

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

            // Reset all active events when playback ends
            this.resetAllActiveEvents();

            // Set stopped state for components
            if (window.sequenceEditor) {
                window.sequenceEditor.setPlaying(false);
            }
            return;
        }

        // Check for event start/end transitions
        this.checkEventTransitions(this.currentPosition);

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

        // Reset all active events when stopping
        this.resetAllActiveEvents();

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

    checkEventTransitions(currentTime) {
        if (!this.currentSequence || !this.currentSequence.events) return;

        // Check all events for start/end transitions
        this.currentSequence.events.forEach(event => {
            const eventEndTime = event.time + (event.duration || 2.0);
            const eventId = event.id;

            // Check if event should be active
            const shouldBeActive = currentTime >= event.time && currentTime < eventEndTime;

            if (shouldBeActive && !this.activeEvents.has(eventId)) {
                // Event just started - it's already handled by backend
                this.activeEvents.add(eventId);
                console.log('[DMX] Event', eventId, 'started at', currentTime);
            } else if (!shouldBeActive && this.activeEvents.has(eventId)) {
                // Event just ended - reset DMX
                this.activeEvents.delete(eventId);
                console.log('[DMX] Event', eventId, 'ended at', currentTime, '- resetting');
                this.resetEventDMX(event);
            }
        });
    }

    resetEventDMX(event) {
        console.log('[DMX Reset] Resetting event:', event.id, 'type:', event.type);

        // Get patched devices info
        if (!window.eventModal || !window.eventModal.patchedDevices) {
            console.warn('[DMX Reset] No patched devices available');
            return;
        }

        const patchedDevices = window.eventModal.patchedDevices;
        const selectedPatch = patchedDevices.find(p => p.id === event.device_id);

        if (!selectedPatch) {
            console.warn('[DMX Reset] Device not found:', event.device_id);
            return;
        }

        const channels = selectedPatch.device.channels;
        const startAddress = selectedPatch.start_address;
        const dmxChannels = {};

        // Reset DMX channels to 0 based on event type
        switch (event.type) {
            case 'dimmer':
                channels.forEach((channel, index) => {
                    if (channel.type === 'dimmer_channel') {
                        const dmxAddress = startAddress + index;
                        dmxChannels[dmxAddress] = 0;
                        console.log(`[DMX Reset] Dimmer: CH${dmxAddress} = 0`);
                    }
                });
                break;

            case 'color':
                channels.forEach((channel, index) => {
                    const dmxAddress = startAddress + index;
                    if (channel.type === 'red_channel' ||
                        channel.type === 'green_channel' ||
                        channel.type === 'blue_channel') {
                        dmxChannels[dmxAddress] = 0;
                        console.log(`[DMX Reset] Color: CH${dmxAddress} = 0`);
                    }
                });
                break;

            case 'position':
                channels.forEach((channel, index) => {
                    const dmxAddress = startAddress + index;
                    if (channel.type === 'pan' || channel.type === 'tilt') {
                        dmxChannels[dmxAddress] = 0;
                        console.log(`[DMX Reset] Position: CH${dmxAddress} = 0`);
                    }
                });
                break;
        }

        // Send reset command to backend
        if (Object.keys(dmxChannels).length > 0) {
            console.log('[DMX Reset] Sending reset to backend:', dmxChannels);
            fetch('/api/set-dmx-channels', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ channels: dmxChannels })
            })
            .then(response => response.json())
            .then(data => {
                console.log('[DMX Reset] Backend response:', data);
            })
            .catch(error => {
                console.error('[DMX Reset] Error:', error);
            });
        }
    }

    resetAllActiveEvents() {
        console.log('[DMX Reset] Resetting all active events:', this.activeEvents.size);

        // Reset all currently active events
        if (this.currentSequence && this.currentSequence.events) {
            this.currentSequence.events.forEach(event => {
                if (this.activeEvents.has(event.id)) {
                    this.resetEventDMX(event);
                }
            });
        }

        // Clear the active events set
        this.activeEvents.clear();
    }
}