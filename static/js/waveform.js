// Waveform display and interaction module

class WaveformRenderer {
    constructor(canvasId, markersId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.markersContainer = document.getElementById(markersId);
        this.waveformData = [];
        this.duration = 0;
        this.zoomLevel = 1;
        this.scrollPosition = 0;
        this.isPlaying = false;
        this.currentTime = 0;
        
        this.setupCanvas();
        this.setupPlayheadOverlay();
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Set canvas size
        const container = this.canvas.parentElement;
        const containerRect = container.getBoundingClientRect();
        
        // Set up canvas dimensions
        this.canvas.width = containerRect.width || 800;
        this.canvas.height = containerRect.height || 200;
        this.canvas.style.width = this.canvas.width + 'px';
        this.canvas.style.height = this.canvas.height + 'px';
        
        // Store resize handler
        this.canvas.resizeHandler = () => {
            const newRect = container.getBoundingClientRect();
            this.canvas.width = newRect.width || 800;
            this.canvas.height = newRect.height || 200;
            this.canvas.style.width = this.canvas.width + 'px';
            this.canvas.style.height = this.canvas.height + 'px';
            this.syncOverlaySize();
            this.render();
        };
        
        // Add resize listener
        window.addEventListener('resize', this.canvas.resizeHandler);
    }
    
    setupPlayheadOverlay() {
        // Create overlay canvas for playhead
        this.playheadOverlay = document.createElement('canvas');
        this.playheadOverlay.style.position = 'absolute';
        this.playheadOverlay.style.top = '0';
        this.playheadOverlay.style.left = '0';
        this.playheadOverlay.style.pointerEvents = 'none';
        this.playheadOverlay.style.zIndex = '10';
        
        // Insert overlay after main canvas
        this.canvas.parentElement.appendChild(this.playheadOverlay);
        this.playheadCtx = this.playheadOverlay.getContext('2d');
        
        // Sync overlay size with main canvas
        this.syncOverlaySize();
        
        // Store resize handler for overlay
        this.playheadOverlay.resizeHandler = () => {
            this.syncOverlaySize();
        };
        
        // Add resize listener for overlay
        window.addEventListener('resize', this.playheadOverlay.resizeHandler);
    }
    
    syncOverlaySize() {
        this.playheadOverlay.width = this.canvas.width;
        this.playheadOverlay.height = this.canvas.height;
        this.playheadOverlay.style.width = this.canvas.style.width;
        this.playheadOverlay.style.height = this.canvas.style.height;
    }
    
    setupEventListeners() {
        // Track dragging state to prevent click after drag
        let isDragging = false;
        let lastX = 0;
        let hasDragged = false;
        
        // Click to seek (only if not dragging)
        this.canvas.addEventListener('click', (e) => {
            if (hasDragged) {
                hasDragged = false; // Reset flag
                return; // Don't seek if we just finished dragging
            }
            
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const time = this.pixelToTime(x);
            this.seekTo(time);
        });
        
        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = (e.clientX - rect.left) / rect.width;
            
            const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25;
            const newZoomLevel = Math.max(1, Math.min(100, this.zoomLevel * zoomFactor));
            
            // Adjust scroll position to zoom toward mouse position
            if (newZoomLevel !== this.zoomLevel) {
                const zoomChange = newZoomLevel / this.zoomLevel;
                const newScrollPosition = Math.max(0, Math.min(1 - 1/newZoomLevel, 
                    this.scrollPosition + mouseX * (1 - 1/zoomChange) / newZoomLevel));
                this.scrollPosition = newScrollPosition;
                this.setZoomLevel(newZoomLevel);
            }
        });
        
        // Drag to scroll when zoomed
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.zoomLevel > 1) {
                isDragging = true;
                hasDragged = false; // Reset drag flag
                lastX = e.clientX;
                this.canvas.style.cursor = 'grabbing';
            }
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const deltaX = e.clientX - lastX;
                const scrollDelta = -(deltaX / this.canvas.width) * (1 / this.zoomLevel);
                const newScrollPosition = Math.max(0, Math.min(1 - 1/this.zoomLevel, 
                    this.scrollPosition + scrollDelta));
                
                if (newScrollPosition !== this.scrollPosition) {
                    this.scrollPosition = newScrollPosition;
                    lastX = e.clientX;
                    hasDragged = true; // Mark that we've dragged
                    this.render();
                    
                    // Dispatch scroll change event for synchronization
                    const event = new CustomEvent('waveform-scroll-change', { 
                        detail: { zoomLevel: this.zoomLevel, scrollPosition: this.scrollPosition } 
                    });
                    this.canvas.dispatchEvent(event);
                }
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            isDragging = false;
            this.canvas.style.cursor = 'default';
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            isDragging = false;
            this.canvas.style.cursor = 'default';
        });
    }
    
    loadWaveform(waveformData, duration) {
        console.log('Loading waveform data:', waveformData);
        console.log('Duration:', duration);
        
        // Verify data alignment and show resolution info
        if (waveformData) {
            const ampLength = waveformData.amplitude ? waveformData.amplitude.length : 0;
            console.log('High-resolution waveform data loaded:');
            console.log('- Amplitude samples:', ampLength.toLocaleString());
            console.log('- Low freq samples:', waveformData.low ? waveformData.low.length.toLocaleString() : 'N/A');
            console.log('- Mid freq samples:', waveformData.mid ? waveformData.mid.length.toLocaleString() : 'N/A');
            console.log('- High freq samples:', waveformData.high ? waveformData.high.length.toLocaleString() : 'N/A');
            if (duration && ampLength) {
                const samplesPerSecond = Math.round(ampLength / duration);
                console.log('- Effective sample rate:', samplesPerSecond.toLocaleString(), 'samples/second');
            }
        }
        
        this.waveformData = waveformData;
        this.duration = duration;
        this.render();
        this.updateMarkers();
    }
    
    setZoomLevel(zoomLevel) {
        const newZoom = Math.max(1, Math.min(100, zoomLevel));
        if (newZoom !== this.zoomLevel) {
            this.zoomLevel = newZoom;
            this.render();
            this.updateMarkers();
            
            // Dispatch zoom change event for synchronization
            const event = new CustomEvent('waveform-zoom-change', { 
                detail: { zoomLevel: this.zoomLevel, scrollPosition: this.scrollPosition } 
            });
            this.canvas.dispatchEvent(event);
        }
    }
    
    syncFromExternal(zoomLevel, scrollPosition) {
        // Update zoom and scroll without triggering events (to avoid infinite loops)
        this.zoomLevel = Math.max(1, Math.min(100, zoomLevel));
        this.scrollPosition = Math.max(0, Math.min(1 - 1/this.zoomLevel, scrollPosition));
        this.render();
        this.updateMarkers();
    }
    
    setCurrentTime(time) {
        this.currentTime = time;
        this.updatePlayhead();
    }
    
    setPlaying(isPlaying) {
        this.isPlaying = isPlaying;
        if (isPlaying) {
            this.startPlaybackAnimation();
        }
    }
    
    startPlaybackAnimation() {
        // Throttle playhead animation to reduce CPU usage
        let lastRender = 0;
        const animate = () => {
            if (this.isPlaying) {
                const now = performance.now();
                // Only render playhead at ~60fps since it's now lightweight
                if (now - lastRender >= 16) {
                    this.updatePlayhead();
                    lastRender = now;
                }
                requestAnimationFrame(animate);
            }
        };
        requestAnimationFrame(animate);
    }
    
    render() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (this.waveformData.length === 0) {
            this.drawPlaceholder();
            return;
        }
        
        // Draw waveform
        this.drawWaveform();
        
        // Update playhead overlay
        this.updatePlayhead();
    }
    
    drawPlaceholder() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        ctx.fillStyle = '#6c757d';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Load an audio file to see waveform', width / 2, height / 2);
    }
    
    drawWaveform() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        // Background
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Get amplitude data for main waveform
        let amplitudeData = [];
        if (this.waveformData && this.waveformData.amplitude) {
            amplitudeData = this.waveformData.amplitude;
        } else if (Array.isArray(this.waveformData)) {
            amplitudeData = this.waveformData;
        }
        
        if (amplitudeData.length === 0) {
            this.drawPlaceholder();
            return;
        }
        
        // Calculate zoom and scroll parameters
        const totalSamples = amplitudeData.length;
        const visibleSamples = totalSamples / this.zoomLevel;
        const startSample = Math.floor(this.scrollPosition * (totalSamples - visibleSamples));
        const endSample = Math.min(totalSamples, startSample + visibleSamples);
        
        // Draw frequency bands if available, otherwise draw simple amplitude waveform
        if (this.waveformData.low && this.waveformData.mid && this.waveformData.high) {
            this.drawFrequencyBands(startSample, endSample, width, height);
        } else {
            // Fallback to simple green waveform if no frequency data
            this.drawSimpleAmplitudeWaveform(amplitudeData, startSample, endSample, width, height);
        }
        
        // Draw center line
        ctx.beginPath();
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    drawSimpleAmplitudeWaveform(amplitudeData, startSample, endSample, width, height) {
        const ctx = this.ctx;
        const centerY = height / 2;
        const maxAmplitude = height * 0.45; // Leave some margin
        
        // Find max amplitude in visible range for proper scaling
        const visibleData = amplitudeData.slice(startSample, endSample);
        const maxAmp = visibleData.reduce((max, val) => Math.max(max, Math.abs(val)), 0);
        const scale = maxAmp > 0 ? maxAmplitude / maxAmp : 1;
        
        // Calculate samples per pixel
        const visibleSamples = endSample - startSample;
        const samplesPerPixel = visibleSamples / width;
        
        // Draw green waveform for simple mode
        ctx.strokeStyle = '#00ff88';
        ctx.lineWidth = 1.5;
        ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';
        
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        
        // Draw upper part of waveform
        for (let x = 0; x < width; x++) {
            const sampleStart = Math.floor(startSample + x * samplesPerPixel);
            const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
            
            // Get peak value for this pixel to avoid aliasing
            let peak = 0;
            const endIndex = Math.min(sampleEnd, amplitudeData.length);
            
            // Optimize for high-resolution data - use step size when dealing with many samples per pixel
            const sampleCount = endIndex - sampleStart;
            if (sampleCount > 100) {
                // For very high resolution, sample every few points to maintain performance
                const step = Math.max(1, Math.floor(sampleCount / 50));
                for (let i = sampleStart; i < endIndex; i += step) {
                    peak = Math.max(peak, Math.abs(amplitudeData[i]));
                }
            } else {
                // For normal resolution, check every sample
                for (let i = sampleStart; i < endIndex; i++) {
                    peak = Math.max(peak, Math.abs(amplitudeData[i]));
                }
            }
            
            const y = centerY - (peak * scale);
            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        
        // Draw lower part (mirrored)
        for (let x = width - 1; x >= 0; x--) {
            const sampleStart = Math.floor(startSample + x * samplesPerPixel);
            const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
            
            let peak = 0;
            const endIndex = Math.min(sampleEnd, amplitudeData.length);
            
            // Optimize for high-resolution data
            const sampleCount = endIndex - sampleStart;
            if (sampleCount > 100) {
                const step = Math.max(1, Math.floor(sampleCount / 50));
                for (let i = sampleStart; i < endIndex; i += step) {
                    peak = Math.max(peak, Math.abs(amplitudeData[i]));
                }
            } else {
                for (let i = sampleStart; i < endIndex; i++) {
                    peak = Math.max(peak, Math.abs(amplitudeData[i]));
                }
            }
            
            const y = centerY + (peak * scale);
            ctx.lineTo(x, y);
        }
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
    
    drawFrequencyBands(startSample, endSample, width, height) {
        const ctx = this.ctx;
        const centerY = height / 2;
        const maxAmplitude = height * 0.45;
        
        // Get frequency band data
        const lowData = this.waveformData.low || [];
        const midData = this.waveformData.mid || [];
        const highData = this.waveformData.high || [];
        
        if (lowData.length === 0 || midData.length === 0 || highData.length === 0) return;
        
        // Ensure all arrays have the same length as amplitude data
        const amplitudeData = this.waveformData.amplitude || [];
        if (lowData.length !== amplitudeData.length || 
            midData.length !== amplitudeData.length || 
            highData.length !== amplitudeData.length) {
            console.warn('Frequency band data length mismatch with amplitude data');
            return;
        }
        
        // Calculate samples per pixel - use same logic as amplitude waveform
        const visibleSamples = endSample - startSample;
        const samplesPerPixel = visibleSamples / width;
        
        // Find max values for normalization in visible range
        const visibleLow = lowData.slice(startSample, endSample);
        const visibleMid = midData.slice(startSample, endSample);
        const visibleHigh = highData.slice(startSample, endSample);
        
        const maxLow = Math.max(visibleLow.reduce((max, val) => Math.max(max, val), 0), 0.001);  // Prevent division by zero
        const maxMid = Math.max(visibleMid.reduce((max, val) => Math.max(max, val), 0), 0.001);
        const maxHigh = Math.max(visibleHigh.reduce((max, val) => Math.max(max, val), 0), 0.001);
        
        // Draw each frequency band as filled waveforms
        const bands = [
            { 
                data: lowData, 
                color: 'rgba(255, 60, 60, 0.8)',  // Bright red for bass
                max: maxLow 
            },
            { 
                data: midData, 
                color: 'rgba(60, 255, 60, 0.8)',  // Bright green for mids
                max: maxMid 
            },
            { 
                data: highData, 
                color: 'rgba(60, 120, 255, 0.8)',  // Bright blue for highs
                max: maxHigh 
            }
        ];
        
        bands.forEach(band => {
            ctx.fillStyle = band.color;
            ctx.strokeStyle = band.color.replace('0.8', '0.9');
            ctx.lineWidth = 0.5;
            
            ctx.beginPath();
            ctx.moveTo(0, centerY);
            
            // Draw upper part - use EXACT same pixel-to-sample mapping as amplitude
            for (let x = 0; x < width; x++) {
                const sampleStart = Math.floor(startSample + x * samplesPerPixel);
                const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
                
                // Get peak value for this pixel - exact same logic as amplitude waveform
                let peak = 0;
                const endIndex = Math.min(sampleEnd, band.data.length);
                const sampleCount = endIndex - sampleStart;
                
                if (sampleCount > 100) {
                    const step = Math.max(1, Math.floor(sampleCount / 50));
                    for (let i = sampleStart; i < endIndex; i += step) {
                        const normalized = band.data[i] / band.max;
                        peak = Math.max(peak, normalized);
                    }
                } else {
                    for (let i = sampleStart; i < endIndex; i++) {
                        const normalized = band.data[i] / band.max;
                        peak = Math.max(peak, normalized);
                    }
                }
                
                const y = centerY - (peak * maxAmplitude); // Full amplitude range
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            
            // Draw lower part (mirrored) - exact same logic
            for (let x = width - 1; x >= 0; x--) {
                const sampleStart = Math.floor(startSample + x * samplesPerPixel);
                const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
                
                let peak = 0;
                const endIndex = Math.min(sampleEnd, band.data.length);
                const sampleCount = endIndex - sampleStart;
                
                if (sampleCount > 100) {
                    const step = Math.max(1, Math.floor(sampleCount / 50));
                    for (let i = sampleStart; i < endIndex; i += step) {
                        const normalized = band.data[i] / band.max;
                        peak = Math.max(peak, normalized);
                    }
                } else {
                    for (let i = sampleStart; i < endIndex; i++) {
                        const normalized = band.data[i] / band.max;
                        peak = Math.max(peak, normalized);
                    }
                }
                
                const y = centerY + (peak * maxAmplitude);
                ctx.lineTo(x, y);
            }
            
            ctx.closePath();
            ctx.fill();
        });
    }
    
    updatePlayhead() {
        if (!this.playheadCtx) return;
        
        // Clear entire overlay
        this.playheadCtx.clearRect(0, 0, this.playheadOverlay.width, this.playheadOverlay.height);
        
        // Draw playhead if we have a current time
        if (this.currentTime > 0) {
            const x = this.timeToPixel(this.currentTime);
            const width = this.playheadOverlay.width;
            const height = this.playheadOverlay.height;
            
            if (x >= 0 && x <= width) {
                this.playheadCtx.beginPath();
                this.playheadCtx.strokeStyle = '#dc3545';
                this.playheadCtx.lineWidth = 2;
                this.playheadCtx.moveTo(x, 0);
                this.playheadCtx.lineTo(x, height);
                this.playheadCtx.stroke();
            }
        }
    }
    
    updateMarkers() {
        if (!this.markersContainer) return;
        
        this.markersContainer.innerHTML = '';
        
        if (this.duration === 0) return;
        
        const width = this.markersContainer.clientWidth;
        const visibleDuration = this.duration / this.zoomLevel;
        
        // Calculate marker interval based on zoom level
        let interval = 1; // seconds
        if (visibleDuration > 600) interval = 60;
        else if (visibleDuration > 300) interval = 30;
        else if (visibleDuration > 120) interval = 10;
        else if (visibleDuration > 60) interval = 5;
        else if (visibleDuration > 30) interval = 2;
        else if (visibleDuration > 10) interval = 1;
        else if (visibleDuration > 5) interval = 0.5;
        else interval = 0.1;
        
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        const endTime = startTime + visibleDuration;
        
        for (let time = Math.ceil(startTime / interval) * interval; time <= endTime; time += interval) {
            const x = this.timeToPixel(time);
            
            if (x >= 0 && x <= width) {
                const marker = document.createElement('div');
                marker.className = 'timeline-marker';
                marker.style.left = x + 'px';
                
                // Major markers based on interval
                const majorInterval = interval >= 1 ? interval * 5 : interval * 10;
                const isMajor = Math.abs(time % majorInterval) < 0.001;
                
                if (isMajor) {
                    marker.classList.add('major');
                    
                    const label = document.createElement('div');
                    label.className = 'timeline-label';
                    label.textContent = this.formatTime(time);
                    label.style.left = x + 'px';
                    this.markersContainer.appendChild(label);
                }
                
                this.markersContainer.appendChild(marker);
            }
        }
    }
    
    timeToPixel(time) {
        if (this.duration === 0) return 0;
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        return ((time - startTime) / visibleDuration) * this.canvas.width;
    }
    
    pixelToTime(pixel) {
        if (this.duration === 0) return 0;
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * (this.duration - visibleDuration);
        return startTime + (pixel / this.canvas.width) * visibleDuration;
    }
    
    seekTo(time) {
        // Dispatch seek event
        const event = new CustomEvent('waveform-seek', { detail: { time } });
        this.canvas.dispatchEvent(event);
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const wholeSecs = Math.floor(seconds % 60);
        
        if (seconds < 10 && seconds % 1 !== 0) {
            // Show decimal for small values
            return `${seconds.toFixed(1)}s`;
        } else {
            return `${minutes}:${wholeSecs.toString().padStart(2, '0')}`;
        }
    }
}

// Initialize waveform when DOM is ready
function initializeWaveform() {
    if (document.getElementById('waveformCanvas')) {
        window.waveformRenderer = new WaveformRenderer('waveformCanvas', 'waveformMarkers');
        
        // Set up synchronization with sequence editor
        setupTimelineSync();
    }
}

// Render waveform with data
function renderWaveform(waveformData, duration = null) {
    if (window.waveformRenderer && waveformData) {
        const waveformDuration = duration || (currentSong ? currentSong.duration : 0);
        window.waveformRenderer.loadWaveform(waveformData, waveformDuration);
    }
}

// Update timeline markers
function updateTimeline() {
    if (window.waveformRenderer) {
        window.waveformRenderer.updateMarkers();
    }
}

// Set up synchronization between waveform and sequence editor
function setupTimelineSync() {
    if (!window.waveformRenderer || !window.sequenceEditor) return;
    
    // Listen for waveform changes and sync to sequence editor
    document.getElementById('waveformCanvas').addEventListener('waveform-zoom-change', (e) => {
        if (window.sequenceEditor) {
            window.sequenceEditor.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
        }
    });
    
    document.getElementById('waveformCanvas').addEventListener('waveform-scroll-change', (e) => {
        if (window.sequenceEditor) {
            window.sequenceEditor.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
        }
    });
    
    // Listen for sequence editor changes and sync to waveform
    document.getElementById('sequenceContainer').addEventListener('sequence-zoom-change', (e) => {
        if (window.waveformRenderer) {
            window.waveformRenderer.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
        }
    });
    
    document.getElementById('sequenceContainer').addEventListener('sequence-scroll-change', (e) => {
        if (window.waveformRenderer) {
            window.waveformRenderer.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
        }
    });
}

// Update playhead on both timelines simultaneously
function updateSynchronizedPlayhead(time) {
    if (window.waveformRenderer) {
        window.waveformRenderer.setCurrentTime(time);
    }
    if (window.sequenceEditor) {
        window.sequenceEditor.setCurrentTime(time);
    }
}