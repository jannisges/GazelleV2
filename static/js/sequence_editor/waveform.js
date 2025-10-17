// Waveform display and interaction module
// Improved architecture with better performance and maintainability

class WaveformRenderer {
    // Constants
    static CONSTANTS = {
        MIN_ZOOM: 1,
        MAX_ZOOM: 100,
        THROTTLE_DELAY: 16, // 60 FPS
        PLAYHEAD_UPDATE_FPS: 30,
        HIGH_RES_SAMPLE_THRESHOLD: 100,
        HIGH_RES_STEP_DIVISOR: 50,
        MAX_AMPLITUDE_SCALE: 0.45,
        ZOOM_FACTOR: 1.25
    };

    constructor(canvasId, markersId) {
        this.canvas = document.getElementById(canvasId);
        this.markersContainer = document.getElementById(markersId);

        if (!this.canvas) {
            throw new Error(`Canvas element ${canvasId} not found`);
        }

        this.ctx = this.canvas.getContext('2d');

        // State
        this.state = {
            waveformData: null,
            duration: 0,
            zoomLevel: 1,
            scrollPosition: 0,
            currentTime: 0,
            isPlaying: false
        };

        // Cache
        this.cache = {
            offscreenCanvas: null,
            offscreenCtx: null,
            waveformCache: new Map(),
            globalMaxAmplitude: null,
            globalMaxLow: null,
            globalMaxMid: null,
            globalMaxHigh: null,
            lastRenderParams: null
        };

        // Flags
        this.flags = {
            isDirty: true,
            isDestroyed: false
        };

        // Animation
        this.animationId = null;

        // Initialize
        this.init();
    }

    init() {
        this.setupCanvas();
        this.setupPlayheadOverlay();
        this.setupEventListeners();
        this.render();
    }

    setupCanvas() {
        const container = this.canvas.parentElement;
        const containerRect = container.getBoundingClientRect();

        // Set canvas dimensions
        this.canvas.width = containerRect.width || 800;
        this.canvas.height = containerRect.height || 200;
        this.canvas.style.width = `${this.canvas.width}px`;
        this.canvas.style.height = `${this.canvas.height}px`;

        // Initialize offscreen canvas for caching
        this.setupOffscreenCanvas();

        // Resize handler
        this.resizeHandler = this.throttle(() => {
            const newRect = container.getBoundingClientRect();
            this.canvas.width = newRect.width || 800;
            this.canvas.height = newRect.height || 200;
            this.canvas.style.width = `${this.canvas.width}px`;
            this.canvas.style.height = `${this.canvas.height}px`;
            this.setupOffscreenCanvas();
            this.syncOverlaySize();
            this.invalidateCache();
            this.render();
        }, 100);

        window.addEventListener('resize', this.resizeHandler);
    }

    setupOffscreenCanvas() {
        if (!this.cache.offscreenCanvas) {
            this.cache.offscreenCanvas = document.createElement('canvas');
        }
        this.cache.offscreenCanvas.width = this.canvas.width;
        this.cache.offscreenCanvas.height = this.canvas.height;
        this.cache.offscreenCtx = this.cache.offscreenCanvas.getContext('2d');

        this.cache.waveformCache.clear();
        this.flags.isDirty = true;
    }

    setupPlayheadOverlay() {
        // Create overlay canvas for playhead
        this.playheadOverlay = document.createElement('canvas');
        Object.assign(this.playheadOverlay.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            pointerEvents: 'none',
            zIndex: '10'
        });

        this.canvas.parentElement.appendChild(this.playheadOverlay);
        this.playheadCtx = this.playheadOverlay.getContext('2d');

        this.syncOverlaySize();

        // Resize handler for overlay
        this.overlayResizeHandler = this.throttle(() => {
            this.syncOverlaySize();
        }, 100);

        window.addEventListener('resize', this.overlayResizeHandler);
    }

    syncOverlaySize() {
        this.playheadOverlay.width = this.canvas.width;
        this.playheadOverlay.height = this.canvas.height;
        this.playheadOverlay.style.width = this.canvas.style.width;
        this.playheadOverlay.style.height = this.canvas.style.height;
    }

    setupEventListeners() {
        // Click to seek
        this.boundClick = this.handleClick.bind(this);
        this.canvas.addEventListener('click', this.boundClick);

        // Right-click to add event
        this.boundContextMenu = this.handleContextMenu.bind(this);
        this.canvas.addEventListener('contextmenu', this.boundContextMenu);

        // Wheel for zoom
        this.boundWheel = this.throttle(this.handleWheel.bind(this),
            WaveformRenderer.CONSTANTS.THROTTLE_DELAY);
        this.canvas.addEventListener('wheel', this.boundWheel, { passive: false });

        // Drag to scroll
        this.setupDragScroll();
    }

    setupDragScroll() {
        let isDragging = false;
        let lastX = 0;

        const handleMouseDown = (e) => {
            if (this.state.zoomLevel > 1) {
                isDragging = true;
                lastX = e.clientX;
                this.canvas.style.cursor = 'grabbing';
                e.preventDefault();
            }
        };

        const handleMouseMove = this.throttle((e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - lastX;
            const scrollDelta = -(deltaX / this.canvas.width) / this.state.zoomLevel;
            const maxScrollPosition = this.state.zoomLevel > 1 ? 1 : 0;
            const newScrollPosition = this.clamp(
                this.state.scrollPosition + scrollDelta,
                0,
                maxScrollPosition
            );

            if (newScrollPosition !== this.state.scrollPosition) {
                this.state.scrollPosition = newScrollPosition;
                lastX = e.clientX;
                this.invalidateCache();
                this.render();
                this.updateMarkers();
                this.dispatchEvent('scroll-change', {
                    zoomLevel: this.state.zoomLevel,
                    scrollPosition: this.state.scrollPosition
                });
            }
        }, WaveformRenderer.CONSTANTS.THROTTLE_DELAY);

        const handleMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                this.canvas.style.cursor = 'default';
            }
        };

        this.boundMouseDown = handleMouseDown;
        this.boundMouseMove = handleMouseMove;
        this.boundMouseUp = handleMouseUp;

        this.canvas.addEventListener('mousedown', this.boundMouseDown);
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
        this.canvas.addEventListener('mouseleave', handleMouseUp);
    }

    // Event Handlers
    handleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = this.pixelToTime(x);
        this.seekTo(time);
    }

    handleContextMenu(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const time = this.pixelToTime(x);
        this.showAddEventDialog(time);
    }

    handleWheel(e) {
        e.preventDefault();

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = (e.clientX - rect.left) / rect.width;
        const mouseTime = this.pixelToTime(e.clientX - rect.left);

        const zoomFactor = e.deltaY > 0 ? 1 / WaveformRenderer.CONSTANTS.ZOOM_FACTOR : WaveformRenderer.CONSTANTS.ZOOM_FACTOR;
        const newZoomLevel = this.clamp(
            this.state.zoomLevel * zoomFactor,
            WaveformRenderer.CONSTANTS.MIN_ZOOM,
            WaveformRenderer.CONSTANTS.MAX_ZOOM
        );

        if (newZoomLevel !== this.state.zoomLevel) {
            this.state.zoomLevel = newZoomLevel;

            // Adjust scroll to keep mouse position stable
            const visibleDuration = this.getVisibleDuration();
            const targetTime = mouseTime - (mouseX * visibleDuration);
            const maxScroll = Math.max(0, this.state.duration - visibleDuration);
            this.state.scrollPosition = maxScroll > 0 ? this.clamp(targetTime / maxScroll, 0, 1) : 0;

            this.invalidateCache();
            this.render();
            this.updateMarkers();
            this.dispatchEvent('zoom-change', {
                zoomLevel: this.state.zoomLevel,
                scrollPosition: this.state.scrollPosition
            });
        }
    }

    // Public API
    loadWaveform(waveformData, duration) {
        console.log('Loading waveform data:', waveformData);
        console.log('Duration:', duration);

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

        this.state.waveformData = waveformData;
        this.state.duration = duration;

        // Reset global amplitude calculations
        this.cache.globalMaxAmplitude = null;
        this.cache.globalMaxLow = null;
        this.cache.globalMaxMid = null;
        this.cache.globalMaxHigh = null;

        this.invalidateCache();
        this.render();
        this.updateMarkers();
    }

    setZoomLevel(zoomLevel) {
        const newZoom = this.clamp(
            zoomLevel,
            WaveformRenderer.CONSTANTS.MIN_ZOOM,
            WaveformRenderer.CONSTANTS.MAX_ZOOM
        );

        if (newZoom !== this.state.zoomLevel) {
            this.state.zoomLevel = newZoom;
            this.invalidateCache();
            this.render();
            this.updateMarkers();
            this.dispatchEvent('zoom-change', {
                zoomLevel: this.state.zoomLevel,
                scrollPosition: this.state.scrollPosition
            });
        }
    }

    syncFromExternal(zoomLevel, scrollPosition) {
        const newZoom = this.clamp(
            zoomLevel,
            WaveformRenderer.CONSTANTS.MIN_ZOOM,
            WaveformRenderer.CONSTANTS.MAX_ZOOM
        );
        const maxScrollPosition = newZoom > 1 ? 1 : 0;
        const newScrollPosition = this.clamp(scrollPosition, 0, maxScrollPosition);

        if (newZoom !== this.state.zoomLevel || newScrollPosition !== this.state.scrollPosition) {
            this.state.zoomLevel = newZoom;
            this.state.scrollPosition = newScrollPosition;
            this.invalidateCache();
            this.render();
            this.updateMarkers();
        }
    }

    setCurrentTime(time) {
        this.state.currentTime = time;
        this.updatePlayhead();
    }

    setPlaying(isPlaying) {
        this.state.isPlaying = isPlaying;
        if (isPlaying) {
            this.startPlaybackAnimation();
        } else {
            this.stopPlaybackAnimation();
        }
    }

    // Rendering
    invalidateCache() {
        this.flags.isDirty = true;
        this.cache.waveformCache.clear();
    }

    render() {
        if (this.flags.isDestroyed) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (!this.hasWaveformData()) {
            this.drawPlaceholder();
            return;
        }

        // Draw waveform
        this.drawWaveform();

        // Update playhead overlay
        this.updatePlayhead();
    }

    hasWaveformData() {
        if (!this.state.waveformData) return false;

        if (Array.isArray(this.state.waveformData)) {
            return this.state.waveformData.length > 0;
        }

        if (typeof this.state.waveformData === 'object') {
            return this.state.waveformData.amplitude && this.state.waveformData.amplitude.length > 0;
        }

        return false;
    }

    drawPlaceholder() {
        const isDarkMode = document.documentElement.getAttribute('data-bs-theme') === 'dark';

        this.ctx.fillStyle = isDarkMode ? '#1a1a1a' : '#f8f9fa';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.fillStyle = isDarkMode ? '#adb5bd' : '#6c757d';
        this.ctx.font = '16px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Load an audio file to see waveform', this.canvas.width / 2, this.canvas.height / 2);
    }

    drawWaveform() {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Background
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Get amplitude data
        const amplitudeData = this.getAmplitudeData();
        if (!amplitudeData || amplitudeData.length === 0) {
            this.drawPlaceholder();
            return;
        }

        // Calculate zoom and scroll parameters
        const { startSample, endSample } = this.getVisibleSampleRange(amplitudeData.length);

        // Draw frequency bands or simple waveform
        if (this.hasFrequencyData()) {
            this.drawFrequencyBands(startSample, endSample, width, height);
        } else {
            this.drawSimpleWaveform(amplitudeData, startSample, endSample, width, height);
        }

        // Draw center line
        this.drawCenterLine(width, height);
    }

    drawCenterLine(width, height) {
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#444';
        this.ctx.lineWidth = 1;
        this.ctx.setLineDash([2, 2]);
        this.ctx.moveTo(0, height / 2);
        this.ctx.lineTo(width, height / 2);
        this.ctx.stroke();
        this.ctx.setLineDash([]);
    }

    drawSimpleWaveform(amplitudeData, startSample, endSample, width, height) {
        const centerY = height / 2;
        const maxAmplitude = height * WaveformRenderer.CONSTANTS.MAX_AMPLITUDE_SCALE;

        // Calculate global max amplitude once
        if (!this.cache.globalMaxAmplitude) {
            this.cache.globalMaxAmplitude = amplitudeData.reduce(
                (max, val) => Math.max(max, Math.abs(val)),
                0
            );
        }

        const scale = this.cache.globalMaxAmplitude > 0 ? maxAmplitude / this.cache.globalMaxAmplitude : 1;
        const samplesPerPixel = (endSample - startSample) / width;

        // Draw waveform
        this.ctx.strokeStyle = '#00ff88';
        this.ctx.lineWidth = 1.5;
        this.ctx.fillStyle = 'rgba(0, 255, 136, 0.3)';

        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);

        // Draw upper part
        for (let x = 0; x < width; x++) {
            const peak = this.getPeakForPixel(amplitudeData, startSample, x, samplesPerPixel);
            const y = centerY - (peak * scale);
            this.ctx.lineTo(x, y);
        }

        // Draw lower part (mirrored)
        for (let x = width - 1; x >= 0; x--) {
            const peak = this.getPeakForPixel(amplitudeData, startSample, x, samplesPerPixel);
            const y = centerY + (peak * scale);
            this.ctx.lineTo(x, y);
        }

        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();
    }

    drawFrequencyBands(startSample, endSample, width, height) {
        const centerY = height / 2;
        const maxAmplitude = height * WaveformRenderer.CONSTANTS.MAX_AMPLITUDE_SCALE;

        const lowData = this.state.waveformData.low || [];
        const midData = this.state.waveformData.mid || [];
        const highData = this.state.waveformData.high || [];

        if (lowData.length === 0 || midData.length === 0 || highData.length === 0) return;

        // Validate data alignment
        const amplitudeData = this.state.waveformData.amplitude || [];
        if (!this.validateFrequencyDataAlignment(lowData, midData, highData, amplitudeData)) {
            console.warn('Frequency band data length mismatch');
            return;
        }

        const samplesPerPixel = (endSample - startSample) / width;

        // Calculate global max values once
        if (!this.cache.globalMaxLow) {
            this.cache.globalMaxLow = Math.max(lowData.reduce((max, val) => Math.max(max, val), 0), 0.001);
            this.cache.globalMaxMid = Math.max(midData.reduce((max, val) => Math.max(max, val), 0), 0.001);
            this.cache.globalMaxHigh = Math.max(highData.reduce((max, val) => Math.max(max, val), 0), 0.001);
        }

        // Define frequency bands
        const bands = [
            { data: lowData, color: 'rgba(255, 60, 60, 0.8)', max: this.cache.globalMaxLow },
            { data: midData, color: 'rgba(60, 255, 60, 0.8)', max: this.cache.globalMaxMid },
            { data: highData, color: 'rgba(60, 120, 255, 0.8)', max: this.cache.globalMaxHigh }
        ];

        // Draw each band
        bands.forEach(band => {
            this.drawFrequencyBand(band, startSample, samplesPerPixel, width, centerY, maxAmplitude);
        });
    }

    drawFrequencyBand(band, startSample, samplesPerPixel, width, centerY, maxAmplitude) {
        this.ctx.fillStyle = band.color;
        this.ctx.strokeStyle = band.color.replace('0.8', '0.9');
        this.ctx.lineWidth = 0.5;

        this.ctx.beginPath();
        this.ctx.moveTo(0, centerY);

        // Draw upper part
        for (let x = 0; x < width; x++) {
            const peak = this.getFrequencyPeakForPixel(band.data, band.max, startSample, x, samplesPerPixel);
            const y = centerY - (peak * maxAmplitude);
            this.ctx.lineTo(x, y);
        }

        // Draw lower part (mirrored)
        for (let x = width - 1; x >= 0; x--) {
            const peak = this.getFrequencyPeakForPixel(band.data, band.max, startSample, x, samplesPerPixel);
            const y = centerY + (peak * maxAmplitude);
            this.ctx.lineTo(x, y);
        }

        this.ctx.closePath();
        this.ctx.fill();
    }

    getPeakForPixel(data, startSample, x, samplesPerPixel) {
        const sampleStart = Math.floor(startSample + x * samplesPerPixel);
        const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
        const endIndex = Math.min(sampleEnd, data.length);
        const sampleCount = endIndex - sampleStart;

        let peak = 0;

        if (sampleCount > WaveformRenderer.CONSTANTS.HIGH_RES_SAMPLE_THRESHOLD) {
            // Optimize for high-resolution data
            const step = Math.max(1, Math.floor(sampleCount / WaveformRenderer.CONSTANTS.HIGH_RES_STEP_DIVISOR));
            for (let i = sampleStart; i < endIndex; i += step) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
        } else {
            // Normal resolution
            for (let i = sampleStart; i < endIndex; i++) {
                peak = Math.max(peak, Math.abs(data[i]));
            }
        }

        return peak;
    }

    getFrequencyPeakForPixel(data, maxValue, startSample, x, samplesPerPixel) {
        const sampleStart = Math.floor(startSample + x * samplesPerPixel);
        const sampleEnd = Math.floor(startSample + (x + 1) * samplesPerPixel);
        const endIndex = Math.min(sampleEnd, data.length);
        const sampleCount = endIndex - sampleStart;

        let peak = 0;

        if (sampleCount > WaveformRenderer.CONSTANTS.HIGH_RES_SAMPLE_THRESHOLD) {
            const step = Math.max(1, Math.floor(sampleCount / WaveformRenderer.CONSTANTS.HIGH_RES_STEP_DIVISOR));
            for (let i = sampleStart; i < endIndex; i += step) {
                const normalized = data[i] / maxValue;
                peak = Math.max(peak, normalized);
            }
        } else {
            for (let i = sampleStart; i < endIndex; i++) {
                const normalized = data[i] / maxValue;
                peak = Math.max(peak, normalized);
            }
        }

        return peak;
    }

    updatePlayhead() {
        if (!this.playheadCtx) return;

        // Clear overlay
        this.playheadCtx.clearRect(0, 0, this.playheadOverlay.width, this.playheadOverlay.height);

        if (this.state.currentTime > 0) {
            const x = this.timeToPixel(this.state.currentTime);
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

        if (this.state.duration === 0) return;

        const width = this.markersContainer.clientWidth;
        const visibleDuration = this.getVisibleDuration();
        const interval = this.getMarkerInterval(visibleDuration);
        const { start: startTime, end: endTime } = this.getVisibleTimeRange();

        for (let time = Math.ceil(startTime / interval) * interval; time <= endTime; time += interval) {
            const x = this.timeToPixel(time);

            if (x >= 0 && x <= width) {
                const marker = this.createMarker(time, x, interval);
                this.markersContainer.appendChild(marker);
            }
        }
    }

    createMarker(time, x, interval) {
        const marker = document.createElement('div');
        marker.className = 'timeline-marker';
        marker.style.left = `${x}px`;

        const majorInterval = interval >= 1 ? interval * 5 : interval * 10;
        const isMajor = Math.abs(time % majorInterval) < 0.001;

        if (isMajor) {
            marker.classList.add('major');

            const label = document.createElement('div');
            label.className = 'timeline-label';
            label.textContent = this.formatTime(time);
            label.style.left = `${x}px`;
            this.markersContainer.appendChild(label);
        }

        return marker;
    }

    getMarkerInterval(visibleDuration) {
        if (visibleDuration > 600) return 60;
        if (visibleDuration > 300) return 30;
        if (visibleDuration > 120) return 10;
        if (visibleDuration > 60) return 5;
        if (visibleDuration > 30) return 2;
        if (visibleDuration > 10) return 1;
        if (visibleDuration > 5) return 0.5;
        return 0.1;
    }

    startPlaybackAnimation() {
        this.stopPlaybackAnimation();

        let lastRender = 0;
        const targetFPS = WaveformRenderer.CONSTANTS.PLAYHEAD_UPDATE_FPS;
        const frameDelay = 1000 / targetFPS;

        const animate = () => {
            if (this.state.isPlaying) {
                const now = performance.now();
                if (now - lastRender >= frameDelay) {
                    this.updatePlayhead();
                    lastRender = now;
                }
                this.animationId = requestAnimationFrame(animate);
            } else {
                this.animationId = null;
            }
        };

        this.animationId = requestAnimationFrame(animate);
    }

    stopPlaybackAnimation() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    // Helper Methods
    getAmplitudeData() {
        if (!this.state.waveformData) return null;

        if (this.state.waveformData.amplitude) {
            return this.state.waveformData.amplitude;
        }

        if (Array.isArray(this.state.waveformData)) {
            return this.state.waveformData;
        }

        return null;
    }

    hasFrequencyData() {
        return this.state.waveformData &&
               this.state.waveformData.low &&
               this.state.waveformData.mid &&
               this.state.waveformData.high;
    }

    validateFrequencyDataAlignment(lowData, midData, highData, amplitudeData) {
        return lowData.length === amplitudeData.length &&
               midData.length === amplitudeData.length &&
               highData.length === amplitudeData.length;
    }

    getVisibleDuration() {
        return this.state.duration / this.state.zoomLevel;
    }

    getVisibleTimeRange() {
        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);
        const endTime = startTime + visibleDuration;

        return { start: startTime, end: endTime };
    }

    getVisibleSampleRange(totalSamples) {
        const visibleSamples = totalSamples / this.state.zoomLevel;
        const startSample = Math.floor(this.state.scrollPosition * (totalSamples - visibleSamples));
        const endSample = Math.min(totalSamples, startSample + visibleSamples);

        return { startSample, endSample };
    }

    timeToPixel(time) {
        if (this.state.duration === 0) return 0;

        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);

        return ((time - startTime) / visibleDuration) * this.canvas.width;
    }

    pixelToTime(pixel) {
        if (this.state.duration === 0) return 0;

        const visibleDuration = this.getVisibleDuration();
        const startTime = this.state.scrollPosition * (this.state.duration - visibleDuration);

        return startTime + (pixel / this.canvas.width) * visibleDuration;
    }

    formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const wholeSecs = Math.floor(seconds % 60);

        if (seconds < 10 && seconds % 1 !== 0) {
            return `${seconds.toFixed(1)}s`;
        }

        return `${minutes}:${wholeSecs.toString().padStart(2, '0')}`;
    }

    seekTo(time) {
        this.dispatchEvent('seek', { time });
    }

    showAddEventDialog(time) {
        if (window.eventModal) {
            window.eventModal.showAddDialog(time);
        } else {
            console.warn('Event modal not available');
        }
    }

    refreshTheme() {
        this.render();
    }

    // Utility Methods
    throttle(func, delay) {
        let timeoutId = null;
        let lastArgs = null;

        return (...args) => {
            lastArgs = args;

            if (!timeoutId) {
                timeoutId = setTimeout(() => {
                    func.apply(this, lastArgs);
                    timeoutId = null;
                }, delay);
            }
        };
    }

    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    dispatchEvent(eventName, detail = {}) {
        const event = new CustomEvent(`waveform-${eventName}`, { detail });
        this.canvas.dispatchEvent(event);
    }

    // Cleanup
    destroy() {
        this.flags.isDestroyed = true;

        // Stop animation
        this.stopPlaybackAnimation();

        // Remove event listeners
        this.canvas.removeEventListener('click', this.boundClick);
        this.canvas.removeEventListener('contextmenu', this.boundContextMenu);
        this.canvas.removeEventListener('wheel', this.boundWheel);
        this.canvas.removeEventListener('mousedown', this.boundMouseDown);
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);

        window.removeEventListener('resize', this.resizeHandler);
        window.removeEventListener('resize', this.overlayResizeHandler);

        // Clear caches
        this.cache.waveformCache.clear();

        // Remove overlay
        if (this.playheadOverlay && this.playheadOverlay.parentNode) {
            this.playheadOverlay.parentNode.removeChild(this.playheadOverlay);
        }
    }
}

// Module-level helper functions
function initializeWaveform() {
    if (document.getElementById('waveformCanvas')) {
        window.waveformRenderer = new WaveformRenderer('waveformCanvas', 'waveformMarkers');
        setupTimelineSync();
    }
}

function renderWaveform(waveformData, duration = null) {
    if (window.waveformRenderer && waveformData) {
        const waveformDuration = duration || (currentSong ? currentSong.duration : 0);
        window.waveformRenderer.loadWaveform(waveformData, waveformDuration);
    }
}

function updateTimeline() {
    if (window.waveformRenderer) {
        window.waveformRenderer.updateMarkers();
    }
}

function setupTimelineSync() {
    if (!window.waveformRenderer || !window.sequenceEditor) return;

    // Listen for waveform changes and sync to sequence editor
    const waveformCanvas = document.getElementById('waveformCanvas');
    const sequenceContainer = document.getElementById('sequenceContainer');

    if (waveformCanvas && sequenceContainer) {
        waveformCanvas.addEventListener('waveform-zoom-change', (e) => {
            if (window.sequenceEditor) {
                window.sequenceEditor.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
            }
        });

        waveformCanvas.addEventListener('waveform-scroll-change', (e) => {
            if (window.sequenceEditor) {
                window.sequenceEditor.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
            }
        });

        sequenceContainer.addEventListener('sequence-zoom-change', (e) => {
            if (window.waveformRenderer) {
                window.waveformRenderer.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
            }
        });

        sequenceContainer.addEventListener('sequence-scroll-change', (e) => {
            if (window.waveformRenderer) {
                window.waveformRenderer.syncFromExternal(e.detail.zoomLevel, e.detail.scrollPosition);
            }
        });
    }
}
