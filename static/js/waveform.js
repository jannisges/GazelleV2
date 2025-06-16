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
        this.setupEventListeners();
    }
    
    setupCanvas() {
        // Set canvas size
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        
        // Store resize handler
        this.canvas.resizeHandler = () => {
            this.canvas.width = container.clientWidth;
            this.canvas.height = container.clientHeight;
            this.render();
        };
        
        // Set up high DPI display
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.canvas.style.width = rect.width + 'px';
        this.canvas.style.height = rect.height + 'px';
    }
    
    setupEventListeners() {
        // Click to seek
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const time = this.pixelToTime(x);
            this.seekTo(time);
        });
        
        // Mouse wheel for zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            this.setZoomLevel(this.zoomLevel * zoomFactor);
        });
    }
    
    loadWaveform(waveformData, duration) {
        this.waveformData = waveformData;
        this.duration = duration;
        this.render();
        this.updateMarkers();
    }
    
    setZoomLevel(zoomLevel) {
        this.zoomLevel = Math.max(1, Math.min(100, zoomLevel));
        this.render();
        this.updateMarkers();
    }
    
    setCurrentTime(time) {
        this.currentTime = time;
        this.render();
    }
    
    setPlaying(isPlaying) {
        this.isPlaying = isPlaying;
        if (isPlaying) {
            this.startPlaybackAnimation();
        }
    }
    
    startPlaybackAnimation() {
        const animate = () => {
            if (this.isPlaying) {
                this.render();
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
        
        // Draw playhead
        if (this.currentTime > 0) {
            this.drawPlayhead();
        }
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
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, width, height);
        
        // Calculate visible range
        const samplesPerPixel = this.waveformData.length / (width / this.zoomLevel);
        const startSample = Math.floor(this.scrollPosition * samplesPerPixel);
        const endSample = Math.min(this.waveformData.length, startSample + width * samplesPerPixel);
        
        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 1;
        
        const centerY = height / 2;
        const amplitude = height * 0.4;
        
        for (let x = 0; x < width; x++) {
            const sampleIndex = Math.floor(startSample + x * samplesPerPixel);
            if (sampleIndex < this.waveformData.length) {
                const sample = this.waveformData[sampleIndex];
                const y = centerY + sample * amplitude;
                
                if (x === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
        }
        
        ctx.stroke();
        
        // Draw center line
        ctx.beginPath();
        ctx.strokeStyle = '#dee2e6';
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
    }
    
    drawPlayhead() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        
        const x = this.timeToPixel(this.currentTime);
        
        if (x >= 0 && x <= width) {
            ctx.beginPath();
            ctx.strokeStyle = '#dc3545';
            ctx.lineWidth = 2;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }
    
    updateMarkers() {
        if (!this.markersContainer) return;
        
        this.markersContainer.innerHTML = '';
        
        if (this.duration === 0) return;
        
        const width = this.markersContainer.clientWidth;
        const visibleDuration = this.duration / this.zoomLevel;
        
        // Calculate marker interval
        let interval = 1; // seconds
        if (visibleDuration > 600) interval = 60;
        else if (visibleDuration > 120) interval = 30;
        else if (visibleDuration > 60) interval = 10;
        else if (visibleDuration > 30) interval = 5;
        
        const startTime = this.scrollPosition * this.duration / this.zoomLevel;
        const endTime = startTime + visibleDuration;
        
        for (let time = Math.ceil(startTime / interval) * interval; time <= endTime; time += interval) {
            const x = this.timeToPixel(time);
            
            if (x >= 0 && x <= width) {
                const marker = document.createElement('div');
                marker.className = 'timeline-marker';
                marker.style.left = x + 'px';
                
                // Major markers every minute or based on zoom
                const isMajor = time % (interval * 5) === 0;
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
        const startTime = this.scrollPosition * this.duration / this.zoomLevel;
        return ((time - startTime) / visibleDuration) * this.canvas.width;
    }
    
    pixelToTime(pixel) {
        const visibleDuration = this.duration / this.zoomLevel;
        const startTime = this.scrollPosition * this.duration / this.zoomLevel;
        return startTime + (pixel / this.canvas.width) * visibleDuration;
    }
    
    seekTo(time) {
        // Dispatch seek event
        const event = new CustomEvent('waveform-seek', { detail: { time } });
        this.canvas.dispatchEvent(event);
    }
    
    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Initialize waveform when DOM is ready
function initializeWaveform() {
    if (document.getElementById('waveformCanvas')) {
        window.waveformRenderer = new WaveformRenderer('waveformCanvas', 'waveformMarkers');
    }
}

// Render waveform with data
function renderWaveform(waveformData) {
    if (window.waveformRenderer && currentSong) {
        window.waveformRenderer.loadWaveform(waveformData, currentSong.duration);
    }
}

// Update timeline markers
function updateTimeline() {
    if (window.waveformRenderer) {
        window.waveformRenderer.updateMarkers();
    }
}